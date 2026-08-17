import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// "My legal team" — lawyers the current client keeps on retainer.
/// Mirrors frontend/app/(app)/my-lawyers/page.tsx.
class MyLawyersScreen extends ConsumerStatefulWidget {
  const MyLawyersScreen({super.key});

  @override
  ConsumerState<MyLawyersScreen> createState() => _MyLawyersScreenState();
}

class _MyLawyersScreenState extends ConsumerState<MyLawyersScreen> {
  late Future<List<Map<String, dynamic>>> _load;

  @override
  void initState() {
    super.initState();
    _load = ref.read(endpointsProvider).listRetainers();
  }

  Future<void> _refresh() async {
    final fresh = await ref.read(endpointsProvider).listRetainers();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('My legal team'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (var i = 0; i < 3; i++) ...[
                    Skeleton(height: 130, width: double.infinity),
                    const SizedBox(height: 12),
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
            final retainers = snap.data ?? const [];
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const _HeaderCopy(),
                const SizedBox(height: 16),
                if (retainers.isEmpty)
                  EmptyState(
                    icon: LucideIcons.users,
                    title: 'No one on your legal team yet',
                    subtitle: 'Add a lawyer from the directory to keep them on retainer.',
                    action: FilledButton.icon(
                      icon: const Icon(LucideIcons.search, size: 16),
                      onPressed: () => context.go(Routes.lawyersPublic),
                      label: const Text('Find a lawyer'),
                    ),
                  )
                else
                  for (final r in retainers) _RetainerCard(retainer: r),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _HeaderCopy extends StatelessWidget {
  const _HeaderCopy();
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        Text(
          'Lawyers you keep on retainer',
          style: TextStyle(fontSize: 13, color: AppColors.ink, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 4),
        Text(
          'Open a workspace with them anytime — no consultation needed.',
          style: TextStyle(fontSize: 12, color: AppColors.muted),
        ),
      ],
    );
  }
}

class _RetainerCard extends StatelessWidget {
  const _RetainerCard({required this.retainer});
  final Map<String, dynamic> retainer;

  @override
  Widget build(BuildContext context) {
    final lawyer = retainer['lawyer_detail'] as Map<String, dynamic>? ?? const {};
    final lawyerId = (lawyer['id'] as num?)?.toInt() ?? 0;
    final name = lawyer['full_name'] as String? ?? '—';
    final initial = name.isEmpty
        ? '?'
        : name.trim().split(RegExp(r'\s+')).take(2).map((p) => p.isEmpty ? '' : p[0]).join();

    final plan = retainer['plan_name'] as String? ?? '—';
    final cycle = retainer['cycle'] as String? ?? '';
    final fee = retainer['monthly_fee'] as String?;
    final hours = (retainer['included_hours'] as num?)?.toInt() ?? 0;
    final status = retainer['status'] as String? ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: AppColors.brandLight,
                foregroundImage: (lawyer['avatar_url'] as String?)?.isNotEmpty == true
                    ? NetworkImage(lawyer['avatar_url'] as String)
                    : null,
                child: Text(
                  initial.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.brandDark,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, color: AppColors.ink, fontSize: 14)),
                    const SizedBox(height: 4),
                    if (status.isNotEmpty) StatusPill(status: status),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'View profile',
                onPressed: lawyerId > 0 ? () => context.go(Routes.lawyerProfile(lawyerId)) : null,
                icon: const Icon(LucideIcons.info, size: 18, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _miniStat(label: 'Plan', value: plan)),
              Expanded(child: _miniStat(label: 'Cycle', value: cycle.isEmpty ? '—' : cycle)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _miniStat(label: 'Monthly fee', value: fee != null ? '\$$fee' : '—')),
              Expanded(child: _miniStat(label: 'Included hours', value: '$hours')),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: lawyerId > 0 ? () => context.go(Routes.book(lawyerId)) : null,
            icon: const Icon(LucideIcons.doorOpen, size: 16),
            label: const Text('Open workspace'),
          ),
        ],
      ),
    );
  }

  Widget _miniStat({required String label, required String value}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.6,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(fontSize: 13, color: AppColors.ink, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}
