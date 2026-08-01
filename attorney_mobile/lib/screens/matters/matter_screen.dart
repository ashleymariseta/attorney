import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:dio/dio.dart';

import '../../api/endpoints.dart';
import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/chat_doodles.dart';
import '../../widgets/common.dart';
import '../../widgets/notification_sound.dart';

/// Mobile matter room. Combines:
///  * a chat timeline (messages + documents + payments + consultations)
///  * a WebSocket connection to ``/ws/channel/<id>/`` for live updates
///  * a bottom-sheet attach menu (document, milestone, payment, time, review)
///  * a side drawer with tabs (Media, Links, Drafts, Payments, Time, Reviews)
class MatterScreen extends ConsumerStatefulWidget {
  const MatterScreen({super.key, required this.matterId});
  final int matterId;

  @override
  ConsumerState<MatterScreen> createState() => _MatterScreenState();
}

class _MatterScreenState extends ConsumerState<MatterScreen> {
  Matter? _matter;
  List<Message> _msgs = [];
  List<DocumentItem> _docs = [];
  List<Payment> _pays = [];
  List<TimeEntry> _times = [];
  List<Review> _reviews = [];
  List<Consultation> _consults = [];
  int _msgPage = 1;
  bool _msgHasMore = false;
  bool _msgLoadingMore = false;
  bool _loading = true;
  String? _error;

  final _textCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final List<Message> _pending = [];
  bool _sending = false;

  // WS state
  // Realtime feed over Server-Sent Events (plain HTTP; survives proxies/LBs
  // that drop WebSockets).
  StreamSubscription<List<int>>? _sseSub;
  CancelToken? _sseCancel;
  String _sseBuffer = '';
  bool _sseNeedsRefresh = false;
  Timer? _reconnectTimer;
  int _wsAttempt = 0;
  bool _wsClosed = false;
  String _wsStatus = 'connecting';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _wsClosed = true;
    _reconnectTimer?.cancel();
    _sseSub?.cancel();
    _sseCancel?.cancel();
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final ep = ref.read(endpointsProvider);
    try {
      final m = await ep.getMatter(widget.matterId);
      _matter = m;
      await Future.wait([
        if (m.channelId != null) _reloadMessages(m.channelId!),
        _reloadDocs(),
        _reloadPays(),
        _reloadTimes(),
        _reloadReviews(),
        _reloadConsults(),
      ]);
      if (!mounted) return;
      setState(() => _loading = false);
      if (m.channelId != null) _connectEvents(m.channelId!);
      // Jump to bottom once first frame is laid out.
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Could not load matter.';
      });
    }
  }

  Future<void> _reloadMessages(int channelId) async {
    final ep = ref.read(endpointsProvider);
    final r = await ep.listMessagesPage(channelId, page: 1);
    if (!mounted) return;
    setState(() {
      // Reverse so the timeline is in chronological order.
      _msgs = r.results.reversed.toList();
      _msgPage = 1;
      _msgHasMore = r.next != null;
      // Reconcile optimistic pending messages.
      _pending.removeWhere((p) => _msgs.any((m) => m.sender.id == p.sender.id && m.content == p.content));
    });
  }

  Future<void> _loadOlderMessages() async {
    if (_matter?.channelId == null || !_msgHasMore || _msgLoadingMore) return;
    setState(() => _msgLoadingMore = true);
    try {
      final ep = ref.read(endpointsProvider);
      final next = _msgPage + 1;
      final r = await ep.listMessagesPage(_matter!.channelId!, page: next);
      if (!mounted) return;
      setState(() {
        _msgs = [...r.results.reversed, ..._msgs];
        _msgPage = next;
        _msgHasMore = r.next != null;
      });
    } finally {
      if (mounted) setState(() => _msgLoadingMore = false);
    }
  }

  Future<void> _reloadDocs() async {
    final list = await ref.read(endpointsProvider).listDocumentsForMatter(widget.matterId);
    if (mounted) setState(() => _docs = list);
  }

  Future<void> _reloadPays() async {
    final list = await ref.read(endpointsProvider).listPaymentsForMatter(widget.matterId);
    if (mounted) setState(() => _pays = list);
  }

  Future<void> _reloadTimes() async {
    final list = await ref.read(endpointsProvider).listTimeForMatter(widget.matterId);
    if (mounted) setState(() => _times = list);
  }

  Future<void> _reloadReviews() async {
    final list = await ref.read(endpointsProvider).listReviewsForMatter(widget.matterId);
    if (mounted) setState(() => _reviews = list);
  }

  Future<void> _reloadConsults() async {
    final all = await ref.read(endpointsProvider).listConsultations();
    if (mounted) setState(() => _consults = all.where((c) => c.matter == widget.matterId).toList());
  }

  // ---- Realtime (Server-Sent Events) ----

  Future<void> _connectEvents(int channelId) async {
    if (_wsClosed || !mounted) return;
    setState(() => _wsStatus = 'connecting');
    try {
      final api = ref.read(apiClientProvider);
      // The token rides in the URL (EventSource-style). Refresh it first if the
      // last attempt failed auth, so we don't loop on an expired token.
      if (_sseNeedsRefresh) {
        _sseNeedsRefresh = false;
        await api.refreshAccess();
      }
      final token = await api.getAccess() ?? '';
      _sseCancel?.cancel();
      _sseCancel = CancelToken();
      _sseBuffer = '';
      final resp = await api.dio.get<ResponseBody>(
        '/api/v1/channels/$channelId/events/?token=${Uri.encodeComponent(token)}',
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: Duration.zero, // long-lived stream, no idle timeout
          headers: {'Accept': 'text/event-stream'},
        ),
        cancelToken: _sseCancel,
      );
      if (!mounted) return;
      setState(() {
        _wsStatus = 'connected';
        _wsAttempt = 0;
      });
      _sseSub = resp.data!.stream.listen(
        _onSseChunk,
        onError: (_) => _onSseClosed(),
        onDone: _onSseClosed,
        cancelOnError: true,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) _sseNeedsRefresh = true;
      _onSseClosed();
    } catch (_) {
      _onSseClosed();
    }
  }

  void _onSseClosed() {
    if (_wsClosed) return;
    if (mounted) setState(() => _wsStatus = 'disconnected');
    _wsAttempt += 1;
    final delay = Duration(
      milliseconds: (500 * (1 << _wsAttempt)).clamp(500, 30000),
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () {
      final cid = _matter?.channelId;
      if (cid != null) _connectEvents(cid);
    });
  }

  /// Parse the SSE byte stream: frames are separated by a blank line; `data:`
  /// lines carry JSON, `:` comment lines (heartbeats) are ignored.
  void _onSseChunk(List<int> bytes) {
    _sseBuffer += utf8.decode(bytes, allowMalformed: true);
    int idx;
    while ((idx = _sseBuffer.indexOf('\n\n')) != -1) {
      final frame = _sseBuffer.substring(0, idx);
      _sseBuffer = _sseBuffer.substring(idx + 2);
      for (final rawLine in frame.split('\n')) {
        final line = rawLine.replaceAll('\r', '');
        if (!line.startsWith('data:')) continue;
        final data = line.substring(5).trim();
        if (data.isEmpty) continue;
        try {
          _dispatchEvent(jsonDecode(data) as Map<String, dynamic>);
        } catch (_) {}
      }
    }
  }

  void _dispatchEvent(Map<String, dynamic> payload) {
    try {
      final kind = payload['kind'] as String?;
      if (kind == null) return;
      if (kind == 'message.created' || kind == 'message.reaction') {
        // Ring on incoming messages from someone else — match web's
        // `major` toast behaviour. Skip our own echoes.
        if (kind == 'message.created') {
          final senderId = (payload['sender_id'] as num?)?.toInt() ??
              (payload['message'] is Map
                  ? (payload['message']['sender_id'] as num?)?.toInt()
                  : null);
          final me = ref.read(authProvider).me;
          if (senderId == null || senderId != me?.id) {
            NotificationSound.play();
          }
        }
        if (_matter?.channelId != null) _reloadMessages(_matter!.channelId!);
      } else if (kind == 'document.created' || kind == 'document.updated') {
        _reloadDocs();
      } else if (kind == 'payment.created' || kind == 'payment.updated') {
        _reloadPays();
      }
    } catch (_) {}
  }

  // ---- Send + actions ----

  void _scrollToBottom() {
    if (!_scrollCtrl.hasClients) return;
    _scrollCtrl.animateTo(
      _scrollCtrl.position.maxScrollExtent,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  Future<void> _send() async {
    final body = _textCtrl.text.trim();
    final cid = _matter?.channelId;
    if (body.isEmpty || cid == null) return;
    final me = ref.read(authProvider).me;
    final optimistic = Message(
      id: -DateTime.now().millisecondsSinceEpoch,
      channel: cid,
      sender: MiniUser(
        id: me?.id ?? 0,
        email: me?.email ?? '',
        firstName: me?.firstName ?? '',
        lastName: me?.lastName ?? '',
        fullName: me?.fullName ?? 'You',
        role: me?.role ?? '',
      ),
      content: body,
      createdAt: DateTime.now().toIso8601String(),
    );
    setState(() {
      _pending.add(optimistic);
      _textCtrl.clear();
      _sending = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    try {
      await ref.read(endpointsProvider).sendMessage(cid, body);
      await _reloadMessages(cid);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _pending.removeWhere((p) => p.id == optimistic.id);
        _textCtrl.text = body;
      });
      _snack('Could not send: ${e.message}');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _uploadDocument() async {
    final res = await FilePicker.platform.pickFiles(withReadStream: false);
    if (res == null || res.files.isEmpty) return;
    final picked = res.files.first;
    final path = picked.path;
    if (path == null) return;
    try {
      await ref.read(endpointsProvider).uploadDocument(widget.matterId, path, picked.name);
      await _reloadDocs();
      if (mounted) _snack('${picked.name} uploaded.');
    } on ApiException catch (e) {
      if (mounted) _snack('Upload failed: ${e.message}');
    }
  }

  Future<void> _openThread(Message parent) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _ThreadSheet(parent: parent),
    );
    // Replies might have been added — refresh the timeline so reply_count
    // badges are up to date.
    if (_matter?.channelId != null) await _reloadMessages(_matter!.channelId!);
  }

  Future<void> _openMilestoneSheet() async {
    final cid = _matter?.channelId;
    if (cid == null) return;
    final label = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _MilestoneSheet(),
    );
    if (label == null || label.trim().isEmpty) return;
    try {
      await ref.read(endpointsProvider).sendMessage(cid, label.trim(), kind: 'milestone');
      await _reloadMessages(cid);
      if (mounted) _snack('Milestone posted.');
    } on ApiException catch (e) {
      if (mounted) _snack('Could not post milestone: ${e.message}');
    }
  }

  Future<void> _openRequestPaymentSheet() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _RequestPaymentSheet(matterId: widget.matterId),
    );
    if (created == true) await _reloadPays();
  }

  Future<void> _openLogTimeSheet() async {
    final logged = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LogTimeSheet(matterId: widget.matterId),
    );
    if (logged == true) await _reloadTimes();
  }

  Future<void> _openReviewSheet() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReviewSheet(matterId: widget.matterId),
    );
    if (created == true) await _reloadReviews();
  }

  Future<void> _openAttachMenu() async {
    final me = ref.read(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    final isClient = me?.isClient ?? false;

    final actions = <_AttachAction>[
      _AttachAction(LucideIcons.upload, 'Document', _uploadDocument),
      if (isLawyer) _AttachAction(LucideIcons.flag, 'Milestone', _openMilestoneSheet),
      _AttachAction(LucideIcons.creditCard, isLawyer ? 'Request payment' : 'Make a payment', _openRequestPaymentSheet),
      if (isLawyer) _AttachAction(LucideIcons.timer, 'Log time', _openLogTimeSheet),
      if (isClient) _AttachAction(LucideIcons.star, 'Leave a review', _openReviewSheet),
    ];

    await showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final a in actions)
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppColors.brandLight.withValues(alpha: 0.4),
                      child: Icon(a.icon, color: AppColors.brand, size: 18),
                    ),
                    title: Text(a.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      a.onTap();
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _openDrawer({_DrawerTab initial = _DrawerTab.media}) async {
    if (_matter == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (_, controller) => _InfoDrawerSheet(
          matter: _matter!,
          initialTab: initial,
          scrollController: controller,
          docs: _docs,
          msgs: _msgs,
          pays: _pays,
          times: _times,
          reviews: _reviews,
          onUploadDocument: _uploadDocument,
          onAddDraft: (title, body) async {
            try {
              await ref.read(endpointsProvider).createDraft(widget.matterId, title, body);
              await _reloadDocs();
            } on ApiException catch (e) {
              if (mounted) _snack(e.message);
            }
          },
          onCreatePayment: (amount, purpose) async {
            try {
              await ref.read(endpointsProvider).createPayment(
                    matterId: widget.matterId,
                    amount: amount,
                    currency: 'USD',
                    provider: 'manual_pop',
                    purpose: purpose,
                  );
              await _reloadPays();
            } on ApiException catch (e) {
              if (mounted) _snack(e.message);
            }
          },
          onPayPayment: (p) => _payPayment(p),
          onUploadProof: (p) => _uploadProofForPayment(p),
          onLogTime: () async {
            await _openLogTimeSheet();
          },
          onCreateReview: (rating, body) async {
            try {
              await ref.read(endpointsProvider).createReview(widget.matterId, rating, body);
              await _reloadReviews();
            } on ApiException catch (e) {
              if (mounted) _snack(e.message);
            }
          },
        ),
      ),
    );
  }

  Future<void> _payPayment(Payment p) async {
    // Reuses the proof-upload flow as the simplest mobile equivalent of
    // PayInvoiceModal — caller uploads a proof file, optional partial amount.
    await _uploadProofForPayment(p);
  }

  Future<void> _uploadProofForPayment(Payment p) async {
    final res = await FilePicker.platform.pickFiles();
    if (res == null || res.files.isEmpty) return;
    final f = res.files.first;
    if (f.path == null) return;
    try {
      await ref.read(endpointsProvider).uploadProofOfPayment(p.id, f.path!);
      await _reloadPays();
      if (mounted) _snack('Proof uploaded — awaiting verification.');
    } on ApiException catch (e) {
      if (mounted) _snack('Upload failed: ${e.message}');
    }
  }

  Future<void> _approvePayment(Payment p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Verify payment?'),
        content: Text('\$${double.tryParse(p.amount)?.toStringAsFixed(2) ?? p.amount} ${p.currency} will post to the trust ledger.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Verify')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(endpointsProvider).reviewPaymentTyped(p.id, 'verified');
      await _reloadPays();
      if (mounted) _snack('Payment verified.');
    } on ApiException catch (e) {
      if (mounted) _snack(e.message);
    }
  }

  Future<void> _rejectPayment(Payment p) async {
    final note = await showDialog<String>(
      context: context,
      builder: (_) {
        final c = TextEditingController();
        return AlertDialog(
          title: const Text('Reject payment'),
          content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Reason (optional)')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, null), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, c.text), child: const Text('Reject')),
          ],
        );
      },
    );
    if (note == null) return;
    try {
      await ref.read(endpointsProvider).reviewPaymentTyped(p.id, 'rejected', reviewNote: note);
      await _reloadPays();
      if (mounted) _snack('Payment rejected.');
    } on ApiException catch (e) {
      if (mounted) _snack(e.message);
    }
  }

  Future<void> _confirmConsultation(Consultation c) async {
    try {
      await ref.read(endpointsProvider).confirmConsultation(c.id);
      await _reloadConsults();
      if (mounted) _snack('Consultation confirmed.');
    } on ApiException catch (e) {
      if (mounted) _snack(e.message);
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  // ---- Build ----

  @override
  Widget build(BuildContext context) {
    if (_loading) return _loadingScaffold();
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Matter')),
        body: Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(message: _error!)),
      );
    }
    final m = _matter;
    if (m == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Matter')),
        body: const EmptyState(icon: LucideIcons.alertCircle, title: 'Matter not found'),
      );
    }
    final me = ref.watch(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    final isClient = me?.isClient ?? false;
    final other = isClient
        ? (m.lawyers?.isNotEmpty == true ? m.lawyers!.first.fullName : 'Lawyer')
        : (m.client?.fullName ?? 'Client');

    final timeline = _buildTimeline();

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.canPop() ? context.pop() : context.go(Routes.matters),
        ),
        title: InkWell(
          onTap: () => _openDrawer(),
          child: Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.brandDark,
                child: Text(
                  m.title.isNotEmpty ? m.title[0].toUpperCase() : '?',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      m.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink),
                    ),
                    Text(
                      'with $other · tap for info',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          IconButton(icon: const Icon(LucideIcons.info), onPressed: () => _openDrawer()),
        ],
      ),
      body: Column(
        children: [
          if (_wsStatus != 'connected')
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Center(
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF94A3B8)),
                  ),
                ),
              ),
            ),
          Expanded(
            child: m.channelId == null
                ? const Center(child: Text('No channel for this matter.', style: TextStyle(color: AppColors.muted)))
                : Stack(
                    children: [
                      const ChatDoodles(),
                      _Timeline(
                        items: timeline,
                        pending: _pending,
                        meId: me?.id,
                        matterClientId: m.client?.id,
                        isLawyer: isLawyer,
                        hasOlder: _msgHasMore,
                        loadingOlder: _msgLoadingMore,
                        scrollController: _scrollCtrl,
                        onLoadOlder: _loadOlderMessages,
                        onReact: (m, emoji) async {
                          try {
                            await ref.read(endpointsProvider).reactToMessage(m.id, emoji);
                            if (_matter?.channelId != null) await _reloadMessages(_matter!.channelId!);
                          } catch (_) {}
                        },
                        onOpenThread: (parent) => _openThread(parent),
                        onApprovePayment: _approvePayment,
                        onRejectPayment: _rejectPayment,
                        onPayPayment: _payPayment,
                        onConfirmConsultation: _confirmConsultation,
                        onOpenDocument: (d) async {
                          if (d.fileUrl != null) {
                            await launchUrl(Uri.parse(d.fileUrl!), mode: LaunchMode.externalApplication);
                          }
                        },
                      ),
                    ],
                  ),
          ),
          _Composer(
            controller: _textCtrl,
            sending: _sending,
            onSend: _send,
            onAttach: _openAttachMenu,
          ),
        ],
      ),
    );
  }

  Widget _loadingScaffold() {
    return Scaffold(
      appBar: AppBar(title: const Text('Matter')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Skeleton(height: 48, width: double.infinity),
          const SizedBox(height: 12),
          Skeleton(height: 36, width: 200),
          const SizedBox(height: 16),
          Skeleton(height: 64, width: double.infinity),
          const SizedBox(height: 8),
          Skeleton(height: 64, width: double.infinity),
          const SizedBox(height: 8),
          Skeleton(height: 90, width: double.infinity),
        ],
      ),
    );
  }

  List<_TimelineItem> _buildTimeline() {
    final items = <_TimelineItem>[];
    for (final m in _msgs) {
      items.add(_TimelineItem.message(m));
    }
    for (final d in _docs) {
      items.add(_TimelineItem.document(d));
    }
    for (final p in _pays) {
      items.add(_TimelineItem.payment(p));
    }
    for (final c in _consults) {
      items.add(_TimelineItem.consultation(c));
    }
    items.sort((a, b) {
      final ad = DateTime.tryParse(a.at) ?? DateTime(1970);
      final bd = DateTime.tryParse(b.at) ?? DateTime(1970);
      return ad.compareTo(bd);
    });
    return items;
  }
}

class _AttachAction {
  _AttachAction(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;
}

// ---- Timeline ----

class _TimelineItem {
  _TimelineItem._(this.kind, this.at, {this.message, this.document, this.payment, this.consultation});
  factory _TimelineItem.message(Message m) => _TimelineItem._('message', m.createdAt, message: m);
  factory _TimelineItem.document(DocumentItem d) => _TimelineItem._('document', d.createdAt, document: d);
  factory _TimelineItem.payment(Payment p) => _TimelineItem._('payment', p.createdAt, payment: p);
  factory _TimelineItem.consultation(Consultation c) => _TimelineItem._(
        'consultation',
        c.createdAt.isNotEmpty ? c.createdAt : c.scheduledTime,
        consultation: c,
      );

  final String kind;
  final String at;
  final Message? message;
  final DocumentItem? document;
  final Payment? payment;
  final Consultation? consultation;
}

class _Timeline extends StatelessWidget {
  const _Timeline({
    required this.items,
    required this.pending,
    required this.meId,
    required this.matterClientId,
    required this.isLawyer,
    required this.hasOlder,
    required this.loadingOlder,
    required this.scrollController,
    required this.onLoadOlder,
    required this.onReact,
    required this.onOpenThread,
    required this.onApprovePayment,
    required this.onRejectPayment,
    required this.onPayPayment,
    required this.onConfirmConsultation,
    required this.onOpenDocument,
  });
  final List<_TimelineItem> items;
  final List<Message> pending;
  final int? meId;
  final int? matterClientId;
  final bool isLawyer;
  final bool hasOlder;
  final bool loadingOlder;
  final ScrollController scrollController;
  final Future<void> Function() onLoadOlder;
  final void Function(Message m, String emoji) onReact;
  final void Function(Message parent) onOpenThread;
  final void Function(Payment p) onApprovePayment;
  final void Function(Payment p) onRejectPayment;
  final void Function(Payment p) onPayPayment;
  final void Function(Consultation c) onConfirmConsultation;
  final void Function(DocumentItem d) onOpenDocument;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty && pending.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(
            'This is the start of your matter room — no email needed.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 13, fontStyle: FontStyle.italic),
          ),
        ),
      );
    }
    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      children: [
        if (hasOlder)
          Center(
            child: TextButton(
              onPressed: loadingOlder ? null : onLoadOlder,
              child: Text(loadingOlder ? 'Loading older…' : 'Load older messages'),
            ),
          ),
        for (var i = 0; i < items.length; i++) _renderItem(context, items, i),
        for (final p in pending) _PendingBubble(m: p),
      ],
    );
  }

  Widget _renderItem(BuildContext context, List<_TimelineItem> items, int i) {
    final item = items[i];
    final prev = i > 0 ? items[i - 1] : null;
    if (item.kind == 'message') {
      final m = item.message!;
      if (m.kind == 'milestone') {
        return _MilestoneDivider(label: m.content, by: m.sender.fullName, time: m.createdAt);
      }
      final mine = m.sender.id == meId;
      final grouped = prev?.kind == 'message' && prev?.message?.sender.id == m.sender.id;
      return _MessageBubble(
        m: m,
        mine: mine,
        grouped: grouped,
        meId: meId,
        onReact: (e) => onReact(m, e),
        onOpenThread: () => onOpenThread(m),
      );
    }
    if (item.kind == 'document') {
      final d = item.document!;
      final mine = d.uploaderDetail?.id == meId;
      return _DocumentCard(d: d, mine: mine, onOpen: () => onOpenDocument(d));
    }
    if (item.kind == 'payment') {
      final p = item.payment!;
      final mine = matterClientId != null && matterClientId == meId;
      return _PaymentCard(
        p: p,
        mine: mine,
        canReview: isLawyer,
        onPay: () => onPayPayment(p),
        onApprove: () => onApprovePayment(p),
        onReject: () => onRejectPayment(p),
      );
    }
    if (item.kind == 'consultation') {
      final c = item.consultation!;
      final mine = c.client?.id == meId;
      return _ConsultationCard(c: c, mine: mine, isLawyer: isLawyer, onConfirm: () => onConfirmConsultation(c));
    }
    return const SizedBox.shrink();
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.m,
    required this.mine,
    required this.grouped,
    required this.meId,
    required this.onReact,
    required this.onOpenThread,
  });
  final Message m;
  final bool mine;
  final bool grouped;
  final int? meId;
  final void Function(String emoji) onReact;
  final VoidCallback onOpenThread;

  static const _quickEmoji = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

  Future<void> _showReactions(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (final e in _quickEmoji)
                IconButton(
                  onPressed: () => Navigator.pop(context, e),
                  icon: Text(e, style: const TextStyle(fontSize: 26)),
                ),
            ],
          ),
        ),
      ),
    );
    if (picked != null) onReact(picked);
  }

  @override
  Widget build(BuildContext context) {
    final time = DateTime.tryParse(m.createdAt);
    final timeStr = time != null ? DateFormat('HH:mm').format(time.toLocal()) : '';
    return Padding(
      padding: EdgeInsets.only(top: grouped ? 2 : 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!mine)
            SizedBox(
              width: 26,
              child: grouped
                  ? const SizedBox.shrink()
                  : CircleAvatar(
                      radius: 11,
                      backgroundColor: AppColors.brandLight,
                      child: Text(
                        _initials(m.sender),
                        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.brandDark),
                      ),
                    ),
            ),
          if (!mine) const SizedBox(width: 6),
          Flexible(
            child: GestureDetector(
              onLongPress: () => _showReactions(context),
              child: Container(
                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: mine ? AppColors.brandDark : AppColors.surface,
                  border: mine ? null : Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(16),
                    topRight: const Radius.circular(16),
                    bottomLeft: Radius.circular(mine ? 16 : 4),
                    bottomRight: Radius.circular(mine ? 4 : 16),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (!mine && !grouped)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Text(
                          m.sender.fullName,
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.brand),
                        ),
                      ),
                    Text(
                      m.content,
                      style: TextStyle(fontSize: 14, color: mine ? Colors.white : AppColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      timeStr,
                      style: TextStyle(
                        fontSize: 9,
                        color: mine ? Colors.white.withValues(alpha: 0.6) : AppColors.muted,
                      ),
                    ),
                    if ((m.reactions ?? []).isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final r in m.reactions!)
                            GestureDetector(
                              onTap: () => onReact(r.emoji),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                decoration: BoxDecoration(
                                  color: mine ? Colors.white.withValues(alpha: 0.2) : AppColors.canvas,
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  '${r.emoji} ${r.count}',
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: mine ? Colors.white : AppColors.ink,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                    // Reply-in-thread row: a small chip on the bottom of the
                    // bubble. Shows reply count when there are replies; just
                    // a reply icon otherwise.
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: GestureDetector(
                        onTap: onOpenThread,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              LucideIcons.messageCircle,
                              size: 11,
                              color: mine ? Colors.white.withValues(alpha: 0.7) : AppColors.muted,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              (m.replyCount ?? 0) == 0
                                  ? 'Reply'
                                  : '${m.replyCount} ${m.replyCount == 1 ? 'reply' : 'replies'}',
                              style: TextStyle(
                                fontSize: 10,
                                color: mine ? Colors.white.withValues(alpha: 0.7) : AppColors.muted,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _initials(MiniUser u) {
    final src = u.fullName.isNotEmpty ? u.fullName : u.email;
    final parts = src.split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((p) => p[0]).join().toUpperCase();
  }
}

class _PendingBubble extends StatelessWidget {
  const _PendingBubble({required this.m});
  final Message m;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Opacity(
            opacity: 0.6,
            child: Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: const BoxDecoration(
                color: AppColors.brandDark,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(m.content, style: const TextStyle(color: Colors.white, fontSize: 14)),
                  const SizedBox(height: 2),
                  Text('Sending…', style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 9)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MilestoneDivider extends StatelessWidget {
  const _MilestoneDivider({required this.label, required this.by, required this.time});
  final String label;
  final String by;
  final String time;
  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(time);
    final when = dt != null ? DateFormat('d MMM HH:mm').format(dt.toLocal()) : '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        children: [
          Row(
            children: [
              const Expanded(child: Divider(color: AppColors.line)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.cardTint,
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(LucideIcons.flag, size: 11, color: AppColors.brandDark),
                    const SizedBox(width: 4),
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.ink, letterSpacing: 0.6),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Expanded(child: Divider(color: AppColors.line)),
            ],
          ),
          const SizedBox(height: 4),
          Text('$by · $when', style: const TextStyle(fontSize: 9, color: AppColors.muted)),
        ],
      ),
    );
  }
}

class _DocumentCard extends StatelessWidget {
  const _DocumentCard({required this.d, required this.mine, required this.onOpen});
  final DocumentItem d;
  final bool mine;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final isDraft = d.kind == 'draft';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.cardTint,
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 8, decoration: const BoxDecoration(color: AppColors.brand, borderRadius: BorderRadius.vertical(top: Radius.circular(14)))),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 18,
                          backgroundColor: AppColors.brandLight.withValues(alpha: 0.4),
                          child: Icon(isDraft ? LucideIcons.edit : LucideIcons.fileText, color: AppColors.brandDark),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(d.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink, fontSize: 13)),
                              const SizedBox(height: 2),
                              Text('${isDraft ? 'Draft' : 'Document'} · v${d.version}', style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                            ],
                          ),
                        ),
                        if (d.fileUrl != null)
                          TextButton(
                            onPressed: onOpen,
                            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4)),
                            child: const Text('Open', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({
    required this.p,
    required this.mine,
    required this.canReview,
    required this.onPay,
    required this.onApprove,
    required this.onReject,
  });
  final Payment p;
  final bool mine;
  final bool canReview;
  final VoidCallback onPay;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final isPending = RegExp(r'pending|awaiting|review').hasMatch(p.status);
    final hasProof = p.proofOfPaymentUrl != null;
    final paid = double.tryParse(p.totalPaid ?? '0') ?? 0;
    final outstanding = double.tryParse(p.outstandingAmount ?? p.amount) ?? 0;
    final isPaid = p.status == 'verified';
    final isPartial = p.status == 'partial' && paid > 0 && outstanding > 0;
    final statusLabel = isPaid
        ? 'PAID'
        : isPartial
            ? 'PARTIAL · \$${outstanding.toStringAsFixed(2)} due'
            : (p.statusDisplay.isNotEmpty ? p.statusDisplay : p.status);

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.cardTint,
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 8, decoration: const BoxDecoration(color: Color(0xFF047857), borderRadius: BorderRadius.vertical(top: Radius.circular(14)))),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const CircleAvatar(
                              radius: 18,
                              backgroundColor: Color(0xFFECFDF5),
                              child: Icon(LucideIcons.receipt, color: Color(0xFF047857)),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Payment Request', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.ink)),
                                  const SizedBox(height: 2),
                                  Text(
                                    '\$${(double.tryParse(p.amount) ?? 0).toStringAsFixed(2)} ${p.currency} · ${p.purpose.replaceAll('_', ' ')}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 11, color: AppColors.muted),
                                  ),
                                  if (isPartial)
                                    Text(
                                      '\$${paid.toStringAsFixed(2)} paid',
                                      style: const TextStyle(fontSize: 11, color: Color(0xFF0369A1)),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        const Divider(height: 1),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            StatusPill(status: p.status, label: statusLabel),
                            const Spacer(),
                            if (mine && isPending && !hasProof)
                              FilledButton(
                                onPressed: onPay,
                                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), minimumSize: const Size(0, 30)),
                                child: const Text('Pay', style: TextStyle(fontSize: 11)),
                              ),
                            if (canReview && isPending && hasProof) ...[
                              IconButton(
                                onPressed: onApprove,
                                icon: const Icon(LucideIcons.thumbsUp, color: Color(0xFF047857), size: 18),
                                tooltip: 'Approve',
                                visualDensity: VisualDensity.compact,
                              ),
                              IconButton(
                                onPressed: onReject,
                                icon: const Icon(LucideIcons.thumbsDown, color: Color(0xFFB91C1C), size: 18),
                                tooltip: 'Reject',
                                visualDensity: VisualDensity.compact,
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ConsultationCard extends StatelessWidget {
  const _ConsultationCard({required this.c, required this.mine, required this.isLawyer, required this.onConfirm});
  final Consultation c;
  final bool mine;
  final bool isLawyer;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(c.scheduledTime);
    final when = dt != null ? DateFormat('d MMM HH:mm').format(dt.toLocal()) : c.scheduledTime;
    final canConfirm = isLawyer && c.status == 'pending';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.cardTint,
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 8, decoration: const BoxDecoration(color: Color(0xFF0369A1), borderRadius: BorderRadius.vertical(top: Radius.circular(14)))),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const CircleAvatar(
                              radius: 18,
                              backgroundColor: Color(0xFFEFF6FF),
                              child: Icon(LucideIcons.calendar, color: Color(0xFF0369A1)),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Consultation booked', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.ink)),
                                  const SizedBox(height: 2),
                                  Text(
                                    '$when · ${c.durationMinutes} min · ${c.modeDisplay}',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 11, color: AppColors.muted),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        const Divider(height: 1),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            StatusPill(status: c.status, label: c.statusDisplay),
                            const Spacer(),
                            if (canConfirm)
                              FilledButton(
                                onPressed: onConfirm,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFF047857),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                  minimumSize: const Size(0, 30),
                                ),
                                child: const Text('Confirm', style: TextStyle(fontSize: 11)),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Composer ----

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.sending, required this.onSend, required this.onAttach});
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onAttach;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        color: AppColors.surface,
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            IconButton(
              onPressed: onAttach,
              icon: const Icon(LucideIcons.plusCircle, color: AppColors.brandDark),
              tooltip: 'Attach',
            ),
            Expanded(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 120),
                child: TextField(
                  controller: controller,
                  minLines: 1,
                  maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    hintText: 'Message this matter room…',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            CircleAvatar(
              radius: 22,
              backgroundColor: AppColors.brandDark,
              child: IconButton(
                onPressed: sending ? null : onSend,
                icon: const Icon(LucideIcons.send, color: Colors.white, size: 18),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Milestone bottom sheet ----

class _MilestoneSheet extends StatefulWidget {
  const _MilestoneSheet();
  @override
  State<_MilestoneSheet> createState() => _MilestoneSheetState();
}

class _MilestoneSheetState extends State<_MilestoneSheet> {
  static const _presets = [
    'Court application filed',
    'Awaiting trial',
    'Awaiting ruling',
    'Ruling delivered',
    'Settlement reached',
    'Matter closed',
  ];
  String? _preset;
  final _custom = TextEditingController();

  @override
  void dispose() {
    _custom.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final label = _preset ?? _custom.text.trim();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Post a milestone', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(height: 4),
            const Text('Mark the matter\'s current status in the timeline.', style: TextStyle(fontSize: 12, color: AppColors.muted)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in _presets)
                  ChoiceChip(
                    label: Text(p),
                    selected: _preset == p,
                    onSelected: (_) => setState(() {
                      _preset = p;
                      _custom.clear();
                    }),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _custom,
              decoration: const InputDecoration(labelText: 'Or write your own', hintText: 'e.g. Discovery response served'),
              maxLength: 160,
              onChanged: (_) => setState(() => _preset = null),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: label.isEmpty ? null : () => Navigator.of(context).pop(label),
              child: const Text('Post milestone'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Request payment sheet ----

class _RequestPaymentSheet extends ConsumerStatefulWidget {
  const _RequestPaymentSheet({required this.matterId});
  final int matterId;
  @override
  ConsumerState<_RequestPaymentSheet> createState() => _RequestPaymentSheetState();
}

class _RequestPaymentSheetState extends ConsumerState<_RequestPaymentSheet> {
  final _amount = TextEditingController();
  String _purpose = 'trust_deposit';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).createPayment(
            matterId: widget.matterId,
            amount: _amount.text.trim(),
            currency: 'USD',
            provider: 'manual_pop',
            purpose: _purpose,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Request a payment', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount (USD)'),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _purpose,
              decoration: const InputDecoration(labelText: 'Purpose'),
              items: const [
                DropdownMenuItem(value: 'trust_deposit', child: Text('Trust deposit')),
                DropdownMenuItem(value: 'consultation', child: Text('Consultation')),
                DropdownMenuItem(value: 'invoice', child: Text('Invoice')),
                DropdownMenuItem(value: 'retainer', child: Text('Retainer')),
              ],
              onChanged: (v) => setState(() => _purpose = v ?? 'trust_deposit'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy || _amount.text.trim().isEmpty ? null : _submit,
              child: Text(_busy ? 'Saving…' : 'Add payment'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Log time sheet ----

class _LogTimeSheet extends ConsumerStatefulWidget {
  const _LogTimeSheet({required this.matterId});
  final int matterId;
  @override
  ConsumerState<_LogTimeSheet> createState() => _LogTimeSheetState();
}

class _LogTimeSheetState extends ConsumerState<_LogTimeSheet> {
  final _minutes = TextEditingController();
  final _desc = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _minutes.dispose();
    _desc.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final mins = int.tryParse(_minutes.text.trim());
    if (mins == null || mins <= 0) {
      setState(() => _error = 'Enter minutes greater than zero.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).logTime(
            matterId: widget.matterId,
            minutes: mins,
            description: _desc.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Log billable time', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(height: 12),
            TextField(
              controller: _minutes,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Minutes'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _desc,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Description', hintText: 'What did you work on?'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Saving…' : 'Log time'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Review sheet ----

class _ReviewSheet extends ConsumerStatefulWidget {
  const _ReviewSheet({required this.matterId});
  final int matterId;
  @override
  ConsumerState<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends ConsumerState<_ReviewSheet> {
  int _rating = 5;
  final _body = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).createReview(widget.matterId, _rating, _body.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Leave a review', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 1; i <= 5; i++)
                  IconButton(
                    onPressed: () => setState(() => _rating = i),
                    icon: Icon(
                      i <= _rating ? LucideIcons.star : LucideIcons.star,
                      color: AppColors.brand,
                      size: 28,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _body,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Share your experience…'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Submitting…' : 'Submit review'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Info drawer (modal sheet with tabs) ----

enum _DrawerTab { media, links, drafts, payments, time, reviews }

class _InfoDrawerSheet extends ConsumerStatefulWidget {
  const _InfoDrawerSheet({
    required this.matter,
    required this.initialTab,
    required this.scrollController,
    required this.docs,
    required this.msgs,
    required this.pays,
    required this.times,
    required this.reviews,
    required this.onUploadDocument,
    required this.onAddDraft,
    required this.onCreatePayment,
    required this.onPayPayment,
    required this.onUploadProof,
    required this.onLogTime,
    required this.onCreateReview,
  });
  final Matter matter;
  final _DrawerTab initialTab;
  final ScrollController scrollController;
  final List<DocumentItem> docs;
  final List<Message> msgs;
  final List<Payment> pays;
  final List<TimeEntry> times;
  final List<Review> reviews;
  final Future<void> Function() onUploadDocument;
  final Future<void> Function(String title, String body) onAddDraft;
  final Future<void> Function(String amount, String purpose) onCreatePayment;
  final void Function(Payment) onPayPayment;
  final void Function(Payment) onUploadProof;
  final Future<void> Function() onLogTime;
  final Future<void> Function(int rating, String body) onCreateReview;

  @override
  ConsumerState<_InfoDrawerSheet> createState() => _InfoDrawerSheetState();
}

class _InfoDrawerSheetState extends ConsumerState<_InfoDrawerSheet> {
  late _DrawerTab _tab;

  @override
  void initState() {
    super.initState();
    _tab = widget.initialTab;
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    final isClient = me?.isClient ?? false;

    final tabs = <_DrawerTabConfig>[
      _DrawerTabConfig(_DrawerTab.media, 'Media', LucideIcons.image),
      _DrawerTabConfig(_DrawerTab.links, 'Links', LucideIcons.externalLink),
      _DrawerTabConfig(_DrawerTab.drafts, 'Drafts', LucideIcons.edit),
      _DrawerTabConfig(_DrawerTab.payments, 'Payments', LucideIcons.creditCard),
      if (isLawyer) _DrawerTabConfig(_DrawerTab.time, 'Time', LucideIcons.timer),
      _DrawerTabConfig(_DrawerTab.reviews, 'Reviews', LucideIcons.star),
    ];

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 8),
          Container(width: 36, height: 4, decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(2))),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.brandDark,
                  child: Text(
                    widget.matter.title.isNotEmpty ? widget.matter.title[0].toUpperCase() : '?',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 18),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.matter.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
                      const SizedBox(height: 2),
                      Wrap(
                        spacing: 4,
                        children: [
                          StatusPill(status: widget.matter.status),
                          if (widget.matter.billingModel.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(color: AppColors.canvas, borderRadius: BorderRadius.circular(999)),
                              child: Text(
                                widget.matter.billingModel.replaceAll('_', ' ').toUpperCase(),
                                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.4),
                              ),
                            ),
                          if (widget.matter.practiceArea.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(color: AppColors.canvas, borderRadius: BorderRadius.circular(999)),
                              child: Text(
                                widget.matter.practiceArea.toUpperCase(),
                                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.4),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              children: [
                for (final t in tabs)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: ChoiceChip(
                      label: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(t.icon, size: 13, color: _tab == t.tab ? Colors.white : AppColors.muted),
                          const SizedBox(width: 4),
                          Text(t.label),
                        ],
                      ),
                      selected: _tab == t.tab,
                      selectedColor: AppColors.brandDark,
                      labelStyle: TextStyle(color: _tab == t.tab ? Colors.white : AppColors.ink, fontSize: 11, fontWeight: FontWeight.w600),
                      onSelected: (_) => setState(() => _tab = t.tab),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              controller: widget.scrollController,
              padding: const EdgeInsets.all(16),
              children: [
                if (_tab == _DrawerTab.media) ..._mediaPanel(),
                if (_tab == _DrawerTab.links) ..._linksPanel(),
                if (_tab == _DrawerTab.drafts) ..._draftsPanel(),
                if (_tab == _DrawerTab.payments) ..._paymentsPanel(isLawyer: isLawyer),
                if (_tab == _DrawerTab.time) ..._timePanel(isLawyer: isLawyer),
                if (_tab == _DrawerTab.reviews) ..._reviewsPanel(canReview: isClient),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _mediaPanel() {
    final docs = widget.docs.where((d) => d.kind == 'document').toList();
    return [
      FilledButton.icon(
        onPressed: widget.onUploadDocument,
        icon: const Icon(LucideIcons.upload, size: 16),
        label: const Text('Upload document'),
      ),
      const SizedBox(height: 16),
      if (docs.isEmpty)
        const EmptyState(icon: LucideIcons.fileText, title: 'No documents yet')
      else
        for (final d in docs) _docTile(d),
    ];
  }

  List<Widget> _linksPanel() {
    final urlRe = RegExp(r'https?://[^\s]+');
    final links = <_LinkRow>[];
    for (final m in widget.msgs) {
      for (final match in urlRe.allMatches(m.content)) {
        links.add(_LinkRow(url: match.group(0)!, by: m.sender.fullName, at: m.createdAt));
      }
    }
    if (links.isEmpty) return const [Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('No links shared yet.', style: TextStyle(color: AppColors.muted)))];
    return [
      for (final l in links)
        InkWell(
          onTap: () => launchUrl(Uri.parse(l.url), mode: LaunchMode.externalApplication),
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
            child: Row(
              children: [
                const CircleAvatar(radius: 14, backgroundColor: AppColors.brandLight, child: Icon(LucideIcons.externalLink, size: 14, color: AppColors.brand)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l.url, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: AppColors.brand, fontWeight: FontWeight.w600)),
                      Text('${l.by} · ${_shortDate(l.at)}', style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
    ];
  }

  List<Widget> _draftsPanel() {
    final drafts = widget.docs.where((d) => d.kind == 'draft').toList();
    return [
      _DraftForm(onSubmit: widget.onAddDraft),
      const SizedBox(height: 16),
      if (drafts.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No drafts yet.', style: TextStyle(color: AppColors.muted)))
      else
        for (final d in drafts) _docTile(d),
    ];
  }

  List<Widget> _paymentsPanel({required bool isLawyer}) {
    return [
      if (isLawyer) _PaymentRequestForm(onSubmit: widget.onCreatePayment),
      if (isLawyer) const SizedBox(height: 16),
      if (widget.pays.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No payments on this matter.', style: TextStyle(color: AppColors.muted)))
      else
        for (final p in widget.pays)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '\$${(double.tryParse(p.amount) ?? 0).toStringAsFixed(2)} ${p.currency}',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                      ),
                    ),
                    StatusPill(status: p.status, label: p.statusDisplay),
                  ],
                ),
                Text(
                  p.purpose.toUpperCase().replaceAll('_', ' '),
                  style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4),
                ),
                if (p.proofOfPaymentUrl == null) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => widget.onUploadProof(p),
                    icon: const Icon(LucideIcons.upload, size: 14),
                    label: const Text('Upload proof', style: TextStyle(fontSize: 11)),
                  ),
                ],
              ],
            ),
          ),
    ];
  }

  List<Widget> _timePanel({required bool isLawyer}) {
    final totalMinutes = widget.times.fold<int>(0, (s, e) => s + e.minutes);
    final totalAmount = widget.times.fold<double>(0, (s, e) => s + (double.tryParse(e.amount ?? '0') ?? 0));
    return [
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.canvas, borderRadius: BorderRadius.circular(10)),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('BILLABLE TOTAL', style: TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
                Text('\$${totalAmount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.ink)),
              ],
            ),
            Text('$totalMinutes min logged', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
          ],
        ),
      ),
      const SizedBox(height: 12),
      if (isLawyer)
        OutlinedButton.icon(
          onPressed: widget.onLogTime,
          icon: const Icon(LucideIcons.plus, size: 14),
          label: const Text('Log time on this matter'),
        ),
      const SizedBox(height: 12),
      if (widget.times.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No time logged yet.', style: TextStyle(color: AppColors.muted)))
      else
        for (final e in widget.times)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${e.minutes} min', style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink)),
                    Text('\$${e.amount ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
                  ],
                ),
                Text(
                  '${e.description.isEmpty ? 'Billable work' : e.description} · ${_shortDate(e.startedAt)}${e.isRunning ? ' · running' : ''}',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
    ];
  }

  List<Widget> _reviewsPanel({required bool canReview}) {
    final alreadyReviewed = canReview && widget.reviews.isNotEmpty;
    return [
      if (canReview && !alreadyReviewed) _ReviewForm(onSubmit: widget.onCreateReview),
      if (canReview && !alreadyReviewed) const SizedBox(height: 12),
      if (widget.reviews.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No reviews yet.', style: TextStyle(color: AppColors.muted)))
      else
        for (final r in widget.reviews)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        for (var i = 1; i <= 5; i++)
                          Icon(i <= r.rating ? LucideIcons.star : LucideIcons.star, size: 14, color: AppColors.brand),
                      ],
                    ),
                    Text(_shortDate(r.createdAt), style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(r.body, style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 4),
                Text('— ${r.authorDetail?.fullName ?? 'Anonymous'}', style: const TextStyle(fontSize: 10, color: AppColors.muted)),
              ],
            ),
          ),
    ];
  }

  Widget _docTile(DocumentItem d) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: d.fileUrl != null ? () => launchUrl(Uri.parse(d.fileUrl!), mode: LaunchMode.externalApplication) : null,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
          child: Row(
            children: [
              Icon(d.kind == 'draft' ? LucideIcons.edit : LucideIcons.fileText, color: AppColors.brandDark),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    Text('${d.uploaderDetail?.fullName ?? 'Unknown'} · v${d.version}', style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ],
                ),
              ),
              if (d.fileUrl != null) const Text('Open', style: TextStyle(fontSize: 11, color: AppColors.brand, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

class _DrawerTabConfig {
  _DrawerTabConfig(this.tab, this.label, this.icon);
  final _DrawerTab tab;
  final String label;
  final IconData icon;
}

class _LinkRow {
  _LinkRow({required this.url, required this.by, required this.at});
  final String url;
  final String by;
  final String at;
}

String _shortDate(String iso) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('d MMM').format(dt.toLocal());
}

class _DraftForm extends StatefulWidget {
  const _DraftForm({required this.onSubmit});
  final Future<void> Function(String title, String body) onSubmit;
  @override
  State<_DraftForm> createState() => _DraftFormState();
}

class _DraftFormState extends State<_DraftForm> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    if (_title.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.onSubmit(_title.text.trim(), _body.text);
      _title.clear();
      _body.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
      child: Column(
        children: [
          TextField(controller: _title, decoration: const InputDecoration(labelText: 'Draft title (e.g. Engagement letter)')),
          const SizedBox(height: 8),
          TextField(controller: _body, maxLines: 4, decoration: const InputDecoration(labelText: 'Draft content…')),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _add, child: Text(_busy ? 'Saving…' : 'Add draft')),
        ],
      ),
    );
  }
}

class _PaymentRequestForm extends StatefulWidget {
  const _PaymentRequestForm({required this.onSubmit});
  final Future<void> Function(String amount, String purpose) onSubmit;
  @override
  State<_PaymentRequestForm> createState() => _PaymentRequestFormState();
}

class _PaymentRequestFormState extends State<_PaymentRequestForm> {
  final _amount = TextEditingController();
  String _purpose = 'trust_deposit';
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    if (_amount.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.onSubmit(_amount.text.trim(), _purpose);
      _amount.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('REQUEST / RECORD A PAYMENT', style: TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _amount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Amount'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _purpose,
                  decoration: const InputDecoration(labelText: 'Purpose'),
                  items: const [
                    DropdownMenuItem(value: 'trust_deposit', child: Text('Trust')),
                    DropdownMenuItem(value: 'consultation', child: Text('Consult')),
                    DropdownMenuItem(value: 'invoice', child: Text('Invoice')),
                    DropdownMenuItem(value: 'retainer', child: Text('Retainer')),
                  ],
                  onChanged: (v) => setState(() => _purpose = v ?? 'trust_deposit'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _add, child: Text(_busy ? 'Saving…' : 'Add payment')),
        ],
      ),
    );
  }
}

class _ReviewForm extends StatefulWidget {
  const _ReviewForm({required this.onSubmit});
  final Future<void> Function(int rating, String body) onSubmit;
  @override
  State<_ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends State<_ReviewForm> {
  int _rating = 5;
  final _body = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await widget.onSubmit(_rating, _body.text);
      _body.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(border: Border.all(color: AppColors.line), borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('RATE YOUR LAWYER', style: TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
          Row(
            children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  onPressed: () => setState(() => _rating = i),
                  icon: Icon(i <= _rating ? LucideIcons.star : LucideIcons.star, color: AppColors.brand, size: 24),
                ),
            ],
          ),
          TextField(controller: _body, maxLines: 3, decoration: const InputDecoration(labelText: 'Share your experience…')),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Submitting…' : 'Submit review')),
        ],
      ),
    );
  }
}

/// Bottom-sheet thread view — parent message at the top, replies below,
/// composer at the bottom. Mirrors the web ThreadPanel.
class _ThreadSheet extends ConsumerStatefulWidget {
  const _ThreadSheet({required this.parent});
  final Message parent;
  @override
  ConsumerState<_ThreadSheet> createState() => _ThreadSheetState();
}

class _ThreadSheetState extends ConsumerState<_ThreadSheet> {
  final _ctrl = TextEditingController();
  List<Message> _replies = const [];
  bool _loading = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final r = await ref.read(endpointsProvider).messageReplies(widget.parent.id);
      if (!mounted) return;
      setState(() {
        _replies = r;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final body = _ctrl.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(endpointsProvider)
          .sendMessage(widget.parent.channel, body, parent: widget.parent.id);
      _ctrl.clear();
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not reply: ${e is ApiException ? e.message : e}')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: media.size.height * 0.78,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 8, 6),
                child: Row(
                  children: [
                    const Icon(LucideIcons.messageCircle, size: 16, color: AppColors.brand),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text('Thread',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.ink)),
                    ),
                    IconButton(
                      icon: const Icon(LucideIcons.x, size: 18, color: AppColors.muted),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    _ThreadParent(parent: widget.parent),
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
                      child: Text(
                        _loading
                            ? 'Loading replies…'
                            : '${_replies.length} ${_replies.length == 1 ? 'reply' : 'replies'}',
                        style: const TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4),
                      ),
                    ),
                    if (!_loading && _replies.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: Text('No replies yet — start the conversation.',
                              style: TextStyle(fontSize: 12, color: AppColors.muted, fontStyle: FontStyle.italic)),
                        ),
                      ),
                    for (final r in _replies) _ThreadReply(m: r),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _ctrl,
                        minLines: 1,
                        maxLines: 4,
                        decoration: const InputDecoration(
                          hintText: 'Reply in thread…',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    FilledButton(
                      onPressed: _sending ? null : _send,
                      child: const Icon(LucideIcons.send, size: 16),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThreadParent extends StatelessWidget {
  const _ThreadParent({required this.parent});
  final Message parent;
  @override
  Widget build(BuildContext context) {
    final t = DateTime.tryParse(parent.createdAt);
    final timeStr = t != null ? DateFormat('d MMM · HH:mm').format(t.toLocal()) : '';
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.canvas,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(parent.sender.fullName,
              style: const TextStyle(fontSize: 11, color: AppColors.brand, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(parent.content, style: const TextStyle(fontSize: 13, color: AppColors.ink)),
          const SizedBox(height: 4),
          Text(timeStr, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
        ],
      ),
    );
  }
}

class _ThreadReply extends StatelessWidget {
  const _ThreadReply({required this.m});
  final Message m;
  @override
  Widget build(BuildContext context) {
    final t = DateTime.tryParse(m.createdAt);
    final timeStr = t != null ? DateFormat('HH:mm').format(t.toLocal()) : '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 11,
            backgroundColor: AppColors.brandLight,
            child: Text(
              _initials(m.sender),
              style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.brandDark),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(m.sender.fullName,
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.ink)),
                    const SizedBox(width: 6),
                    Text(timeStr, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ],
                ),
                Text(m.content, style: const TextStyle(fontSize: 13, color: AppColors.ink)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _initials(MiniUser u) {
    final src = u.fullName.isNotEmpty ? u.fullName : u.email;
    final parts = src.split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((p) => p[0]).join().toUpperCase();
  }
}
