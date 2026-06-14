import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Lawyer-only landing for AI Workflows.
///
/// Mirrors `frontend/app/(app)/ai-workflows/page.tsx`: lists the caller's
/// active workflows, offers a CTA to browse templates, and exposes quick
/// links into AI-Researcher and provider configuration.
class WorkflowsScreen extends ConsumerStatefulWidget {
  const WorkflowsScreen({super.key});

  @override
  ConsumerState<WorkflowsScreen> createState() => _WorkflowsScreenState();
}

class _WorkflowsScreenState extends ConsumerState<WorkflowsScreen> {
  late Future<List<Map<String, dynamic>>> _load;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<List<Map<String, dynamic>>> _fetch() {
    return ref.read(endpointsProvider).listWorkflows();
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    if (me != null && !me.isLawyer) {
      return Scaffold(
        appBar: AppBar(title: const Text('AI Workflows')),
        body: const EmptyState(
          icon: LucideIcons.lock,
          title: 'Lawyers only',
          subtitle: 'AI Workflows are available to verified legal practitioners.',
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Workflows'),
        actions: [
          IconButton(
            tooltip: 'AI-Researcher',
            icon: const Icon(LucideIcons.bookOpen),
            onPressed: () => context.go(Routes.aiResearcher),
          ),
          IconButton(
            tooltip: 'Providers',
            icon: const Icon(LucideIcons.key),
            onPressed: () => context.go(Routes.llmProviders),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go(Routes.workflowTemplates),
        backgroundColor: AppColors.brandDark,
        icon: const Icon(LucideIcons.sparkles, color: Colors.white),
        label: const Text('Start a workflow', style: TextStyle(color: Colors.white)),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  _IntroBanner(),
                  SizedBox(height: 16),
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
            final list = snap.data ?? const [];
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const _IntroBanner(),
                const SizedBox(height: 18),
                if (list.isEmpty)
                  _EmptyWorkflows(
                    onTemplates: () => context.go(Routes.workflowTemplates),
                    onProviders: () => context.go(Routes.llmProviders),
                  )
                else
                  for (final w in list)
                    _WorkflowTile(
                      w: w,
                      onTap: () => context.go(Routes.workflow(w['id'] as int)),
                    ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _IntroBanner extends StatelessWidget {
  const _IntroBanner();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.brandDark, AppColors.brand],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(LucideIcons.sparkles, color: Colors.white, size: 18),
              SizedBox(width: 8),
              Text('Stage-based legal pipelines',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
            ],
          ),
          SizedBox(height: 6),
          Text(
            'Grounded retrieval, verifiable citations, your provider of choice per stage.',
            style: TextStyle(color: Colors.white70, fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}

class _EmptyWorkflows extends StatelessWidget {
  const _EmptyWorkflows({required this.onTemplates, required this.onProviders});
  final VoidCallback onTemplates;
  final VoidCallback onProviders;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line, style: BorderStyle.solid),
        borderRadius: BorderRadius.circular(16),
        color: AppColors.surface,
      ),
      child: Column(
        children: [
          Container(
            height: 48,
            width: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.35),
              shape: BoxShape.circle,
            ),
            child: const Icon(LucideIcons.sparkles, color: AppColors.brandDark),
          ),
          const SizedBox(height: 10),
          const Text('No workflows yet',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.ink)),
          const SizedBox(height: 6),
          const Text(
            'Pick a template (Spoliation Application, Conveyancing Transfer, …) and we’ll spin up an intake → research → skeleton → draft pipeline for the matter.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 12.5),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FilledButton.icon(
                onPressed: onTemplates,
                icon: const Icon(LucideIcons.fileText, size: 16),
                label: const Text('Browse templates'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: onProviders,
                icon: const Icon(LucideIcons.key, size: 16),
                label: const Text('Add a provider'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _WorkflowTile extends StatelessWidget {
  const _WorkflowTile({required this.w, required this.onTap});
  final Map<String, dynamic> w;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final templateName = (w['template_name'] as String?) ?? '—';
    final name = (w['name'] as String?) ?? '';
    final approved = (w['approved_count'] as num?)?.toInt() ?? 0;
    final total = (w['stage_count'] as num?)?.toInt() ?? 0;
    final statusDisplay = (w['status_display'] as String?) ?? '';
    final status = (w['status'] as String?) ?? '';
    final createdAt = (w['created_at'] as String?) ?? '';
    final created = DateTime.tryParse(createdAt);
    final when = created != null ? DateFormat('d MMM yyyy').format(created.toLocal()) : '';
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.cardTint,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              templateName.toUpperCase(),
              style: const TextStyle(
                  color: AppColors.brandDark,
                  fontSize: 10,
                  letterSpacing: 0.6,
                  fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(name,
                style: const TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
            const SizedBox(height: 8),
            Text(
              '$approved/$total stages approved${when.isEmpty ? '' : '  ·  started $when'}',
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                StatusPill(status: status, label: statusDisplay),
                const Spacer(),
                const Icon(LucideIcons.chevronRight, color: AppColors.muted, size: 18),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
