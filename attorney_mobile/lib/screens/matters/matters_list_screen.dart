import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mobile Matters list. Mirrors the web ``/matters`` page — every matter
/// the current user can see, grouped by status, tap-through to the room.
class MattersListScreen extends ConsumerStatefulWidget {
  const MattersListScreen({super.key});

  @override
  ConsumerState<MattersListScreen> createState() => _MattersListScreenState();
}

class _MattersListScreenState extends ConsumerState<MattersListScreen> {
  late Future<List<Matter>> _load;
  String _filter = 'all';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<List<Matter>> _fetch() => ref.read(endpointsProvider).listMatters();

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  List<Matter> _apply(List<Matter> all) {
    Iterable<Matter> it = all;
    if (_filter != 'all') {
      it = it.where((m) => m.status.toLowerCase() == _filter);
    }
    if (_search.trim().isNotEmpty) {
      final q = _search.trim().toLowerCase();
      it = it.where((m) =>
          m.title.toLowerCase().contains(q) ||
          m.practiceArea.toLowerCase().contains(q) ||
          (m.client?.fullName.toLowerCase().contains(q) ?? false));
    }
    final list = it.toList();
    list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('Matters'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Matter>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Skeleton(height: 44, width: double.infinity),
                  const SizedBox(height: 12),
                  for (var i = 0; i < 5; i++) ...[
                    Skeleton(height: 72, width: double.infinity),
                    const SizedBox(height: 8),
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
            final all = snap.data ?? const <Matter>[];
            final visible = _apply(all);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                TextField(
                  decoration: InputDecoration(
                    hintText: 'Search matters…',
                    prefixIcon: const Icon(LucideIcons.search, size: 18),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  onChanged: (v) => setState(() => _search = v),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 36,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      _Chip(label: 'All', count: all.length, selected: _filter == 'all', onTap: () => setState(() => _filter = 'all')),
                      _Chip(label: 'Active', count: all.where((m) => m.status == 'active').length, selected: _filter == 'active', onTap: () => setState(() => _filter = 'active')),
                      _Chip(label: 'Pending', count: all.where((m) => m.status == 'pending').length, selected: _filter == 'pending', onTap: () => setState(() => _filter = 'pending')),
                      _Chip(label: 'Closed', count: all.where((m) => m.status == 'closed').length, selected: _filter == 'closed', onTap: () => setState(() => _filter = 'closed')),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                if (visible.isEmpty)
                  EmptyState(
                    icon: LucideIcons.folderOpen,
                    title: all.isEmpty ? 'No matters yet' : 'No matches',
                    subtitle: all.isEmpty
                        ? (isLawyer
                            ? 'Matters appear when a client books or invites you.'
                            : 'Open one with a lawyer to start the timeline.')
                        : 'Try a different search or filter.',
                  )
                else
                  for (final m in visible) _MatterCard(matter: m, viewerIsLawyer: isLawyer),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.count, required this.selected, required this.onTap});
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: selected ? AppColors.brandDark : AppColors.surface,
            border: Border.all(color: selected ? AppColors.brandDark : AppColors.line),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: selected ? Colors.white : AppColors.ink,
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: selected ? Colors.white.withValues(alpha: 0.2) : AppColors.canvas,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : AppColors.muted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MatterCard extends StatelessWidget {
  const _MatterCard({required this.matter, required this.viewerIsLawyer});
  final Matter matter;
  final bool viewerIsLawyer;

  @override
  Widget build(BuildContext context) {
    final other = viewerIsLawyer
        ? matter.client?.fullName ?? 'Client'
        : matter.lawyers?.isNotEmpty == true
            ? matter.lawyers!.first.fullName
            : 'Lawyer';
    final dt = DateTime.tryParse(matter.createdAt);
    final when = dt != null ? DateFormat('d MMM y').format(dt.toLocal()) : '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: () => context.push(Routes.matter(matter.id)),
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.cardTint,
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppColors.brandDark, shape: BoxShape.circle),
                child: Text(
                  matter.title.isNotEmpty ? matter.title[0].toUpperCase() : '?',
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      matter.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'with $other${matter.practiceArea.isNotEmpty ? ' · ${matter.practiceArea}' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        StatusPill(status: matter.status),
                        const SizedBox(width: 6),
                        if (matter.billingModel.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.canvas,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              matter.billingModel.replaceAll('_', ' '),
                              style: const TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                                color: AppColors.muted,
                                letterSpacing: 0.4,
                              ),
                            ),
                          ),
                        const Spacer(),
                        Text(when, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronRight, color: AppColors.muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}
