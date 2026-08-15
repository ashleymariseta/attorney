import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Lawyer-only CRM. Mirrors frontend/app/(app)/clients/page.tsx.
///
/// Lists all clients the current lawyer has worked with, with search,
/// sort, summary stats and an inline tab-style detail sheet.
class ClientsScreen extends ConsumerStatefulWidget {
  const ClientsScreen({super.key});

  @override
  ConsumerState<ClientsScreen> createState() => _ClientsScreenState();
}

enum _SortKey { name, matters, outstanding, invoiced, lastActivity }

class _ClientsScreenState extends ConsumerState<ClientsScreen> {
  late Future<List<Map<String, dynamic>>> _load;
  final _search = TextEditingController();
  _SortKey _sort = _SortKey.name;

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

  Future<List<Map<String, dynamic>>> _fetch() async {
    return ref.read(endpointsProvider).listLawyerClients();
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  List<Map<String, dynamic>> _applyFilters(List<Map<String, dynamic>> src) {
    final term = _search.text.trim().toLowerCase();
    final list = term.isEmpty
        ? List<Map<String, dynamic>>.from(src)
        : src.where((c) {
            final hay = [
              c['full_name'] ?? '',
              c['email'] ?? '',
              c['phone_number'] ?? '',
              c['whatsapp_number'] ?? '',
            ].join(' ').toLowerCase();
            return hay.contains(term);
          }).toList();

    int parseDate(String? s) {
      if (s == null || s.isEmpty) return 0;
      return DateTime.tryParse(s)?.millisecondsSinceEpoch ?? 0;
    }

    list.sort((a, b) {
      switch (_sort) {
        case _SortKey.matters:
          return ((b['matters_count'] as num?)?.toInt() ?? 0).compareTo(
            (a['matters_count'] as num?)?.toInt() ?? 0,
          );
        case _SortKey.outstanding:
          return (double.tryParse('${b['outstanding_total'] ?? 0}') ?? 0)
              .compareTo(
                double.tryParse('${a['outstanding_total'] ?? 0}') ?? 0,
              );
        case _SortKey.invoiced:
          return (double.tryParse('${b['invoiced_total'] ?? 0}') ?? 0)
              .compareTo(double.tryParse('${a['invoiced_total'] ?? 0}') ?? 0);
        case _SortKey.lastActivity:
          return parseDate(
            b['last_consultation_at'] as String?,
          ).compareTo(parseDate(a['last_consultation_at'] as String?));
        case _SortKey.name:
          return ('${a['full_name'] ?? ''}').toLowerCase().compareTo(
            ('${b['full_name'] ?? ''}').toLowerCase(),
          );
      }
    });
    return list;
  }

  void _openDetail(int clientId) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ClientDetailSheet(clientId: clientId),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () =>
              ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('Clients'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting &&
                !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  Skeleton(height: 70, width: double.infinity),
                  SizedBox(height: 12),
                  Skeleton(height: 50, width: double.infinity),
                  SizedBox(height: 12),
                  Skeleton(height: 60, width: double.infinity),
                  SizedBox(height: 8),
                  Skeleton(height: 60, width: double.infinity),
                ],
              );
            }
            if (snap.hasError) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [ErrorBanner(message: snap.error.toString())],
              );
            }
            final clients = snap.data ?? const <Map<String, dynamic>>[];
            final filtered = _applyFilters(clients);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                _intro(),
                const SizedBox(height: 14),
                _StatStrip(clients: clients),
                const SizedBox(height: 14),
                _toolbar(),
                const SizedBox(height: 12),
                if (filtered.isEmpty)
                  const EmptyState(
                    icon: LucideIcons.users,
                    title: 'No clients yet',
                    subtitle:
                        'Clients appear here once you create a matter for them or accept a retainer.',
                  )
                else
                  for (final c in filtered)
                    _ClientRow(
                      client: c,
                      onTap: () => _openDetail((c['id'] as num).toInt()),
                    ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _intro() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        Text(
          'Your book of business',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
        SizedBox(height: 2),
        Text(
          'Every client you’ve worked with, their contact details and outstanding balance.',
          style: TextStyle(fontSize: 12, color: AppColors.muted),
        ),
      ],
    );
  }

  Widget _toolbar() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'Search by name, email, phone…',
            prefixIcon: const Icon(
              LucideIcons.search,
              size: 18,
              color: AppColors.muted,
            ),
            suffixIcon: _search.text.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(LucideIcons.x, size: 16),
                    onPressed: () {
                      _search.clear();
                      setState(() {});
                    },
                  ),
          ),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: DropdownButtonHideUnderline(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.line),
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: DropdownButton<_SortKey>(
                value: _sort,
                isDense: true,
                style: const TextStyle(fontSize: 13, color: AppColors.ink),
                items: const [
                  DropdownMenuItem(
                    value: _SortKey.name,
                    child: Text('Sort · Name'),
                  ),
                  DropdownMenuItem(
                    value: _SortKey.matters,
                    child: Text('Sort · Most matters'),
                  ),
                  DropdownMenuItem(
                    value: _SortKey.outstanding,
                    child: Text('Sort · Outstanding'),
                  ),
                  DropdownMenuItem(
                    value: _SortKey.invoiced,
                    child: Text('Sort · Invoiced'),
                  ),
                  DropdownMenuItem(
                    value: _SortKey.lastActivity,
                    child: Text('Sort · Last activity'),
                  ),
                ],
                onChanged: (v) => setState(() => _sort = v ?? _SortKey.name),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

String _money(dynamic value) {
  final n = double.tryParse('${value ?? 0}') ?? 0;
  if (!n.isFinite) return '\$0';
  final formatter = NumberFormat.currency(
    symbol: '\$',
    decimalDigits: n == n.truncate() ? 0 : 2,
  );
  return formatter.format(n);
}

String _initials(Map<String, dynamic> c) {
  final f = (c['first_name'] as String? ?? '').trim();
  final l = (c['last_name'] as String? ?? '').trim();
  if (f.isEmpty && l.isEmpty) {
    final full = (c['full_name'] as String? ?? '').trim();
    return full.isEmpty ? '?' : full[0].toUpperCase();
  }
  return '${f.isEmpty ? '?' : f[0]}${l.isEmpty ? '' : l[0]}'.toUpperCase();
}

class _StatStrip extends StatelessWidget {
  const _StatStrip({required this.clients});
  final List<Map<String, dynamic>> clients;

  @override
  Widget build(BuildContext context) {
    final retainer = clients
        .where((c) => c['relationship'] == 'retainer')
        .length;
    final outstanding = clients.fold<double>(
      0,
      (s, c) => s + (double.tryParse('${c['outstanding_total'] ?? 0}') ?? 0),
    );
    final invoiced = clients.fold<double>(
      0,
      (s, c) => s + (double.tryParse('${c['invoiced_total'] ?? 0}') ?? 0),
    );
    return GridView.count(
      crossAxisCount: 2,
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 2.0,
      children: [
        _StatTile(
          label: 'Clients',
          value: '${clients.length}',
          icon: LucideIcons.users,
        ),
        _StatTile(
          label: 'On retainer',
          sub: 'active',
          value: '$retainer',
          icon: LucideIcons.shield,
        ),
        _StatTile(
          label: 'Outstanding',
          value: _money(outstanding),
          icon: LucideIcons.wallet,
          tone: _StatTone.amber,
        ),
        _StatTile(
          label: 'Invoiced (lifetime)',
          value: _money(invoiced),
          icon: LucideIcons.receipt,
        ),
      ],
    );
  }
}

enum _StatTone { normal, amber }

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.icon,
    this.sub,
    this.tone = _StatTone.normal,
  });
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final _StatTone tone;

  @override
  Widget build(BuildContext context) {
    final color = tone == _StatTone.amber
        ? const Color(0xFFB45309)
        : AppColors.ink;
    return Container(
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Stack(
        children: [
          // Tilted, enlarged watermark icon (home-screen stat pattern).
          DecoIcon(icon: icon, size: 64),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 11, color: AppColors.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        label.toUpperCase(),
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
                if (sub != null)
                  Text(
                    sub!,
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.muted,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ClientRow extends StatelessWidget {
  const _ClientRow({required this.client, required this.onTap});
  final Map<String, dynamic> client;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fullName = client['full_name'] as String? ?? '';
    final email = client['email'] as String? ?? '';
    final phone = client['phone_number'] as String? ?? '';
    final whatsapp = client['whatsapp_number'] as String? ?? '';
    final isRetainer = client['relationship'] == 'retainer';
    final invoiced = client['invoiced_total'];
    final outstanding = client['outstanding_total'];
    final outstandingValue = double.tryParse('${outstanding ?? 0}') ?? 0;
    final mattersCount = (client['matters_count'] as num?)?.toInt() ?? 0;
    final activeCount = (client['active_matters_count'] as num?)?.toInt() ?? 0;
    final lastConsultRaw = client['last_consultation_at'] as String?;
    final lastConsult = lastConsultRaw == null
        ? '—'
        : (DateTime.tryParse(lastConsultRaw) != null
              ? DateFormat(
                  'd MMM yyyy',
                ).format(DateTime.parse(lastConsultRaw).toLocal())
              : '—');

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: AppColors.cardTint,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Dark-teal header band — avatar + name/email above the line.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppColors.brandDark, AppColors.brand],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Row(
                children: [
                  _Avatar(client: client, size: 38),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                fullName,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            if (isRetainer) ...[
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 1,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.18),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: const Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      LucideIcons.award,
                                      size: 9,
                                      color: Colors.white,
                                    ),
                                    SizedBox(width: 3),
                                    Text(
                                      'RETAINER',
                                      style: TextStyle(
                                        fontSize: 9,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.white,
                                        letterSpacing: 0.4,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          email,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.white.withValues(alpha: 0.85),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    LucideIcons.chevronRight,
                    size: 18,
                    color: Colors.white.withValues(alpha: 0.85),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Quick contact row.
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          phone.isEmpty ? '—' : phone,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                      if (whatsapp.isNotEmpty && whatsapp != phone) ...[
                        const Icon(
                          LucideIcons.messageSquare,
                          size: 11,
                          color: Color(0xFF059669),
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            whatsapp,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              color: Color(0xFF047857),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 10),
                  // Metric strip.
                  Row(
                    children: [
                      Expanded(
                        child: _Metric(
                          label: 'Matters',
                          value: '$mattersCount',
                          sub: '$activeCount active',
                        ),
                      ),
                      Expanded(
                        child: _Metric(
                          label: 'Invoiced',
                          value: _money(invoiced),
                        ),
                      ),
                      Expanded(
                        child: _Metric(
                          label: 'Outstanding',
                          value: _money(outstanding),
                          tone: outstandingValue > 0
                              ? _StatTone.amber
                              : _StatTone.normal,
                        ),
                      ),
                      Expanded(
                        child: _Metric(
                          label: 'Last',
                          value: lastConsult,
                          small: true,
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
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    this.sub,
    this.tone = _StatTone.normal,
    this.small = false,
  });
  final String label;
  final String value;
  final String? sub;
  final _StatTone tone;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final color = tone == _StatTone.amber
        ? const Color(0xFFB45309)
        : AppColors.ink;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: small ? 11 : 13,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        if (sub != null)
          Text(
            sub!,
            style: const TextStyle(fontSize: 9, color: AppColors.muted),
          ),
      ],
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.client, this.size = 40});
  final Map<String, dynamic> client;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = client['avatar_url'] as String?;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.brandLight.withValues(alpha: 0.5),
        shape: BoxShape.circle,
      ),
      clipBehavior: Clip.antiAlias,
      child: url != null && url.isNotEmpty
          ? Image.network(
              url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => _avatarText(),
            )
          : _avatarText(),
    );
  }

  Widget _avatarText() {
    return Text(
      _initials(client),
      style: TextStyle(
        fontWeight: FontWeight.w800,
        color: AppColors.brandDark,
        fontSize: size * 0.32,
      ),
    );
  }
}

/* -------------------------- Detail sheet -------------------------- */

enum _Tab { overview, matters, invoices, consultations }

class _ClientDetailSheet extends ConsumerStatefulWidget {
  const _ClientDetailSheet({required this.clientId});
  final int clientId;

  @override
  ConsumerState<_ClientDetailSheet> createState() => _ClientDetailSheetState();
}

class _ClientDetailSheetState extends ConsumerState<_ClientDetailSheet> {
  late Future<Map<String, dynamic>> _load;
  _Tab _tab = _Tab.overview;

  @override
  void initState() {
    super.initState();
    _load = ref.read(endpointsProvider).getLawyerClient(widget.clientId);
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      minChildSize: 0.4,
      maxChildSize: 0.96,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: FutureBuilder<Map<String, dynamic>>(
            future: _load,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return _buildShell(
                  scrollController,
                  client: const {},
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: const [
                        Skeleton(height: 80, width: double.infinity),
                        SizedBox(height: 12),
                        Skeleton(height: 60, width: double.infinity),
                        SizedBox(height: 12),
                        Skeleton(height: 60, width: double.infinity),
                      ],
                    ),
                  ),
                );
              }
              if (snap.hasError) {
                return _buildShell(
                  scrollController,
                  client: const {},
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: ErrorBanner(message: snap.error.toString()),
                  ),
                );
              }
              final data = snap.data!;
              final client =
                  (data['client'] as Map?)?.cast<String, dynamic>() ?? const {};
              return _buildShell(
                scrollController,
                client: client,
                child: _buildDetailBody(data, client, scrollController),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildShell(
    ScrollController scrollController, {
    required Map<String, dynamic> client,
    required Widget child,
  }) {
    final fullName = client['full_name'] as String? ?? 'Loading…';
    final email = client['email'] as String? ?? '';
    return Column(
      children: [
        // Grab handle.
        Container(
          width: 40,
          height: 4,
          margin: const EdgeInsets.only(top: 8, bottom: 6),
          decoration: BoxDecoration(
            color: AppColors.line,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        // Header.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.brandDark, AppColors.brand],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Row(
            children: [
              _Avatar(client: client, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      fullName,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      email,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.white.withValues(alpha: 0.85),
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(LucideIcons.x, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }

  Widget _buildDetailBody(
    Map<String, dynamic> data,
    Map<String, dynamic> client,
    ScrollController scrollController,
  ) {
    final summary =
        (data['summary'] as Map?)?.cast<String, dynamic>() ?? const {};
    final matters = ((data['matters'] as List?) ?? const [])
        .cast<Map<String, dynamic>>();
    final payments = ((data['payments'] as List?) ?? const [])
        .cast<Map<String, dynamic>>();
    final consultations = ((data['consultations'] as List?) ?? const [])
        .cast<Map<String, dynamic>>();

    final outstandingValue =
        double.tryParse('${summary['outstanding_total'] ?? 0}') ?? 0;

    return ListView(
      controller: scrollController,
      padding: EdgeInsets.zero,
      children: [
        // Stat strip.
        Container(
          color: AppColors.canvas,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: _DrawerStat(
                  label: 'Matters',
                  value: '${summary['matters_count'] ?? 0}',
                  sub: '${summary['active_matters_count'] ?? 0} active',
                ),
              ),
              Expanded(
                child: _DrawerStat(
                  label: 'Invoiced',
                  value: _money(summary['invoiced_total']),
                ),
              ),
              Expanded(
                child: _DrawerStat(
                  label: 'Outstanding',
                  value: _money(summary['outstanding_total']),
                  tone: outstandingValue > 0
                      ? _StatTone.amber
                      : _StatTone.normal,
                ),
              ),
              Expanded(
                child: _DrawerStat(
                  label: 'Paid',
                  value: _money(summary['paid_total']),
                ),
              ),
            ],
          ),
        ),
        // Contact card.
        Container(
          color: AppColors.surface,
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'CONTACT',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 8),
              _ContactLine(
                icon: LucideIcons.mail,
                label: 'Email',
                value: client['email'] as String?,
                onTap: () => _launch('mailto:${client['email']}'),
              ),
              _ContactLine(
                icon: LucideIcons.phone,
                label: 'Phone',
                value: client['phone_number'] as String?,
                onTap: () => _launch('tel:${client['phone_number']}'),
              ),
              if ((client['whatsapp_number'] as String?)?.isNotEmpty == true)
                _ContactLine(
                  icon: LucideIcons.messageSquare,
                  label: 'WhatsApp',
                  value: client['whatsapp_number'] as String?,
                  onTap: () {
                    final num = (client['whatsapp_number'] as String? ?? '')
                        .replaceAll(RegExp(r'[^0-9]'), '');
                    if (num.isNotEmpty) _launch('https://wa.me/$num');
                  },
                ),
            ],
          ),
        ),
        // Tabs.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(top: BorderSide(color: AppColors.line)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _TabChip(
                  label: 'Overview',
                  selected: _tab == _Tab.overview,
                  onTap: () => setState(() => _tab = _Tab.overview),
                ),
                _TabChip(
                  label: 'Matters',
                  count: matters.length,
                  selected: _tab == _Tab.matters,
                  onTap: () => setState(() => _tab = _Tab.matters),
                ),
                _TabChip(
                  label: 'Invoices',
                  count: payments.length,
                  selected: _tab == _Tab.invoices,
                  onTap: () => setState(() => _tab = _Tab.invoices),
                ),
                _TabChip(
                  label: 'Consultations',
                  count: consultations.length,
                  selected: _tab == _Tab.consultations,
                  onTap: () => setState(() => _tab = _Tab.consultations),
                ),
              ],
            ),
          ),
        ),
        const Divider(height: 1),
        // Tab body.
        Container(
          color: AppColors.canvas,
          padding: const EdgeInsets.all(14),
          child: switch (_tab) {
            _Tab.overview => _OverviewTab(
              matters: matters,
              consultations: consultations,
              payments: payments,
              onSwitch: (t) => setState(() => _tab = t),
            ),
            _Tab.matters => _MattersTab(matters: matters),
            _Tab.invoices => _InvoicesTab(payments: payments),
            _Tab.consultations => _ConsultationsTab(
              consultations: consultations,
            ),
          },
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  Future<void> _launch(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      /* best-effort */
    }
  }
}

class _DrawerStat extends StatelessWidget {
  const _DrawerStat({
    required this.label,
    required this.value,
    this.sub,
    this.tone = _StatTone.normal,
  });
  final String label;
  final String value;
  final String? sub;
  final _StatTone tone;

  @override
  Widget build(BuildContext context) {
    final color = tone == _StatTone.amber
        ? const Color(0xFFB45309)
        : AppColors.ink;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
          if (sub != null)
            Text(
              sub!,
              style: const TextStyle(fontSize: 9, color: AppColors.muted),
            ),
        ],
      ),
    );
  }
}

class _ContactLine extends StatelessWidget {
  const _ContactLine({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });
  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (value == null || value!.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
              letterSpacing: 0.5,
            ),
          ),
          const Spacer(),
          InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 13, color: AppColors.muted),
                  const SizedBox(width: 6),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 220),
                    child: Text(
                      value!,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.brandDark,
                      ),
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

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.count,
  });
  final String label;
  final bool selected;
  final int? count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 2),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? AppColors.brandDark : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: selected ? AppColors.brandDark : AppColors.muted,
              ),
            ),
            if (count != null) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: selected ? AppColors.brandDark : AppColors.canvas,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: selected ? Colors.white : AppColors.muted,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.icon,
    required this.title,
    required this.child,
  });
  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
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
              Icon(icon, size: 12, color: AppColors.muted),
              const SizedBox(width: 6),
              Text(
                title.toUpperCase(),
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          child,
        ],
      ),
    );
  }
}

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({
    required this.matters,
    required this.consultations,
    required this.payments,
    required this.onSwitch,
  });
  final List<Map<String, dynamic>> matters;
  final List<Map<String, dynamic>> consultations;
  final List<Map<String, dynamic>> payments;
  final ValueChanged<_Tab> onSwitch;

  @override
  Widget build(BuildContext context) {
    final latest = matters.isEmpty ? null : matters.first;
    final now = DateTime.now();
    final nextConsult = consultations.firstWhere((c) {
      final dt = DateTime.tryParse(c['scheduled_time'] as String? ?? '');
      return dt != null && !dt.isBefore(now) && c['status'] != 'cancelled';
    }, orElse: () => const <String, dynamic>{});
    final pendingInvoices = payments.where((p) {
      final s = p['status'] as String? ?? '';
      return s != 'verified' && s != 'rejected';
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (latest != null)
          _Section(
            icon: LucideIcons.briefcase,
            title: 'Latest matter',
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        latest['title'] as String? ?? '',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${_shortDate(latest['created_at'] as String?)} · ${latest['status'] ?? ''}',
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                TextButton.icon(
                  onPressed: () {
                    Navigator.of(context).pop();
                    context.push(Routes.matter((latest['id'] as num).toInt()));
                  },
                  icon: const Icon(LucideIcons.externalLink, size: 14),
                  label: const Text('Open'),
                ),
              ],
            ),
          )
        else
          const _Section(
            icon: LucideIcons.briefcase,
            title: 'No matters yet',
            child: Text(
              'Open a matter from this client’s contact card to get started.',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
        if (nextConsult.isNotEmpty)
          _Section(
            icon: LucideIcons.calendar,
            title: 'Next consultation',
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        nextConsult['matter_title'] as String? ?? '',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${_consultWhen(nextConsult['scheduled_time'] as String?)} · ${nextConsult['mode_display'] ?? ''}',
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                StatusPill(
                  status: nextConsult['status'] as String? ?? '',
                  label: nextConsult['status_display'] as String?,
                ),
              ],
            ),
          ),
        if (pendingInvoices.isNotEmpty)
          _Section(
            icon: LucideIcons.wallet,
            title:
                '${pendingInvoices.length} outstanding invoice${pendingInvoices.length == 1 ? '' : 's'}',
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => onSwitch(_Tab.invoices),
                icon: const Icon(LucideIcons.externalLink, size: 14),
                label: const Text('Review them'),
              ),
            ),
          ),
      ],
    );
  }
}

class _MattersTab extends StatelessWidget {
  const _MattersTab({required this.matters});
  final List<Map<String, dynamic>> matters;

  @override
  Widget build(BuildContext context) {
    if (matters.isEmpty) {
      return const Text(
        'No matters yet.',
        style: TextStyle(fontSize: 12, color: AppColors.muted),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final m in matters)
          InkWell(
            onTap: () {
              Navigator.of(context).pop();
              context.push(Routes.matter((m['id'] as num).toInt()));
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              margin: const EdgeInsets.only(bottom: 8),
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
                      Expanded(
                        child: Text(
                          m['title'] as String? ?? '',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      StatusPill(status: m['status'] as String? ?? ''),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_shortDate(m['created_at'] as String?)} · ${m['practice_area'] ?? 'general'} · ${m['billing_model'] ?? ''}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.muted,
                    ),
                  ),
                  if ((m['description'] as String?)?.isNotEmpty == true) ...[
                    const SizedBox(height: 6),
                    Text(
                      m['description'] as String,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _InvoicesTab extends StatelessWidget {
  const _InvoicesTab({required this.payments});
  final List<Map<String, dynamic>> payments;

  @override
  Widget build(BuildContext context) {
    if (payments.isEmpty) {
      return const Text(
        'No invoices yet.',
        style: TextStyle(fontSize: 12, color: AppColors.muted),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [for (final p in payments) _InvoiceRow(payment: p)],
    );
  }
}

class _InvoiceRow extends StatelessWidget {
  const _InvoiceRow({required this.payment});
  final Map<String, dynamic> payment;

  @override
  Widget build(BuildContext context) {
    final amount = double.tryParse('${payment['amount'] ?? 0}') ?? 0;
    final currency = payment['currency'] as String? ?? '';
    final invoiceNum =
        'INV-${(payment['id'] as num?)?.toInt().toString().padLeft(5, '0') ?? '00000'}';
    final matterTitle = payment['matter_title'] as String? ?? '';
    final purpose = (payment['purpose'] as String? ?? '').replaceAll('_', ' ');
    final status = payment['status'] as String? ?? '';
    final statusDisplay = payment['status_display'] as String? ?? status;
    final proofUrl = payment['proof_of_payment_url'] as String?;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '\$${amount.toStringAsFixed(2)} $currency',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$invoiceNum · $matterTitle',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
                Text(
                  '$purpose · ${_shortDate(payment['created_at'] as String?)}',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              StatusPill(status: status, label: statusDisplay),
              if (proofUrl != null && proofUrl.isNotEmpty) ...[
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  onPressed: () async {
                    final uri = Uri.tryParse(proofUrl);
                    if (uri == null) return;
                    try {
                      await launchUrl(
                        uri,
                        mode: LaunchMode.externalApplication,
                      );
                    } catch (_) {}
                  },
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    textStyle: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  icon: const Icon(LucideIcons.eye, size: 12),
                  label: const Text('POP'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _ConsultationsTab extends StatelessWidget {
  const _ConsultationsTab({required this.consultations});
  final List<Map<String, dynamic>> consultations;

  @override
  Widget build(BuildContext context) {
    if (consultations.isEmpty) {
      return const Text(
        'No consultations yet.',
        style: TextStyle(fontSize: 12, color: AppColors.muted),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in consultations)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.cardTint,
              border: Border.all(color: AppColors.line),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        c['matter_title'] as String? ?? '',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          const Icon(
                            LucideIcons.clock,
                            size: 11,
                            color: AppColors.muted,
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              '${_consultWhen(c['scheduled_time'] as String?)} · ${c['duration_minutes'] ?? 0} min · ${c['mode_display'] ?? ''}',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 11,
                                color: AppColors.muted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                StatusPill(
                  status: c['status'] as String? ?? '',
                  label: c['status_display'] as String?,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

String _shortDate(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('d MMM yyyy').format(dt.toLocal());
}

String _consultWhen(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('EEE d MMM · HH:mm').format(dt.toLocal());
}
