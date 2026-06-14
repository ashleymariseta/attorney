import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

const _kindOrder = ['case', 'judgement', 'rules', 'constitution', 'statute'];
const _kindLabel = <String, String>{
  'case': 'Cases',
  'judgement': 'Judgements',
  'rules': 'High Court Rules',
  'constitution': 'Constitution',
  'statute': 'Statutes',
};

/// AI-Researcher — mirrors
/// `frontend/app/(app)/ai-workflows/ai-researcher/page.tsx`.
///
/// Asks the grounded legal corpus. Every answer renders inline `[#n]`
/// citation pills with the supplied authorities listed below.
class AiResearcherScreen extends ConsumerStatefulWidget {
  const AiResearcherScreen({super.key});

  @override
  ConsumerState<AiResearcherScreen> createState() => _AiResearcherScreenState();
}

class _AiResearcherScreenState extends ConsumerState<AiResearcherScreen> {
  final _question = TextEditingController();
  List<String> _scope = [];
  List<Map<String, dynamic>> _collections = const [];
  List<Map<String, dynamic>> _history = const [];
  Map<String, dynamic>? _current;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final ep = ref.read(endpointsProvider);
      final results = await Future.wait([
        ep.listCorpusCollections(),
        ep.listResearchQueries(),
      ]);
      if (!mounted) return;
      setState(() {
        _collections = results[0];
        _history = results[1];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<String> get _kindsWithCorpus {
    final set = _collections.map((c) => c['kind'] as String?).whereType<String>().toSet();
    return _kindOrder.where(set.contains).toList();
  }

  void _toggleScope(String k) {
    setState(() {
      if (_scope.contains(k)) {
        _scope = _scope.where((x) => x != k).toList();
      } else {
        _scope = [..._scope, k];
      }
    });
  }

  Future<void> _ask() async {
    if (_question.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _current = null;
      _error = null;
    });
    try {
      final res = await ref.read(endpointsProvider).askCoResearcher({
        'question': _question.text.trim(),
        'scope': _scope,
      });
      if (!mounted) return;
      setState(() {
        _current = res;
        _history = [res, ..._history];
      });
      final cites = (res['citations'] as List?) ?? const [];
      final text = (res['answer_text'] as String?) ?? '';
      if (text.isEmpty && cites.isEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No matching authorities — try widening the scope.')),
        );
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'AI-Researcher request failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _replay(Map<String, dynamic> h) {
    setState(() {
      _current = h;
      _question.text = (h['question'] as String?) ?? '';
      _scope = ((h['scope'] as List?) ?? const []).cast<String>();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.go(Routes.aiWorkflows),
        ),
        title: const Text('AI-Researcher'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Container(
                height: 40,
                width: 40,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppColors.brandDark,
                  shape: BoxShape.circle,
                ),
                child: const Icon(LucideIcons.bookOpen, color: Colors.white, size: 20),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Ask the grounded legal corpus — every answer cites the chunks supplied to the model.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.25),
              border: Border.all(color: AppColors.brandLight),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(LucideIcons.shield, color: AppColors.brandDark, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Answers are drawn from the supplied authorities — never from the model’s memory. Verify every citation before relying on it.',
                    style: TextStyle(color: AppColors.brandDark, fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.cardTint,
              border: Border.all(color: AppColors.line),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Your question',
                    style: TextStyle(
                        color: AppColors.muted, fontSize: 11.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                TextField(
                  controller: _question,
                  minLines: 3,
                  maxLines: 6,
                  textInputAction: TextInputAction.newline,
                  decoration: const InputDecoration(
                    hintText:
                        'e.g. What are the requirements for the mandament van spolie under Zimbabwean law?',
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Scope',
                    style: TextStyle(
                        color: AppColors.muted, fontSize: 11.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                if (_loading)
                  const Skeleton(height: 32, width: 220)
                else
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      _Chip(
                        label: 'All sources',
                        active: _scope.isEmpty,
                        onTap: () => setState(() => _scope = const []),
                      ),
                      for (final k in _kindsWithCorpus)
                        _Chip(
                          label: _kindLabel[k] ?? k,
                          active: _scope.contains(k),
                          onTap: () => _toggleScope(k),
                        ),
                      if (_kindsWithCorpus.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 6),
                          child: Text(
                            'No corpus seeded yet.',
                            style: TextStyle(color: AppColors.muted, fontSize: 12),
                          ),
                        ),
                    ],
                  ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: () => context.go(Routes.llmProviders),
                        child: const Text(
                          'Uses your default LLM provider. Configure one in Providers.',
                          style: TextStyle(color: AppColors.muted, fontSize: 11),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: _busy || _question.text.trim().isEmpty ? null : _ask,
                      icon: _busy
                          ? const SizedBox(
                              height: 14,
                              width: 14,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : const Icon(LucideIcons.send, size: 14),
                      label: Text(_busy ? 'Researching…' : 'Ask'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(message: _error!),
          ],
          if (_current != null) ...[
            const SizedBox(height: 22),
            _AnswerPanel(q: _current!),
            const SizedBox(height: 14),
            if (((_current!['citations'] as List?) ?? const []).isNotEmpty) ...[
              const Text(
                'AUTHORITIES SUPPLIED TO THE MODEL',
                style: TextStyle(
                    color: AppColors.muted,
                    fontSize: 11,
                    letterSpacing: 0.6,
                    fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              for (final c
                  in ((_current!['citations'] as List?) ?? const []).cast<Map<String, dynamic>>())
                _CitationTile(citation: c),
            ],
          ],
          if (_history.isNotEmpty) ...[
            const SizedBox(height: 26),
            const Row(
              children: [
                Icon(LucideIcons.clock, size: 12, color: AppColors.muted),
                SizedBox(width: 6),
                Text('RECENT',
                    style: TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                        letterSpacing: 0.6,
                        fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 8),
            for (final h in _history.take(6))
              _HistoryTile(h: h, onTap: () => _replay(h)),
          ],
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.brandDark : AppColors.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: active ? AppColors.brandDark : AppColors.line),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: active ? Colors.white : AppColors.muted,
          ),
        ),
      ),
    );
  }
}

class _AnswerPanel extends StatelessWidget {
  const _AnswerPanel({required this.q});
  final Map<String, dynamic> q;

  @override
  Widget build(BuildContext context) {
    final provider = (q['provider'] as String?) ?? '';
    final model = (q['model'] as String?) ?? '';
    final error = (q['error'] as String?) ?? '';
    final answer = (q['answer_text'] as String?) ?? '—';
    final tokensIn = (q['tokens_in'] as num?)?.toInt() ?? 0;
    final tokensOut = (q['tokens_out'] as num?)?.toInt() ?? 0;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.brandLight.withValues(alpha: 0.18),
            AppColors.surface,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: AppColors.brandLight),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.sparkles, size: 12, color: AppColors.brandDark),
              const SizedBox(width: 4),
              const Text(
                'ANSWER',
                style: TextStyle(
                  color: AppColors.brandDark,
                  fontSize: 11,
                  letterSpacing: 0.6,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (provider.isNotEmpty) ...[
                const SizedBox(width: 6),
                Text('· $provider${model.isNotEmpty ? ' · $model' : ''}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 11)),
              ],
            ],
          ),
          const SizedBox(height: 8),
          if (error.isNotEmpty)
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFFFEE2E2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(error,
                  style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
            )
          else
            _AnswerWithPills(text: answer),
          if (tokensIn > 0 || tokensOut > 0) ...[
            const SizedBox(height: 8),
            Text(
              '$tokensIn in / $tokensOut out tokens',
              style: const TextStyle(color: AppColors.muted, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}

class _AnswerWithPills extends StatelessWidget {
  const _AnswerWithPills({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) {
    final regex = RegExp(r'\[#\d+\]');
    final spans = <InlineSpan>[];
    int last = 0;
    for (final m in regex.allMatches(text)) {
      if (m.start > last) {
        spans.add(TextSpan(text: text.substring(last, m.start)));
      }
      spans.add(WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 2),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: AppColors.brandDark.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            m.group(0)!,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: AppColors.brandDark,
            ),
          ),
        ),
      ));
      last = m.end;
    }
    if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
    return SelectableText.rich(
      TextSpan(
        style: const TextStyle(fontSize: 13.5, color: AppColors.ink, height: 1.45),
        children: spans,
      ),
    );
  }
}

class _CitationTile extends StatelessWidget {
  const _CitationTile({required this.citation});
  final Map<String, dynamic> citation;

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final doc = (citation['document'] as Map?)?.cast<String, dynamic>() ?? const {};
    final rank = (citation['rank'] as num?)?.toInt() ?? 0;
    final excerpt = (citation['excerpt'] as String?) ?? '';
    final title = (doc['title'] as String?) ?? '';
    final kindDisplay = (doc['kind_display'] as String?) ?? '';
    final year = doc['year'];
    final sourceUrl = (doc['source_url'] as String?) ?? '';
    final citationStr = (doc['citation'] as String?) ?? '';
    return Container(
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
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.brandLight.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '[#${rank + 1}]',
                  style: const TextStyle(
                      color: AppColors.brandDark,
                      fontWeight: FontWeight.w800,
                      fontSize: 10.5),
                ),
              ),
              if (kindDisplay.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    kindDisplay.toUpperCase(),
                    style: const TextStyle(
                        color: AppColors.muted,
                        letterSpacing: 0.5,
                        fontSize: 10,
                        fontWeight: FontWeight.w700),
                  ),
                ),
              Flexible(
                child: Text(
                  title,
                  style: const TextStyle(
                      color: AppColors.ink, fontSize: 12.5, fontWeight: FontWeight.w700),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (year != null)
                Text('· $year',
                    style: const TextStyle(color: AppColors.muted, fontSize: 11.5)),
              if (sourceUrl.isNotEmpty)
                InkWell(
                  onTap: () => _open(sourceUrl),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.externalLink, color: AppColors.brand, size: 12),
                      SizedBox(width: 2),
                      Text('Source',
                          style: TextStyle(color: AppColors.brand, fontSize: 11.5)),
                    ],
                  ),
                ),
            ],
          ),
          if (citationStr.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(citationStr,
                style: const TextStyle(color: AppColors.muted, fontSize: 11.5)),
          ],
          if (excerpt.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              excerpt,
              style: const TextStyle(color: AppColors.ink, fontSize: 12.5, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.h, required this.onTap});
  final Map<String, dynamic> h;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final q = (h['question'] as String?) ?? '';
    final createdAt = (h['created_at'] as String?) ?? '';
    final created = DateTime.tryParse(createdAt);
    final when = created != null ? DateFormat('d MMM HH:mm').format(created.toLocal()) : '';
    final cites = ((h['citations'] as List?) ?? const []).length;
    final provider = (h['provider'] as String?) ?? '—';
    return InkWell(
      onTap: onTap,
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
            Text(
              q,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: AppColors.ink, fontSize: 13, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              '$when · $cites citation${cites == 1 ? '' : 's'} · $provider',
              style: const TextStyle(color: AppColors.muted, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
