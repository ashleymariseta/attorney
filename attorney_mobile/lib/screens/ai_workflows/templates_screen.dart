import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors `frontend/app/(app)/ai-workflows/templates/page.tsx`.
///
/// Lists every workflow template available to the firm and provides a
/// one-tap "Start workflow" affordance that prompts for a workflow name
/// and routes to the new workflow's detail screen.
class WorkflowTemplatesScreen extends ConsumerStatefulWidget {
  const WorkflowTemplatesScreen({super.key});

  @override
  ConsumerState<WorkflowTemplatesScreen> createState() => _WorkflowTemplatesScreenState();
}

class _WorkflowTemplatesScreenState extends ConsumerState<WorkflowTemplatesScreen> {
  late Future<List<Map<String, dynamic>>> _load;
  int? _starting;

  @override
  void initState() {
    super.initState();
    _load = ref.read(endpointsProvider).listWorkflowTemplates();
  }

  Future<void> _refresh() async {
    final fresh = await ref.read(endpointsProvider).listWorkflowTemplates();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  Future<void> _start(Map<String, dynamic> t) async {
    final templateName = (t['name'] as String?) ?? 'Workflow';
    final name = await _promptForName(context, suggestion: templateName);
    if (name == null || name.trim().isEmpty) return;
    setState(() => _starting = t['id'] as int);
    try {
      final wf = await ref.read(endpointsProvider).createWorkflow({
        'template': t['id'],
        'name': name.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Workflow “${wf['name']}” created.')),
      );
      context.go(Routes.workflow(wf['id'] as int));
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not start workflow.')),
        );
      }
    } finally {
      if (mounted) setState(() => _starting = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.go(Routes.aiWorkflows),
        ),
        title: const Text('Templates'),
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
                  Skeleton(height: 160, width: double.infinity),
                  SizedBox(height: 10),
                  Skeleton(height: 160, width: double.infinity),
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
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Each template defines an ordered set of stages with sensible default providers — overridable per stage.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12.5),
                  ),
                ),
                if (list.isEmpty)
                  const EmptyState(
                    icon: LucideIcons.fileText,
                    title: 'No templates seeded',
                    subtitle: 'Ask your platform admin to enable workflow templates.',
                  )
                else
                  for (final t in list)
                    _TemplateCard(
                      t: t,
                      busy: _starting == t['id'],
                      onStart: () => _start(t),
                    ),
              ],
            );
          },
        ),
      ),
    );
  }
}

Future<String?> _promptForName(BuildContext context, {required String suggestion}) async {
  final controller = TextEditingController(text: suggestion);
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Name this workflow'),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'Workflow name'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(null), child: const Text('Cancel')),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(controller.text),
          child: const Text('Start'),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({required this.t, required this.busy, required this.onStart});
  final Map<String, dynamic> t;
  final bool busy;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final name = (t['name'] as String?) ?? '';
    final matterType = (t['matter_type'] as String?) ?? '';
    final description = (t['description'] as String?) ?? '';
    final stages = (t['stages'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                height: 40,
                width: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.brandLight.withValues(alpha: 0.35),
                  shape: BoxShape.circle,
                ),
                child: const Icon(LucideIcons.fileText, color: AppColors.brandDark, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.ink)),
                    Text(
                      matterType.isEmpty ? '—' : matterType.toUpperCase(),
                      style: const TextStyle(
                          color: AppColors.muted,
                          letterSpacing: 0.6,
                          fontSize: 10,
                          fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(description, style: const TextStyle(color: AppColors.ink, fontSize: 13)),
          ],
          if (stages.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final s in stages)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.canvas,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Text(
                      (s['title'] as String?) ?? '',
                      style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: busy ? null : onStart,
              icon: const Icon(LucideIcons.sparkles, size: 16),
              label: Text(busy ? 'Starting…' : 'Start workflow'),
            ),
          ),
        ],
      ),
    );
  }
}
