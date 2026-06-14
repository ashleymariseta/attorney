import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors `frontend/app/(app)/ai-workflows/[id]/page.tsx`.
///
/// Lists the workflow's ordered stages, each expanded to show provider /
/// model / retrieval scope, the prompt template, the latest run output
/// and run + approve actions. Mobile uses an ExpansionTile-style accordion.
class WorkflowDetailScreen extends ConsumerStatefulWidget {
  const WorkflowDetailScreen({super.key, required this.workflowId});
  final int workflowId;

  @override
  ConsumerState<WorkflowDetailScreen> createState() => _WorkflowDetailScreenState();
}

class _WorkflowDetailScreenState extends ConsumerState<WorkflowDetailScreen> {
  Future<Map<String, dynamic>>? _load;
  int? _expanded;
  int? _busyStageId;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<Map<String, dynamic>> _fetch() {
    return ref.read(endpointsProvider).getWorkflow(widget.workflowId);
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  Future<void> _run(Map<String, dynamic> stage) async {
    setState(() {
      _busyStageId = stage['id'] as int;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).runWorkflowStage(stage['id'] as int, {
        'system_prompt': (stage['purpose'] as String?) ?? '',
        'user_prompt': (stage['prompt_template'] as String?) ?? '',
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${stage['title']} run complete — review the result.')),
      );
      await _refresh();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Run failed.');
    } finally {
      if (mounted) setState(() => _busyStageId = null);
    }
  }

  Future<void> _approve(Map<String, dynamic> stage) async {
    setState(() {
      _busyStageId = stage['id'] as int;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).approveWorkflowStage(stage['id'] as int);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${stage['title']} approved.')),
      );
      await _refresh();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not approve.');
    } finally {
      if (mounted) setState(() => _busyStageId = null);
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
        title: const Text('Workflow'),
      ),
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
                  Skeleton(height: 100, width: double.infinity),
                  SizedBox(height: 10),
                  Skeleton(height: 100, width: double.infinity),
                ],
              );
            }
            if (snap.hasError) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  ErrorBanner(message: snap.error.toString()),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () => context.go(Routes.aiWorkflows),
                    icon: const Icon(LucideIcons.chevronLeft),
                    label: const Text('Back'),
                  ),
                ],
              );
            }
            final wf = snap.data;
            if (wf == null) {
              return const Center(
                child: EmptyState(
                  icon: LucideIcons.info,
                  title: 'Workflow not found',
                ),
              );
            }
            final name = (wf['name'] as String?) ?? '';
            final templateName = (wf['template_name'] as String?) ?? '';
            final approved = (wf['approved_count'] as num?)?.toInt() ?? 0;
            final total = (wf['stage_count'] as num?)?.toInt() ?? 0;
            final stages = ((wf['stages'] as List?) ?? const []).cast<Map<String, dynamic>>();

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  name,
                  style: const TextStyle(
                      fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink),
                ),
                const SizedBox(height: 4),
                Text(
                  '${templateName.isNotEmpty ? 'From “$templateName”' : 'Custom workflow'} · $approved/$total stages approved',
                  style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  ErrorBanner(message: _error!),
                ],
                const SizedBox(height: 16),
                for (int i = 0; i < stages.length; i++)
                  _StageCard(
                    index: i,
                    stage: stages[i],
                    expanded: _expanded == stages[i]['id'],
                    busy: _busyStageId == stages[i]['id'],
                    onToggle: () => setState(() {
                      _expanded = _expanded == stages[i]['id']
                          ? null
                          : stages[i]['id'] as int;
                    }),
                    onRun: () => _run(stages[i]),
                    onApprove: () => _approve(stages[i]),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StageCard extends StatelessWidget {
  const _StageCard({
    required this.index,
    required this.stage,
    required this.expanded,
    required this.busy,
    required this.onToggle,
    required this.onRun,
    required this.onApprove,
  });
  final int index;
  final Map<String, dynamic> stage;
  final bool expanded;
  final bool busy;
  final VoidCallback onToggle;
  final VoidCallback onRun;
  final VoidCallback onApprove;

  ({Color bg, Color fg}) _tint(String status) {
    switch (status) {
      case 'approved':
        return (bg: const Color(0xFFECFDF5), fg: const Color(0xFF047857));
      case 'awaiting_approval':
        return (bg: const Color(0xFFEFF6FF), fg: const Color(0xFF0369A1));
      case 'in_progress':
        return (bg: const Color(0xFFFEF3C7), fg: const Color(0xFF92400E));
      default:
        return (bg: AppColors.canvas, fg: AppColors.muted);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = (stage['title'] as String?) ?? '';
    final purpose = (stage['purpose'] as String?) ?? '';
    final status = (stage['status'] as String?) ?? 'pending';
    final statusDisplay = (stage['status_display'] as String?) ?? status;
    final providerDisplay = (stage['provider_display'] as String?) ?? '—';
    final model = (stage['model'] as String?) ?? '';
    final retrievalScope = (stage['retrieval_scope'] as String?) ?? '';
    final promptTemplate = (stage['prompt_template'] as String?) ?? '';
    final latestResult = (stage['latest_result'] as Map?)?.cast<String, dynamic>();
    final tint = _tint(status);
    final isApproved = status == 'approved';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Container(
                    height: 32,
                    width: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: isApproved
                          ? const Color(0xFFD1FAE5)
                          : AppColors.brandLight.withValues(alpha: 0.4),
                      shape: BoxShape.circle,
                    ),
                    child: isApproved
                        ? const Icon(LucideIcons.check, color: Color(0xFF047857), size: 16)
                        : Text(
                            '${index + 1}',
                            style: const TextStyle(
                                color: AppColors.brandDark,
                                fontWeight: FontWeight.w800,
                                fontSize: 12),
                          ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title,
                            style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                                color: AppColors.ink)),
                        if (purpose.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            purpose,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: tint.bg,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      statusDisplay.toUpperCase(),
                      style: TextStyle(
                          color: tint.fg,
                          fontSize: 9,
                          letterSpacing: 0.4,
                          fontWeight: FontWeight.w800),
                    ),
                  ),
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          ),
          if (expanded)
            Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: AppColors.canvas,
                border: Border(top: BorderSide(color: AppColors.line)),
              ),
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: _Detail(label: 'Provider', value: providerDisplay)),
                      const SizedBox(width: 8),
                      Expanded(
                          child: _Detail(label: 'Model', value: model.isEmpty ? '—' : model)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _Detail(
                    label: 'Retrieval scope',
                    value: retrievalScope.isEmpty ? 'none' : retrievalScope,
                  ),
                  const SizedBox(height: 12),
                  const Row(
                    children: [
                      Icon(LucideIcons.fileText, color: AppColors.muted, size: 14),
                      SizedBox(width: 4),
                      Text('PROMPT TEMPLATE',
                          style: TextStyle(
                              color: AppColors.muted,
                              fontSize: 10.5,
                              letterSpacing: 0.6,
                              fontWeight: FontWeight.w700)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.cardTint,
                      border: Border.all(color: AppColors.line),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    width: double.infinity,
                    child: SelectableText(
                      promptTemplate.isEmpty ? '—' : promptTemplate,
                      style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11.5,
                          color: AppColors.ink,
                          height: 1.4),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (latestResult != null)
                    _LatestResult(result: latestResult)
                  else
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppColors.cardTint,
                        border: Border.all(color: AppColors.line),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(LucideIcons.circle,
                              size: 14, color: AppColors.muted),
                          SizedBox(width: 6),
                          Text('No run yet for this stage.',
                              style: TextStyle(color: AppColors.muted, fontSize: 12)),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      OutlinedButton.icon(
                        onPressed: busy || isApproved ? null : onApprove,
                        icon: const Icon(LucideIcons.checkCircle2, size: 14),
                        label: const Text('Approve'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.icon(
                        onPressed: busy || isApproved ? null : onRun,
                        icon: busy
                            ? const SizedBox(
                                height: 12,
                                width: 12,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(LucideIcons.play, size: 14),
                        label: Text(busy ? 'Running…' : 'Run stage'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.label, required this.value});
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
              fontSize: 10.5,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(color: AppColors.ink, fontSize: 13),
        ),
      ],
    );
  }
}

class _LatestResult extends StatelessWidget {
  const _LatestResult({required this.result});
  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    final provider = (result['provider'] as String?) ?? '';
    final model = (result['model'] as String?) ?? '';
    final error = (result['error'] as String?) ?? '';
    final output = (result['output_text'] as String?) ?? '';
    final tokensIn = (result['tokens_in'] as num?)?.toInt() ?? 0;
    final tokensOut = (result['tokens_out'] as num?)?.toInt() ?? 0;
    final createdAt = (result['created_at'] as String?) ?? '';
    final created = DateTime.tryParse(createdAt);
    final when = created != null ? DateFormat('d MMM HH:mm').format(created.toLocal()) : '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'LATEST OUTPUT · $provider${model.isNotEmpty ? ' · $model' : ''}',
          style: const TextStyle(
              color: AppColors.muted,
              fontSize: 10.5,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        if (error.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFEE2E2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(error,
                style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
          )
        else
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.cardTint,
              border: Border.all(color: AppColors.line),
              borderRadius: BorderRadius.circular(8),
            ),
            width: double.infinity,
            child: SelectableText(
              output.isEmpty ? '—' : output,
              style: const TextStyle(
                  color: AppColors.ink, fontSize: 13, height: 1.45),
            ),
          ),
        const SizedBox(height: 6),
        Text(
          [
            '$tokensIn in / $tokensOut out tokens',
            if (when.isNotEmpty) when,
          ].join(' · '),
          style: const TextStyle(color: AppColors.muted, fontSize: 11),
        ),
      ],
    );
  }
}
