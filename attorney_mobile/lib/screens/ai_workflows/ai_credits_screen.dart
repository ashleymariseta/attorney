import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Lawyer-facing AI credits: balance, buyable packs, proof-of-payment upload,
/// and purchase history. Mirrors
/// `frontend/app/(app)/ai-workflows/credits/page.tsx`.
class AiCreditsScreen extends ConsumerStatefulWidget {
  const AiCreditsScreen({super.key});

  @override
  ConsumerState<AiCreditsScreen> createState() => _AiCreditsScreenState();
}

class _AiCreditsScreenState extends ConsumerState<AiCreditsScreen> {
  late Future<_CreditsData> _load;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<_CreditsData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final results = await Future.wait([
      ep.aiCreditAccount(),
      ep.listAiCreditPlans(),
      ep.listAiCreditOrders(),
    ]);
    return _CreditsData(
      account: results[0] as Map<String, dynamic>,
      plans: results[1] as List<Map<String, dynamic>>,
      orders: results[2] as List<Map<String, dynamic>>,
    );
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  String _fmt(num n) => NumberFormat.decimalPattern().format(n);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI Credits')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_CreditsData>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  Skeleton(height: 110, width: double.infinity),
                  SizedBox(height: 12),
                  Skeleton(height: 90, width: double.infinity),
                  SizedBox(height: 10),
                  Skeleton(height: 90, width: double.infinity),
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
            final account = data.account;
            final balance = (account['balance'] as num?) ?? 0;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _BalanceCard(
                  balance: balance,
                  ownerLabel: (account['owner_label'] as String?) ?? '',
                  granted: (account['lifetime_granted'] as num?) ?? 0,
                  spent: (account['lifetime_spent'] as num?) ?? 0,
                  fmt: _fmt,
                ),
                const SizedBox(height: 20),
                const _SectionLabel('Credit packs'),
                const SizedBox(height: 8),
                if (data.plans.isEmpty)
                  const Text('No credit packs are available right now.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13))
                else
                  for (final p in data.plans) _PlanCard(plan: p, fmt: _fmt, onBuy: () => _buy(p)),
                const SizedBox(height: 20),
                const _SectionLabel('Your purchases'),
                const SizedBox(height: 8),
                if (data.orders.isEmpty)
                  const Text('No purchases yet.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13))
                else
                  for (final o in data.orders) _OrderTile(order: o, fmt: _fmt),
                const SizedBox(height: 20),
                if ((account['transactions'] as List?)?.isNotEmpty ?? false) ...[
                  const _SectionLabel('Recent activity'),
                  const SizedBox(height: 8),
                  for (final t in (account['transactions'] as List).cast<Map<String, dynamic>>())
                    _LedgerTile(txn: t, fmt: _fmt),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _buy(Map<String, dynamic> plan) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _BuySheet(plan: plan, fmt: _fmt),
    );
    if (result == true) {
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Proof of payment submitted — credits unlock once an admin verifies it.'),
        ));
      }
    }
  }
}

class _CreditsData {
  _CreditsData({required this.account, required this.plans, required this.orders});
  final Map<String, dynamic> account;
  final List<Map<String, dynamic>> plans;
  final List<Map<String, dynamic>> orders;
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: AppColors.muted, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5),
      );
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.balance,
    required this.ownerLabel,
    required this.granted,
    required this.spent,
    required this.fmt,
  });
  final num balance;
  final String ownerLabel;
  final num granted;
  final num spent;
  final String Function(num) fmt;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.brandDark, AppColors.brand],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [
            Icon(LucideIcons.coins, color: Colors.white70, size: 14),
            SizedBox(width: 6),
            Text('CREDIT BALANCE',
                style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
          ]),
          const SizedBox(height: 6),
          Text('${fmt(balance)} credits',
              style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('$ownerLabel · ${fmt(granted)} granted · ${fmt(spent)} spent',
              style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.fmt, required this.onBuy});
  final Map<String, dynamic> plan;
  final String Function(num) fmt;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    final price = double.tryParse('${plan['price']}') ?? 0;
    final credits = (plan['token_credits'] as num?) ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${plan['name']}'.toUpperCase(),
                    style: const TextStyle(color: AppColors.brandDark, fontSize: 11, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text('${plan['currency']} ${price.toStringAsFixed(2)} · ${plan['period_display']}',
                    style: const TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Row(children: [
                  const Icon(LucideIcons.sparkles, size: 13, color: AppColors.brandDark),
                  const SizedBox(width: 4),
                  Text('${fmt(credits)} credits',
                      style: const TextStyle(color: AppColors.ink, fontSize: 13, fontWeight: FontWeight.w600)),
                ]),
                if ((plan['description'] as String?)?.isNotEmpty ?? false) ...[
                  const SizedBox(height: 4),
                  Text('${plan['description']}', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          FilledButton.icon(
            onPressed: onBuy,
            icon: const Icon(LucideIcons.fileUp, size: 15),
            label: const Text('Buy'),
          ),
        ],
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.fmt});
  final Map<String, dynamic> order;
  final String Function(num) fmt;

  @override
  Widget build(BuildContext context) {
    final created = DateTime.tryParse('${order['created_at']}');
    final when = created != null ? DateFormat('d MMM yyyy').format(created.toLocal()) : '';
    final price = double.tryParse('${order['amount']}') ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${order['plan_name']?.toString().isNotEmpty == true ? order['plan_name'] : 'Credit pack'}',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
                const SizedBox(height: 2),
                Text('$when · ${fmt((order['token_credits'] as num?) ?? 0)} credits · ${order['currency']} ${price.toStringAsFixed(2)}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 12)),
              ],
            ),
          ),
          StatusPill(
            status: '${order['status']}',
            label: '${order['status_display']}',
          ),
        ],
      ),
    );
  }
}

class _LedgerTile extends StatelessWidget {
  const _LedgerTile({required this.txn, required this.fmt});
  final Map<String, dynamic> txn;
  final String Function(num) fmt;

  @override
  Widget build(BuildContext context) {
    final amount = (txn['amount'] as num?) ?? 0;
    final created = DateTime.tryParse('${txn['created_at']}');
    final when = created != null ? DateFormat('d MMM').format(created.toLocal()) : '';
    final positive = amount >= 0;
    final note = (txn['note'] as String?) ?? '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$when · ${txn['kind_display']}${note.isNotEmpty ? ' · $note' : ''}',
              style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
            ),
          ),
          Text(
            '${positive ? '+' : ''}${fmt(amount)}',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: positive ? const Color(0xFF047857) : const Color(0xFFB91C1C),
            ),
          ),
        ],
      ),
    );
  }
}

class _BuySheet extends ConsumerStatefulWidget {
  const _BuySheet({required this.plan, required this.fmt});
  final Map<String, dynamic> plan;
  final String Function(num) fmt;

  @override
  ConsumerState<_BuySheet> createState() => _BuySheetState();
}

class _BuySheetState extends ConsumerState<_BuySheet> {
  static const _methods = ['ecocash', 'innbucks', 'bank', 'cash', 'other'];
  String _method = _methods.first;
  final _reference = TextEditingController();
  final _note = TextEditingController();
  PlatformFile? _file;
  bool _busy = false;

  @override
  void dispose() {
    _reference.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    if (picked != null && picked.files.isNotEmpty) {
      setState(() => _file = picked.files.first);
    }
  }

  Future<void> _submit() async {
    if (_file?.path == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Attach your proof of payment first.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(endpointsProvider).createAiCreditOrder(
            planId: widget.plan['id'] as int,
            filePath: _file!.path!,
            reference: _reference.text,
            method: _method,
            note: _note.text,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final price = double.tryParse('${widget.plan['price']}') ?? 0;
    final credits = (widget.plan['token_credits'] as num?) ?? 0;
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Buy ${widget.plan['name']}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(height: 4),
            Text(
              '${widget.plan['currency']} ${price.toStringAsFixed(2)} · ${widget.fmt(credits)} credits. '
              'Pay via your usual method, then upload the proof below.',
              style: const TextStyle(color: AppColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _pick,
              icon: const Icon(LucideIcons.upload, size: 16),
              label: Text(_file?.name ?? 'Choose a PDF or image…'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
                alignment: Alignment.centerLeft,
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _method,
              decoration: const InputDecoration(labelText: 'Method'),
              items: [
                for (final m in _methods)
                  DropdownMenuItem(value: m, child: Text(m[0].toUpperCase() + m.substring(1))),
              ],
              onChanged: (v) => setState(() => _method = v ?? _methods.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reference,
              decoration: const InputDecoration(labelText: 'Reference (txn ref)'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: _busy ? null : _submit,
                  icon: _busy
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(LucideIcons.fileUp, size: 16),
                  label: Text(_busy ? 'Submitting…' : 'Submit proof'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
