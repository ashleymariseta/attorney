import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// LLM Providers — mirrors
/// `frontend/app/(app)/ai-workflows/providers/page.tsx`.
///
/// Lists the firm's saved provider configurations, exposes a quick
/// per-provider "Add" affordance, and opens a bottom sheet (mobile
/// equivalent of the web modal) for create + edit.
class LlmProvidersScreen extends ConsumerStatefulWidget {
  const LlmProvidersScreen({super.key});

  @override
  ConsumerState<LlmProvidersScreen> createState() => _LlmProvidersScreenState();
}

class _LlmProvidersScreenState extends ConsumerState<LlmProvidersScreen> {
  late Future<_ProvidersData> _load;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<_ProvidersData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final results = await Future.wait([
      ep.supportedLlmProviders(),
      ep.listLlmProviders(),
    ]);
    return _ProvidersData(supported: results[0], configs: results[1]);
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  Future<void> _delete(Map<String, dynamic> c) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete ${c['provider_display']}?'),
        content: const Text('You can re-add the configuration later.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(endpointsProvider).deleteLlmProvider(c['id'] as int);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Provider removed.')),
      );
      await _refresh();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openSheet({
    Map<String, dynamic>? support,
    Map<String, dynamic>? editing,
    required List<Map<String, dynamic>> allSupport,
  }) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ProviderSheet(support: support, editing: editing, allSupport: allSupport),
    );
    if (saved == true) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.go(Routes.aiWorkflows),
        ),
        title: const Text('LLM Providers'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_ProvidersData>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  Skeleton(height: 60, width: double.infinity),
                  SizedBox(height: 10),
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
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Plug in the providers you want to use per stage. Keys are only sent to the providers’ APIs — never to us.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12.5),
                ),
                const SizedBox(height: 12),
                _SecurityBanner(),
                const SizedBox(height: 18),
                const _SectionLabel('Your providers'),
                if (data.configs.isEmpty)
                  const _DashedHint(
                    text: 'No providers yet. Add one below to enable stage runs.',
                  )
                else
                  for (final c in data.configs)
                    _ConfigTile(
                      cfg: c,
                      onEdit: () => _openSheet(
                        editing: c,
                        allSupport: data.supported,
                      ),
                      onDelete: () => _delete(c),
                    ),
                const SizedBox(height: 18),
                const _SectionLabel('Add a provider'),
                for (final s in data.supported)
                  _SupportTile(
                    s: s,
                    onTap: () => _openSheet(
                      support: s,
                      allSupport: data.supported,
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ProvidersData {
  _ProvidersData({required this.supported, required this.configs});
  final List<Map<String, dynamic>> supported;
  final List<Map<String, dynamic>> configs;
}

IconData _providerIcon(String? id) {
  if (id == 'local') return LucideIcons.database;
  return LucideIcons.sparkles;
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.6),
      ),
    );
  }
}

class _SecurityBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
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
              'Use no-training API tiers only. Privileged matter must never route through consumer endpoints.',
              style: TextStyle(color: AppColors.brandDark, fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashedHint extends StatelessWidget {
  const _DashedHint({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(text,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
    );
  }
}

class _ConfigTile extends StatelessWidget {
  const _ConfigTile({required this.cfg, required this.onEdit, required this.onDelete});
  final Map<String, dynamic> cfg;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final provider = cfg['provider'] as String?;
    final label = (cfg['label'] as String?) ?? '';
    final providerDisplay = (cfg['provider_display'] as String?) ?? '';
    final isDefault = cfg['is_default'] as bool? ?? false;
    final hasApiKey = cfg['has_api_key'] as bool? ?? false;
    final defaultModel = (cfg['default_model'] as String?) ?? '';
    final baseUrl = (cfg['base_url'] as String?) ?? '';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            height: 40,
            width: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.4),
              shape: BoxShape.circle,
            ),
            child: Icon(_providerIcon(provider), color: AppColors.brandDark, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        label.isEmpty ? providerDisplay : label,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink),
                      ),
                    ),
                    if (isDefault) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFECFDF5),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: const Color(0xFFA7F3D0)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(LucideIcons.check, size: 10, color: Color(0xFF047857)),
                            SizedBox(width: 2),
                            Text('DEFAULT',
                                style: TextStyle(
                                    fontSize: 9,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF047857))),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    providerDisplay,
                    if (defaultModel.isNotEmpty) defaultModel,
                    if (hasApiKey) 'key saved',
                    if (baseUrl.isNotEmpty) baseUrl,
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                ),
              ],
            ),
          ),
          TextButton(onPressed: onEdit, child: const Text('Edit')),
          IconButton(
            tooltip: 'Delete',
            icon: const Icon(LucideIcons.trash2, color: AppColors.muted, size: 18),
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

class _SupportTile extends StatelessWidget {
  const _SupportTile({required this.s, required this.onTap});
  final Map<String, dynamic> s;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final value = s['value'] as String?;
    final label = (s['label'] as String?) ?? '';
    final needsApiKey = s['needs_api_key'] as bool? ?? false;
    final needsBaseUrl = s['needs_base_url'] as bool? ?? false;
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
        child: Row(
          children: [
            Container(
              height: 38,
              width: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.brandLight.withValues(alpha: 0.4),
                shape: BoxShape.circle,
              ),
              child: Icon(_providerIcon(value), color: AppColors.brandDark, size: 18),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink)),
                  const SizedBox(height: 2),
                  Text(
                    '${needsApiKey ? 'API key' : 'No key'}${needsBaseUrl ? ' · custom URL' : ''}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            const Row(
              children: [
                Icon(LucideIcons.plus, color: AppColors.brandDark, size: 14),
                SizedBox(width: 2),
                Text('Configure',
                    style: TextStyle(
                        color: AppColors.brandDark, fontSize: 11.5, fontWeight: FontWeight.w700)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ProviderSheet extends ConsumerStatefulWidget {
  const _ProviderSheet({
    required this.support,
    required this.editing,
    required this.allSupport,
  });
  final Map<String, dynamic>? support;
  final Map<String, dynamic>? editing;
  final List<Map<String, dynamic>> allSupport;

  @override
  ConsumerState<_ProviderSheet> createState() => _ProviderSheetState();
}

class _ProviderSheetState extends ConsumerState<_ProviderSheet> {
  late final Map<String, dynamic> _support;
  late final TextEditingController _label;
  late final TextEditingController _apiKey;
  late final TextEditingController _baseUrl;
  late final TextEditingController _model;
  late bool _isDefault;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final editing = widget.editing;
    final providedSupport = widget.support;
    if (editing != null) {
      _support = widget.allSupport.firstWhere(
        (s) => s['value'] == editing['provider'],
        orElse: () => providedSupport ?? widget.allSupport.first,
      );
    } else {
      _support = providedSupport ?? widget.allSupport.first;
    }
    _label = TextEditingController(text: (editing?['label'] as String?) ?? '');
    _apiKey = TextEditingController();
    _baseUrl = TextEditingController(text: (editing?['base_url'] as String?) ?? '');
    _model = TextEditingController(
      text: (editing?['default_model'] as String?) ??
          (_support['default_model'] as String? ?? ''),
    );
    _isDefault = (editing?['is_default'] as bool?) ?? true;
  }

  @override
  void dispose() {
    _label.dispose();
    _apiKey.dispose();
    _baseUrl.dispose();
    _model.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{
        'provider': _support['value'],
        'label': _label.text,
        'base_url': _baseUrl.text,
        'default_model': _model.text,
        'is_default': _isDefault,
      };
      if (_apiKey.text.isNotEmpty) payload['api_key'] = _apiKey.text;
      final ep = ref.read(endpointsProvider);
      if (widget.editing != null) {
        await ep.updateLlmProvider(widget.editing!['id'] as int, payload);
      } else {
        await ep.createLlmProvider(payload);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not save.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final needsApiKey = _support['needs_api_key'] as bool? ?? false;
    final needsBaseUrl = _support['needs_base_url'] as bool? ?? false;
    final hasKey = (widget.editing?['has_api_key'] as bool?) ?? false;
    final providerLabel = (_support['label'] as String?) ?? '';
    final inset = MediaQuery.of(context).viewInsets.bottom;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: inset),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                decoration: const BoxDecoration(
                  color: AppColors.brand,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${widget.editing != null ? 'Edit' : 'Add'} $providerLabel',
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      icon: const Icon(LucideIcons.x, color: Colors.white),
                    ),
                  ],
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: _label,
                        decoration: const InputDecoration(
                          labelText: 'Label (optional)',
                          hintText: 'e.g. Firm Anthropic key',
                        ),
                      ),
                      if (needsApiKey) ...[
                        const SizedBox(height: 12),
                        TextField(
                          controller: _apiKey,
                          obscureText: true,
                          style: const TextStyle(fontFamily: 'monospace'),
                          decoration: InputDecoration(
                            labelText: hasKey
                                ? 'API key (leave blank to keep current)'
                                : 'API key',
                            hintText: hasKey ? '••••••••' : 'sk-…',
                          ),
                        ),
                      ],
                      if (needsBaseUrl) ...[
                        const SizedBox(height: 12),
                        TextField(
                          controller: _baseUrl,
                          decoration: const InputDecoration(
                            labelText: 'Base URL',
                            hintText: 'http://localhost:11434',
                            helperText: 'Ollama, vLLM, or any OpenAI-compatible endpoint.',
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      TextField(
                        controller: _model,
                        decoration: InputDecoration(
                          labelText: 'Default model',
                          hintText: (_support['default_model'] as String?) ?? '',
                        ),
                      ),
                      const SizedBox(height: 10),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        title: const Text('Use as default for this provider',
                            style: TextStyle(fontSize: 13, color: AppColors.ink)),
                        value: _isDefault,
                        onChanged: (v) => setState(() => _isDefault = v ?? false),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 4),
                        ErrorBanner(message: _error!),
                      ],
                    ],
                  ),
                ),
              ),
              Container(
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: AppColors.line)),
                  color: AppColors.canvas,
                ),
                padding: const EdgeInsets.all(12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: _busy ? null : _save,
                      icon: const Icon(LucideIcons.key, size: 16),
                      label: Text(_busy ? 'Saving…' : 'Save'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
