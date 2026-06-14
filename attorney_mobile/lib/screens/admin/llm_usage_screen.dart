import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors `frontend/app/(app)/admin/llm-usage/page.tsx`.
///
/// Per-user LLM usage list with pool quota bars + BYOK totals. Admin
/// callers see every tenant; non-admins see only their own row. Mobile
/// uses a card list instead of the desktop table.
class LlmUsageScreen extends ConsumerStatefulWidget {
  const LlmUsageScreen({super.key});

  @override
  ConsumerState<LlmUsageScreen> createState() => _LlmUsageScreenState();
}

class _LlmUsageScreenState extends ConsumerState<LlmUsageScreen> {
  Future<Map<String, dynamic>>? _load;
  final _search = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _isAdmin {
    final me = ref.read(authProvider).me;
    if (me == null) return false;
    return me.role == 'admin' || me.role == 'staff';
  }

  Future<Map<String, dynamic>> _fetch() {
    final ep = ref.read(endpointsProvider);
    return _isAdmin ? ep.llmUsageAll() : ep.llmUsageMe();
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('LLM usage')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<Map<String, dynamic>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  Skeleton(height: 60, width: double.infinity),
                  SizedBox(height: 10),
                  Skeleton(height: 80, width: double.infinity),
                  SizedBox(height: 10),
                  Skeleton(height: 80, width: double.infinity),
                ],
              );
            }
            if (snap.hasError) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [ErrorBanner(message: snap.error.toString())],
              );
            }
            final data = snap.data ?? const {};
            final isAdmin = _isAdmin;
            final monthStart = (data['month_start'] as String?) ?? '';
            final results =
                ((data['results'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final poolConfigured =
                (data['pool_configured'] as Map?)?.cast<String, dynamic>() ?? const {};
            final defaults =
                (data['defaults'] as Map?)?.cast<String, dynamic>() ?? const {};

            final filtered = _filter(results);
            final totals = _computeTotals(results);
            final start = DateTime.tryParse(monthStart);
            final sinceText = start != null ? 'Since ${DateFormat('d MMM').format(start.toLocal())}' : '';

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        isAdmin
                            ? 'Per-tenant attribution across the platform pool key and any BYOK configs.'
                            : 'Your own current-month spend on the platform pool and any keys you’ve added.',
                        style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
                      ),
                    ),
                    if (sinceText.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Text(
                          sinceText,
                          style: const TextStyle(color: AppColors.muted, fontSize: 11),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                // Pool status row.
                if (data.isNotEmpty)
                  Row(
                    children: [
                      Expanded(
                        child: _PoolStatus(
                          label: 'Anthropic pool',
                          icon: LucideIcons.sparkles,
                          configured: poolConfigured['anthropic'] as bool? ?? false,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _PoolStatus(
                          label: 'OpenAI pool',
                          icon: LucideIcons.sparkles,
                          configured: poolConfigured['openai'] as bool? ?? false,
                        ),
                      ),
                    ],
                  ),
                if (data.isNotEmpty) const SizedBox(height: 8),
                if (data.isNotEmpty)
                  Row(
                    children: [
                      Expanded(
                        child: _PoolStatus(
                          label: 'Local pool',
                          icon: LucideIcons.database,
                          configured: poolConfigured['local'] as bool? ?? false,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _StatTile(
                          label: 'Defaults',
                          value: '${_fmt((defaults['monthly_quota'] as num?)?.toInt() ?? 0)} tk',
                          sub: '${(defaults['rate_limit_per_minute'] as num?)?.toInt() ?? 0}/min',
                          icon: LucideIcons.shield,
                        ),
                      ),
                    ],
                  ),
                if (isAdmin) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: _StatTile(
                          label: 'Active users',
                          value: '${totals.users}',
                          icon: LucideIcons.key,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _StatTile(
                          label: 'Pool tokens',
                          value: _fmt(totals.pool),
                          icon: LucideIcons.wallet,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: _StatTile(
                          label: 'BYOK tokens',
                          value: _fmt(totals.byok),
                          icon: LucideIcons.landmark,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _StatTile(
                          label: 'Over quota',
                          value: '${totals.overQuota}',
                          sub: 'users',
                          icon: LucideIcons.alertCircle,
                          tone: totals.overQuota > 0 ? _Tone.amber : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _search,
                    onChanged: (v) => setState(() => _query = v),
                    decoration: const InputDecoration(
                      labelText: 'Search by name, email, role…',
                      prefixIcon: Icon(LucideIcons.search, size: 18),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                if (results.isEmpty)
                  const EmptyState(
                    icon: LucideIcons.barChart3,
                    title: 'No LLM activity this month yet',
                  )
                else if (filtered.isEmpty)
                  const EmptyState(
                    icon: LucideIcons.searchX,
                    title: 'No matches',
                    subtitle: 'Try a different search term.',
                  )
                else
                  for (final r in filtered) _UsageRowTile(row: r),
              ],
            );
          },
        ),
      ),
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> rows) {
    final term = _query.trim().toLowerCase();
    if (term.isEmpty) return rows;
    return rows.where((r) {
      final s = [
        r['full_name'] ?? '',
        r['email'] ?? '',
        r['role'] ?? '',
      ].join(' ').toString().toLowerCase();
      return s.contains(term);
    }).toList();
  }

  _Totals _computeTotals(List<Map<String, dynamic>> rows) {
    var pool = 0;
    var byok = 0;
    var overQuota = 0;
    for (final r in rows) {
      final p = (r['pool_tokens'] as num?)?.toInt() ?? 0;
      final b = (r['byok_tokens'] as num?)?.toInt() ?? 0;
      final quota = (r['monthly_quota'] as num?)?.toInt() ?? 0;
      pool += p;
      byok += b;
      if (quota > 0 && p >= quota) overQuota += 1;
    }
    return _Totals(pool: pool, byok: byok, users: rows.length, overQuota: overQuota);
  }
}

class _Totals {
  _Totals({required this.pool, required this.byok, required this.users, required this.overQuota});
  final int pool;
  final int byok;
  final int users;
  final int overQuota;
}

enum _Tone { amber }

String _fmt(int n) => NumberFormat.decimalPattern().format(n);

class _UsageRowTile extends StatelessWidget {
  const _UsageRowTile({required this.row});
  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final fullName = (row['full_name'] as String?) ?? '';
    final email = (row['email'] as String?) ?? '';
    final role = (row['role'] as String?) ?? '';
    final pool = (row['pool_tokens'] as num?)?.toInt() ?? 0;
    final quota = (row['monthly_quota'] as num?)?.toInt() ?? 0;
    final byok = (row['byok_tokens'] as num?)?.toInt() ?? 0;
    final rateLimit = (row['rate_limit_per_minute'] as num?)?.toInt() ?? 0;
    final poolDisabled = row['pool_disabled'] as bool? ?? false;
    final lastUsed = (row['last_used'] as String?) ?? '';
    final lastUsedDt = DateTime.tryParse(lastUsed);
    final lastUsedText =
        lastUsedDt != null ? DateFormat('d MMM HH:mm').format(lastUsedDt.toLocal()) : '—';
    final pct = quota <= 0 ? 0 : (pool / quota * 100).clamp(0, 100).round();
    final overUsed = pct >= 100;
    final barColor = overUsed
        ? Colors.red.shade500
        : pct >= 80
            ? Colors.amber.shade600
            : AppColors.brandDark;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      fullName.isEmpty ? email : fullName,
                      style: const TextStyle(
                          color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 14),
                    ),
                    if (email.isNotEmpty)
                      Text(email,
                          style: const TextStyle(color: AppColors.muted, fontSize: 11)),
                  ],
                ),
              ),
              if (role.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Text(
                    role.toUpperCase(),
                    style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 9,
                        letterSpacing: 0.5,
                        fontWeight: FontWeight.w700),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              minHeight: 6,
              value: quota > 0 ? (pool / quota).clamp(0, 1) : 0,
              backgroundColor: AppColors.line,
              valueColor: AlwaysStoppedAnimation<Color>(barColor),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Text(
                _fmt(pool),
                style: TextStyle(
                  color: overUsed ? const Color(0xFFB91C1C) : AppColors.ink,
                  fontWeight: FontWeight.w700,
                  fontSize: 12.5,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                ' / ${_fmt(quota)} pool',
                style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
              ),
              const Spacer(),
              if (poolDisabled)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.x, size: 10, color: Color(0xFF334155)),
                      SizedBox(width: 2),
                      Text('POOL DISABLED',
                          style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF334155))),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: _MiniStat(label: 'BYOK', value: _fmt(byok)),
              ),
              Expanded(
                child: _MiniStat(label: 'Rate/min', value: '$rateLimit'),
              ),
              Expanded(
                child: _MiniStat(label: 'Last call', value: lastUsedText),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
              color: AppColors.muted,
              fontSize: 9.5,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 2),
        Text(value,
            style: const TextStyle(
                color: AppColors.ink, fontSize: 12.5, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.icon,
    this.sub,
    this.tone,
  });
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final _Tone? tone;

  @override
  Widget build(BuildContext context) {
    final valueColor = tone == _Tone.amber ? const Color(0xFF92400E) : AppColors.ink;
    return Container(
      padding: const EdgeInsets.all(12),
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
              Icon(icon, size: 11, color: AppColors.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 9.5,
                      letterSpacing: 0.5,
                      fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                color: valueColor,
                fontWeight: FontWeight.w800,
                fontSize: 15,
              )),
          if (sub != null)
            Text(sub!, style: const TextStyle(color: AppColors.muted, fontSize: 10)),
        ],
      ),
    );
  }
}

class _PoolStatus extends StatelessWidget {
  const _PoolStatus({
    required this.label,
    required this.icon,
    required this.configured,
  });
  final String label;
  final IconData icon;
  final bool configured;

  @override
  Widget build(BuildContext context) {
    final color = configured ? const Color(0xFF047857) : AppColors.muted;
    return Container(
      padding: const EdgeInsets.all(12),
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
              Icon(icon, size: 11, color: AppColors.muted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 9.5,
                      letterSpacing: 0.5,
                      fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                configured ? LucideIcons.checkCircle2 : LucideIcons.x,
                size: 14,
                color: color,
              ),
              const SizedBox(width: 4),
              Text(
                configured ? 'Active' : 'Not set',
                style: TextStyle(
                    color: color, fontWeight: FontWeight.w800, fontSize: 13),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
