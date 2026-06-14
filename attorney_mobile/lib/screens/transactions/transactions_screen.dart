import 'dart:io';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/endpoints.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mobile Transactions — list of payment + trust ledger rows with a detail
/// bottom sheet, CSV export, and a view-POP launcher that opens images
/// inline and PDFs in the system viewer.
class TransactionsScreen extends ConsumerStatefulWidget {
  const TransactionsScreen({super.key});

  @override
  ConsumerState<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _Tx {
  _Tx(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'].toString();
  String get kind => (j['kind'] as String?) ?? '';
  int get matter => (j['matter'] as num?)?.toInt() ?? 0;
  String get matterTitle => (j['matter_title'] as String?) ?? '';
  String get label => (j['label'] as String?) ?? '';
  String get amount => (j['amount'] as String?) ?? '0';
  String get currency => (j['currency'] as String?) ?? '';
  String get status => (j['status'] as String?) ?? '';
  String get statusDisplay => (j['status_display'] as String?) ?? status;
  String get createdAt => (j['created_at'] as String?) ?? '';
  int? get paymentId => (j['payment_id'] as num?)?.toInt();
  String? get purpose => j['purpose'] as String?;
  int? get payerId => (j['payer_id'] as num?)?.toInt();
  bool get hasProof => j['has_proof'] == true;
  String? get proofUrl => j['proof_of_payment_url'] as String?;
  bool get canReview => j['can_review'] == true;
  String? get note => j['note'] as String?;
  String? get reviewNote => j['review_note'] as String?;
}

class _TransactionsScreenState extends ConsumerState<TransactionsScreen> {
  late Future<List<_Tx>> _load;
  String _escrow = '0';
  String _query = '';
  bool _exporting = false;
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<List<_Tx>> _fetch() async {
    final res = await ref.read(endpointsProvider).listTransactions();
    final results = (res['results'] as List? ?? const []).cast<Map<String, dynamic>>();
    _escrow = (res['total_escrow'] as String?) ?? '0';
    return results.map((m) => _Tx(m)).toList();
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  Future<void> _exportCsv() async {
    setState(() => _exporting = true);
    try {
      final bytes = await ref.read(endpointsProvider).downloadTransactionsCsv();
      final dir = Directory.systemTemp;
      final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
      final file = File('${dir.path}/transactions-$today.csv');
      await file.writeAsBytes(bytes, flush: true);
      final uri = Uri.file(file.path);
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ok ? 'CSV saved to ${file.path}' : 'Saved to ${file.path}')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not export transactions.')),
        );
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _approve(int paymentId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Verify payment?'),
        content: const Text(
          'Funds will post to the matter trust ledger and the payer will be notified.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Verify')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(endpointsProvider).reviewPayment(paymentId, 'verified');
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment verified — funds posted to trust ledger.')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _reject(_Tx t) async {
    final pid = t.paymentId;
    if (pid == null) return;
    final noteCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reject payment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Rejecting will let the payer re-upload proof on ${t.matterTitle}.',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: noteCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                hintText: "e.g. POP doesn't match the reference.",
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFB91C1C)),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm rejection'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(endpointsProvider).reviewPayment(pid, 'rejected', note: noteCtrl.text.trim());
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment rejected — payer can re-upload.')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _comment(_Tx t) async {
    final pid = t.paymentId;
    if (pid == null) return;
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Add comment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'On ${t.matterTitle} · ${t.label} · \$${t.amount} ${t.currency}',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Comment',
                hintText: 'Add a note for the matter…',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Post')),
        ],
      ),
    );
    if (ok != true) return;
    final body = ctrl.text.trim();
    if (body.isEmpty) return;
    try {
      await ref.read(endpointsProvider).commentPayment(pid, body);
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Comment added.')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  void _viewProof(String url, String title) {
    showDialog<void>(
      context: context,
      builder: (_) => _ProofViewer(url: url, title: title),
    );
  }

  void _openDetail(_Tx t) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _TxDetailSheet(t: t, onViewProof: _viewProof),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isAdmin = me?.role == 'admin';
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('Transactions'),
        actions: [
          IconButton(
            tooltip: 'Export CSV',
            icon: _exporting
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(LucideIcons.download),
            onPressed: _exporting ? null : _exportCsv,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<_Tx>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (var i = 0; i < 6; i++) ...[
                    Skeleton(height: 60, width: double.infinity),
                    const SizedBox(height: 10),
                  ],
                ],
              );
            }
            if (snap.hasError) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [ErrorBanner(message: snap.error.toString())],
              );
            }
            final items = snap.data ?? const <_Tx>[];
            final pending = items
                .where((t) => t.status.toLowerCase().contains('pending'))
                .fold<double>(0, (s, t) => s + (double.tryParse(t.amount) ?? 0));

            final q = _query.trim().toLowerCase();
            final filtered = q.isEmpty
                ? items
                : items.where((t) {
                    return t.matterTitle.toLowerCase().contains(q) ||
                        t.label.toLowerCase().contains(q) ||
                        t.statusDisplay.toLowerCase().contains(q) ||
                        t.amount.toLowerCase().contains(q);
                  }).toList();

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(child: _Stat(label: 'In escrow', value: '\$$_escrow', icon: LucideIcons.landmark)),
                    const SizedBox(width: 8),
                    Expanded(child: _Stat(label: 'Pending', value: '\$${pending.toStringAsFixed(2)}', icon: LucideIcons.clock)),
                    const SizedBox(width: 8),
                    Expanded(child: _Stat(label: 'Txns', value: '${items.length}', icon: LucideIcons.receipt)),
                  ],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _searchCtrl,
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(LucideIcons.search, size: 18),
                    hintText: 'Search matter, type, status or amount…',
                    isDense: true,
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(LucideIcons.x, size: 18),
                            onPressed: () {
                              _searchCtrl.clear();
                              setState(() => _query = '');
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 12),
                if (filtered.isEmpty)
                  EmptyState(
                    icon: LucideIcons.receipt,
                    title: _query.isEmpty ? 'No transactions yet' : 'No matches for "$_query"',
                  )
                else
                  for (final t in filtered)
                    _TxTile(
                      t: t,
                      isAdmin: isAdmin,
                      isMine: me?.id == t.payerId,
                      onTap: () => _openDetail(t),
                      onApprove: (id) => _approve(id),
                      onReject: () => _reject(t),
                      onComment: () => _comment(t),
                      onViewProof: t.proofUrl != null
                          ? () => _viewProof(t.proofUrl!, 'Proof of payment · ${t.label}')
                          : null,
                    ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _TxTile extends StatelessWidget {
  const _TxTile({
    required this.t,
    required this.isAdmin,
    required this.isMine,
    required this.onTap,
    required this.onApprove,
    required this.onReject,
    required this.onComment,
    required this.onViewProof,
  });
  final _Tx t;
  final bool isAdmin;
  final bool isMine;
  final VoidCallback onTap;
  final Future<void> Function(int paymentId) onApprove;
  final VoidCallback onReject;
  final VoidCallback onComment;
  final VoidCallback? onViewProof;

  @override
  Widget build(BuildContext context) {
    final isPayment = t.kind == 'payment';
    final isPending = RegExp(r'pending|awaiting').hasMatch(t.status.toLowerCase());
    final canReview = t.canReview || isAdmin;
    final canApprove = canReview && isPayment && isPending && t.hasProof;
    final canReject = canReview && isPayment && isPending;
    final created = DateTime.tryParse(t.createdAt);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.cardTint,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.matterTitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${t.kind == 'trust' ? 'Trust' : 'Payment'} · ${t.label}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('\$${t.amount}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
                    if (created != null)
                      Text(
                        DateFormat('MMM d').format(created.toLocal()),
                        style: const TextStyle(fontSize: 10, color: AppColors.muted),
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                StatusPill(status: t.status, label: t.statusDisplay),
                const Spacer(),
                _ActionsButton(
                  actions: [
                    _MenuAction(key: 'details', label: 'View details', icon: LucideIcons.eye, onTap: onTap),
                    if (onViewProof != null)
                      _MenuAction(key: 'view-pop', label: 'View POP', icon: LucideIcons.fileText, onTap: onViewProof!),
                    if (canApprove)
                      _MenuAction(key: 'approve', label: 'Approve', icon: LucideIcons.thumbsUp, tone: _Tone.emerald, onTap: () {
                        if (t.paymentId != null) onApprove(t.paymentId!);
                      }),
                    if (canReject)
                      _MenuAction(key: 'reject', label: 'Reject', icon: LucideIcons.thumbsDown, tone: _Tone.red, onTap: onReject),
                    if (isPayment)
                      _MenuAction(key: 'comment', label: 'Comment', icon: LucideIcons.messageSquare, onTap: onComment),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

enum _Tone { ghost, emerald, red }

class _MenuAction {
  _MenuAction({
    required this.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.tone = _Tone.ghost,
  });
  final String key;
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final _Tone tone;
}

class _ActionsButton extends StatelessWidget {
  const _ActionsButton({required this.actions});
  final List<_MenuAction> actions;
  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Actions',
      icon: const Icon(LucideIcons.moreHorizontal, size: 18),
      onSelected: (key) {
        final a = actions.firstWhere((a) => a.key == key);
        a.onTap();
      },
      itemBuilder: (_) => [
        for (final a in actions)
          PopupMenuItem<String>(
            value: a.key,
            child: Row(
              children: [
                Icon(
                  a.icon,
                  size: 14,
                  color: switch (a.tone) {
                    _Tone.emerald => const Color(0xFF047857),
                    _Tone.red => const Color(0xFFB91C1C),
                    _Tone.ghost => AppColors.ink,
                  },
                ),
                const SizedBox(width: 8),
                Text(
                  a.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: switch (a.tone) {
                      _Tone.emerald => const Color(0xFF047857),
                      _Tone.red => const Color(0xFFB91C1C),
                      _Tone.ghost => AppColors.ink,
                    },
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.icon});
  final String label;
  final String value;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 12, color: AppColors.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
        ],
      ),
    );
  }
}

class _TxDetailSheet extends StatelessWidget {
  const _TxDetailSheet({required this.t, required this.onViewProof});
  final _Tx t;
  final void Function(String url, String title) onViewProof;
  @override
  Widget build(BuildContext context) {
    final created = DateTime.tryParse(t.createdAt);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('\$${t.amount}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.ink)),
                      Text(t.currency, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                    ],
                  ),
                  const Spacer(),
                  StatusPill(status: t.status, label: t.statusDisplay),
                ],
              ),
              const SizedBox(height: 16),
              _DetailRow(label: 'Matter', value: t.matterTitle),
              _DetailRow(label: 'Kind', value: t.kind == 'trust' ? 'Trust ledger' : 'Payment'),
              _DetailRow(label: 'Label', value: t.label),
              if (t.purpose != null) _DetailRow(label: 'Purpose', value: t.purpose!.replaceAll('_', ' ')),
              if (created != null)
                _DetailRow(label: 'Created', value: DateFormat('MMM d, y · HH:mm').format(created.toLocal())),
              if (t.kind == 'payment')
                _DetailRow(
                  label: 'Proof of payment',
                  child: t.proofUrl != null
                      ? TextButton.icon(
                          onPressed: () => onViewProof(t.proofUrl!, 'Proof of payment · ${t.label}'),
                          icon: const Icon(LucideIcons.externalLink, size: 14),
                          label: const Text('View'),
                          style: TextButton.styleFrom(padding: EdgeInsets.zero),
                        )
                      : Text(
                          t.hasProof ? 'Uploaded' : 'Not yet uploaded',
                          style: const TextStyle(fontSize: 13, color: AppColors.muted),
                        ),
                ),
              if (t.paymentId != null)
                _DetailRow(label: 'Reference', value: 'INV-${t.paymentId!.toString().padLeft(5, '0')}'),
              if (t.note != null && t.note!.isNotEmpty)
                _NoteBlock(label: 'Notes', body: t.note!),
              if (t.reviewNote != null && t.reviewNote!.isNotEmpty)
                _NoteBlock(label: 'Reviewer note', body: t.reviewNote!),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, this.value, this.child});
  final String label;
  final String? value;
  final Widget? child;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line, width: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label.toUpperCase(),
              style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.5),
            ),
          ),
          Flexible(
            child: child ?? Text(
              value ?? '',
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _NoteBlock extends StatelessWidget {
  const _NoteBlock({required this.label, required this.body});
  final String label;
  final String body;
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.canvas,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.5),
          ),
          const SizedBox(height: 4),
          Text(body, style: const TextStyle(fontSize: 12, color: AppColors.ink)),
        ],
      ),
    );
  }
}

/// Shows proof-of-payment files. Image URLs render inline; PDFs and other
/// non-image types are opened in the device's default viewer.
class _ProofViewer extends StatefulWidget {
  const _ProofViewer({required this.url, required this.title});
  final String url;
  final String title;

  @override
  State<_ProofViewer> createState() => _ProofViewerState();
}

class _ProofViewerState extends State<_ProofViewer> {
  bool _looksLikeImage(String url) {
    final u = url.toLowerCase();
    return u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.webp') || u.endsWith('.gif');
  }

  @override
  Widget build(BuildContext context) {
    final isImage = _looksLikeImage(widget.url);
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(color: AppColors.brand),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  icon: const Icon(LucideIcons.x, color: Colors.white),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: isImage
                ? InteractiveViewer(
                    child: Image.network(
                      widget.url,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const _FallbackOpen(),
                      loadingBuilder: (_, child, progress) {
                        if (progress == null) return child;
                        return const SizedBox(height: 160, child: Center(child: CircularProgressIndicator()));
                      },
                    ),
                  )
                : _OpenExternal(url: widget.url),
          ),
        ],
      ),
    );
  }
}

class _OpenExternal extends StatelessWidget {
  const _OpenExternal({required this.url});
  final String url;
  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(LucideIcons.fileText, size: 48, color: AppColors.muted),
        const SizedBox(height: 8),
        const Text(
          'Document attached',
          style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
        ),
        const SizedBox(height: 4),
        const Text(
          'Open in your device viewer to inspect the file.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: AppColors.muted),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: () async {
            final uri = Uri.parse(url);
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          },
          icon: const Icon(LucideIcons.externalLink, size: 16),
          label: const Text('Open document'),
        ),
      ],
    );
  }
}

class _FallbackOpen extends StatelessWidget {
  const _FallbackOpen();
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 20),
      child: Text(
        'Could not load preview.',
        style: TextStyle(color: AppColors.muted),
      ),
    );
  }
}
