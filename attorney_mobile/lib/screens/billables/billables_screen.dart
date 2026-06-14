import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/endpoints.dart';
import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mobile Billables — two tabs: By matter / Invoices.
///
/// "By matter" rolls each TimeEntry up to its parent matter and shows the
/// uninvoiced bucket, with a Generate invoice action that mirrors the web.
/// "Invoices" lists Payment rows with status filter + view-PDF launch.
class BillablesScreen extends ConsumerStatefulWidget {
  const BillablesScreen({super.key});

  @override
  ConsumerState<BillablesScreen> createState() => _BillablesScreenState();
}

enum _Range { last7, last30, all }

enum _InvStatus { all, paid, pending, rejected }

class _BillablesScreenState extends ConsumerState<BillablesScreen> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  late Future<_BillablesData> _load;
  _Range _range = _Range.last30;
  _InvStatus _invStatus = _InvStatus.all;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _load = _fetch();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<_BillablesData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final results = await Future.wait([
      ep.listTimeEntries(),
      ep.listPaymentInvoices(),
      ep.listMatters(),
    ]);
    return _BillablesData(
      entries: results[0] as List<Map<String, dynamic>>,
      invoices: results[1] as List<Map<String, dynamic>>,
      matters: results[2] as List<Matter>,
    );
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  DateTime get _cutoff {
    switch (_range) {
      case _Range.last7:
        return DateTime.now().subtract(const Duration(days: 7));
      case _Range.last30:
        return DateTime.now().subtract(const Duration(days: 30));
      case _Range.all:
        return DateTime.fromMillisecondsSinceEpoch(0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    if (me != null && !me.isLawyer) {
      // Gate to lawyers only (the web does router.replace('/dashboard')).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go(Routes.dashboard);
      });
      return const Scaffold(body: SizedBox.shrink());
    }
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('Billables'),
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.brandDark,
          labelColor: AppColors.brandDark,
          unselectedLabelColor: AppColors.muted,
          tabs: const [
            Tab(text: 'By matter'),
            Tab(text: 'Invoices'),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_BillablesData>(
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
            final data = snap.data!;
            return TabBarView(
              controller: _tabs,
              children: [
                _ByMatterTab(
                  data: data,
                  cutoff: _cutoff,
                  range: _range,
                  onRangeChange: (r) => setState(() => _range = r),
                  onGenerateInvoice: _generateInvoice,
                ),
                _InvoicesTab(
                  data: data,
                  cutoff: _cutoff,
                  range: _range,
                  onRangeChange: (r) => setState(() => _range = r),
                  invStatus: _invStatus,
                  onInvStatusChange: (s) => setState(() => _invStatus = s),
                  onView: _viewInvoicePdf,
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _generateInvoice(int matterId, double uninvoicedAmount) async {
    if (uninvoicedAmount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No un-invoiced billable time to bill yet.')),
      );
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Generate \$${uninvoicedAmount.toStringAsFixed(2)} invoice?'),
        content: const Text(
          'Only un-invoiced billable time on this matter will be included. '
          'The client will see this in the matter room and transactions list.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Create invoice')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(endpointsProvider).generateInvoice(matterId);
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Invoice raised — client notified in matter room.')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _viewInvoicePdf(int paymentId) async {
    final url = ref.read(endpointsProvider).invoicePdfUrl(paymentId);
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the invoice PDF.')),
      );
    }
  }
}

class _BillablesData {
  _BillablesData({required this.entries, required this.invoices, required this.matters});
  final List<Map<String, dynamic>> entries;
  final List<Map<String, dynamic>> invoices;
  final List<Matter> matters;
}

class _MatterGroup {
  _MatterGroup({required this.matterId, required this.title});
  final int matterId;
  final String title;
  final List<Map<String, dynamic>> entries = [];
  int minutes = 0;
  double amount = 0;
  int uninvoicedMinutes = 0;
  double uninvoicedAmount = 0;
}

class _ByMatterTab extends StatefulWidget {
  const _ByMatterTab({
    required this.data,
    required this.cutoff,
    required this.range,
    required this.onRangeChange,
    required this.onGenerateInvoice,
  });
  final _BillablesData data;
  final DateTime cutoff;
  final _Range range;
  final void Function(_Range r) onRangeChange;
  final Future<void> Function(int matterId, double uninvoicedAmount) onGenerateInvoice;

  @override
  State<_ByMatterTab> createState() => _ByMatterTabState();
}

class _ByMatterTabState extends State<_ByMatterTab> {
  final Set<int> _open = <int>{};

  @override
  Widget build(BuildContext context) {
    final entries = widget.data.entries.where((e) {
      final dt = DateTime.tryParse((e['started_at'] as String?) ?? '');
      if (dt == null) return false;
      return dt.isAfter(widget.cutoff) || widget.range == _Range.all;
    }).toList();

    final groups = <int, _MatterGroup>{};
    for (final e in entries) {
      final matterId = (e['matter'] as num?)?.toInt() ?? -1;
      final title = (e['matter_title'] as String?) ?? 'Matter #$matterId';
      final g = groups.putIfAbsent(matterId, () => _MatterGroup(matterId: matterId, title: title));
      g.entries.add(e);
      final m = (e['minutes'] as num?)?.toInt() ?? 0;
      g.minutes += m;
      final amt = double.tryParse((e['amount'] ?? '').toString()) ?? 0;
      g.amount += amt;
      if (e['invoice'] == null) {
        g.uninvoicedMinutes += m;
        g.uninvoicedAmount += amt;
      }
    }
    final ordered = groups.values.toList()
      ..sort((a, b) => b.uninvoicedAmount.compareTo(a.uninvoicedAmount));

    final grandMinutes = ordered.fold<int>(0, (s, g) => s + g.minutes);
    final grandAmount = ordered.fold<double>(0, (s, g) => s + g.amount);
    final paidTotal = widget.data.invoices
        .where((p) => (p['status'] as String?) == 'verified')
        .fold<double>(0, (s, p) => s + (double.tryParse((p['amount'] ?? '').toString()) ?? 0));

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(child: _StatCard(label: 'Logged', value: '${(grandMinutes / 60).toStringAsFixed(1)}h', sub: '$grandMinutes min', icon: LucideIcons.clock)),
            const SizedBox(width: 8),
            Expanded(child: _StatCard(label: 'Billable', value: '\$${grandAmount.toStringAsFixed(2)}', sub: '${ordered.length} matter${ordered.length == 1 ? '' : 's'}', icon: LucideIcons.fileText)),
            const SizedBox(width: 8),
            Expanded(
              child: _StatCard(
                label: 'Paid',
                value: '\$${paidTotal.toStringAsFixed(2)}',
                sub: '${widget.data.invoices.where((p) => p['status'] == 'verified').length} invoice${widget.data.invoices.where((p) => p['status'] == 'verified').length == 1 ? '' : 's'}',
                icon: LucideIcons.checkCircle2,
                tone: _StatTone.emerald,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _RangeChips(value: widget.range, onChange: widget.onRangeChange),
        const SizedBox(height: 12),
        if (ordered.isEmpty)
          const EmptyState(
            icon: LucideIcons.clock,
            title: 'No time in this range',
            subtitle: 'Log time on a matter to bill it.',
          )
        else
          for (final g in ordered) _MatterCard(
            group: g,
            isOpen: _open.contains(g.matterId),
            onToggle: () {
              setState(() {
                if (!_open.add(g.matterId)) _open.remove(g.matterId);
              });
            },
            onGenerate: () => widget.onGenerateInvoice(g.matterId, g.uninvoicedAmount),
          ),
      ],
    );
  }
}

class _MatterCard extends StatelessWidget {
  const _MatterCard({
    required this.group,
    required this.isOpen,
    required this.onToggle,
    required this.onGenerate,
  });
  final _MatterGroup group;
  final bool isOpen;
  final VoidCallback onToggle;
  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              child: Row(
                children: [
                  Icon(isOpen ? LucideIcons.chevronDown : LucideIcons.chevronRight, size: 18, color: AppColors.muted),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          group.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${group.entries.length} entries · ${(group.minutes / 60).toStringAsFixed(1)}h',
                          style: const TextStyle(fontSize: 11, color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '\$${group.uninvoicedAmount.toStringAsFixed(2)}',
                        style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.ink, fontSize: 16),
                      ),
                      if (group.uninvoicedAmount != group.amount)
                        Text(
                          'to invoice (of \$${group.amount.toStringAsFixed(2)})',
                          style: const TextStyle(fontSize: 9, color: AppColors.muted, letterSpacing: 0.3),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (isOpen) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final e in group.entries) _EntryRow(entry: e),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () => context.push(Routes.matter(group.matterId)),
                        child: const Text('Open matter →'),
                      ),
                      const Spacer(),
                      FilledButton.icon(
                        onPressed: group.uninvoicedAmount > 0 ? onGenerate : null,
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                        icon: const Icon(LucideIcons.receipt, size: 14),
                        label: Text(
                          group.uninvoicedAmount > 0
                              ? 'Generate (\$${group.uninvoicedAmount.toStringAsFixed(2)})'
                              : 'All invoiced',
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({required this.entry});
  final Map<String, dynamic> entry;
  @override
  Widget build(BuildContext context) {
    final desc = (entry['description'] as String?) ?? '';
    final minutes = (entry['minutes'] as num?)?.toInt() ?? 0;
    final amount = entry['amount']?.toString() ?? '—';
    final started = DateTime.tryParse((entry['started_at'] as String?) ?? '');
    final isRunning = entry['is_running'] == true;
    final invoiced = entry['invoice'] != null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 6,
              runSpacing: 4,
              children: [
                Text(
                  desc.isEmpty ? 'Billable work' : desc,
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
                if (isRunning)
                  const Text('• running', style: TextStyle(fontSize: 11, color: AppColors.brand)),
                if (invoiced)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: const Color(0xFFECFDF5),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text(
                      'INVOICED',
                      style: TextStyle(fontSize: 8, fontWeight: FontWeight.w700, color: Color(0xFF047857)),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${started != null ? DateFormat('MMM d').format(started.toLocal()) : ''} · ${minutes}m · \$$amount',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class _InvoicesTab extends StatelessWidget {
  const _InvoicesTab({
    required this.data,
    required this.cutoff,
    required this.range,
    required this.onRangeChange,
    required this.invStatus,
    required this.onInvStatusChange,
    required this.onView,
  });
  final _BillablesData data;
  final DateTime cutoff;
  final _Range range;
  final void Function(_Range r) onRangeChange;
  final _InvStatus invStatus;
  final void Function(_InvStatus s) onInvStatusChange;
  final Future<void> Function(int paymentId) onView;

  @override
  Widget build(BuildContext context) {
    final invoices = data.invoices.where((inv) {
      final dt = DateTime.tryParse((inv['created_at'] as String?) ?? '');
      if (dt == null) return true;
      if (range != _Range.all && dt.isBefore(cutoff)) return false;
      final status = (inv['status'] as String? ?? '').toLowerCase();
      switch (invStatus) {
        case _InvStatus.all:
          return true;
        case _InvStatus.paid:
          return status == 'verified';
        case _InvStatus.pending:
          return RegExp(r'pending|awaiting|review').hasMatch(status);
        case _InvStatus.rejected:
          return RegExp(r'rejected|failed').hasMatch(status);
      }
    }).toList()
      ..sort((a, b) => ((b['created_at'] as String?) ?? '').compareTo((a['created_at'] as String?) ?? ''));

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _RangeChips(value: range, onChange: onRangeChange),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final s in _InvStatus.values)
              ChoiceChip(
                label: Text(_invStatusLabel(s)),
                selected: invStatus == s,
                onSelected: (_) => onInvStatusChange(s),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (invoices.isEmpty)
          const EmptyState(
            icon: LucideIcons.receipt,
            title: 'No invoices match your filters',
            subtitle: 'Generate one from the By matter tab.',
          )
        else
          for (final inv in invoices) _InvoiceRow(inv: inv, onView: onView),
      ],
    );
  }

  String _invStatusLabel(_InvStatus s) {
    switch (s) {
      case _InvStatus.all:
        return 'All';
      case _InvStatus.paid:
        return 'Paid';
      case _InvStatus.pending:
        return 'Pending';
      case _InvStatus.rejected:
        return 'Rejected';
    }
  }
}

class _InvoiceRow extends StatelessWidget {
  const _InvoiceRow({required this.inv, required this.onView});
  final Map<String, dynamic> inv;
  final Future<void> Function(int paymentId) onView;

  @override
  Widget build(BuildContext context) {
    final id = (inv['id'] as num).toInt();
    final matterId = (inv['matter'] as num?)?.toInt() ?? 0;
    final amount = inv['amount']?.toString() ?? '0';
    final currency = (inv['currency'] as String?) ?? '';
    final status = (inv['status'] as String?) ?? '';
    final statusDisplay = (inv['status_display'] as String?) ?? status;
    final created = DateTime.tryParse((inv['created_at'] as String?) ?? '');
    return Container(
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
                      'INV-${id.toString().padLeft(5, '0')}',
                      style: const TextStyle(fontSize: 10, color: AppColors.muted, letterSpacing: 0.4),
                    ),
                    InkWell(
                      onTap: () => context.push(Routes.matter(matterId)),
                      child: Text(
                        'Matter #$matterId',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                '\$$amount',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink),
              ),
              const SizedBox(width: 4),
              Text(currency, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusPill(status: status, label: statusDisplay),
              const Spacer(),
              if (created != null)
                Text(
                  DateFormat('MMM d, y').format(created.toLocal()),
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: () => onView(id),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                ),
                icon: const Icon(LucideIcons.externalLink, size: 12),
                label: const Text('View PDF'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RangeChips extends StatelessWidget {
  const _RangeChips({required this.value, required this.onChange});
  final _Range value;
  final void Function(_Range r) onChange;
  @override
  Widget build(BuildContext context) {
    String label(_Range r) => switch (r) {
          _Range.last7 => 'Last 7d',
          _Range.last30 => 'Last 30d',
          _Range.all => 'All',
        };
    return Wrap(
      spacing: 6,
      children: [
        for (final r in _Range.values)
          ChoiceChip(
            label: Text(label(r)),
            selected: value == r,
            onSelected: (_) => onChange(r),
          ),
      ],
    );
  }
}

enum _StatTone { neutral, emerald }

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    this.sub,
    this.tone = _StatTone.neutral,
  });
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final _StatTone tone;

  @override
  Widget build(BuildContext context) {
    final isEmerald = tone == _StatTone.emerald;
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
              Icon(icon, size: 12, color: isEmerald ? const Color(0xFF047857) : AppColors.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: isEmerald ? const Color(0xFF047857) : AppColors.ink,
            ),
          ),
          if (sub != null)
            Text(sub!, style: const TextStyle(fontSize: 9, color: AppColors.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

