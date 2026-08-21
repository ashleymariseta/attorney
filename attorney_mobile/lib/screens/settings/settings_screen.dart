import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Settings — multi-tab screen mirroring frontend/app/(app)/settings/page.tsx.
///
/// Lawyers see: Profile / KYC (cert) / Rates / Payments / Firm / Security
/// Clients see: Profile / KYC (id doc) / Security
/// Both see a Danger Zone (export data, delete account) at the bottom.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authProvider).me;
    if (me == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (me.isLawyer) return const _LawyerSettings();
    if (me.isClient) return const _ClientSettings();
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: const Padding(
        padding: EdgeInsets.all(24),
        child: Center(
          child: Text(
            'Settings are available for lawyer and client accounts.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LAWYER SETTINGS
// ─────────────────────────────────────────────────────────────────────────

class _LawyerSettings extends ConsumerStatefulWidget {
  const _LawyerSettings();
  @override
  ConsumerState<_LawyerSettings> createState() => _LawyerSettingsState();
}

class _LawyerSettingsState extends ConsumerState<_LawyerSettings>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  Map<String, dynamic>? _form;
  String? _loadError;
  bool _loading = true;

  List<Map<String, dynamic>> _allFirms = [];
  Map<String, dynamic>? _firmDetail;
  List<Map<String, dynamic>> _firmMembers = [];
  List<Map<String, dynamic>> _accounts = [];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 6, vsync: this);
    _bootstrap();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final ep = ref.read(endpointsProvider);
    try {
      final results = await Future.wait([
        ep.rawGet('/api/v1/me/lawyer-profile/'),
        ep.rawGet('/api/v1/firms/').catchError((_) => {'results': []}),
        ep.rawGet('/api/v1/payment-accounts/', query: {'scope': 'mine'})
            .catchError((_) => {'results': []}),
      ]);
      if (!mounted) return;
      setState(() {
        _form = Map<String, dynamic>.from(results[0] as Map);
        _allFirms = List<Map<String, dynamic>>.from(
            (results[1]['results'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _accounts = List<Map<String, dynamic>>.from(
            (results[2]['results'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _loading = false;
      });
      await _loadFirmDetail();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadError = 'Could not load profile.';
        _loading = false;
      });
    }
  }

  Future<void> _loadFirmDetail() async {
    final firmId = _form?['firm'];
    if (firmId == null) {
      if (!mounted) return;
      setState(() {
        _firmDetail = null;
        _firmMembers = [];
      });
      return;
    }
    final ep = ref.read(endpointsProvider);
    try {
      final detail = await ep.rawGet('/api/v1/firms/$firmId/');
      final lawyers = await ep.rawGet('/api/v1/lawyers/');
      if (!mounted) return;
      final all = (lawyers['results'] as List? ?? const [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      setState(() {
        _firmDetail = Map<String, dynamic>.from(detail as Map);
        _firmMembers = all
            .where((l) => (l['profile']?['firm']) == firmId)
            .toList();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _firmDetail = null;
        _firmMembers = [];
      });
    }
  }

  void _setField(String key, dynamic value) {
    setState(() => _form![key] = value);
  }

  Future<void> _refreshForm() async {
    try {
      final updated = await ref
          .read(endpointsProvider)
          .rawGet('/api/v1/me/lawyer-profile/');
      if (!mounted) return;
      setState(() => _form = Map<String, dynamic>.from(updated as Map));
      await _loadFirmDetail();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          labelColor: AppColors.brandDark,
          unselectedLabelColor: AppColors.muted,
          indicatorColor: AppColors.brandDark,
          labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          tabs: const [
            Tab(icon: Icon(LucideIcons.user, size: 16), text: 'Profile'),
            Tab(icon: Icon(LucideIcons.fileText, size: 16), text: 'KYC'),
            Tab(icon: Icon(LucideIcons.creditCard, size: 16), text: 'Rates'),
            Tab(icon: Icon(LucideIcons.wallet, size: 16), text: 'Payments'),
            Tab(icon: Icon(LucideIcons.building2, size: 16), text: 'Firm'),
            Tab(icon: Icon(LucideIcons.shield, size: 16), text: 'Security'),
          ],
        ),
      ),
      body: _loading
          ? const _LoadingBody()
          : _loadError != null
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: ErrorBanner(message: _loadError!),
                )
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _LawyerProfileTab(
                      form: _form!,
                      onChange: _setField,
                      onSaved: _refreshForm,
                    ),
                    _LawyerKycTab(
                      form: _form!,
                      onChange: _setField,
                      onSaved: _refreshForm,
                    ),
                    _LawyerRatesTab(
                      form: _form!,
                      onChange: _setField,
                      onSaved: _refreshForm,
                    ),
                    _PaymentAccountsTab(
                      accounts: _accounts,
                      onChange: (next) => setState(() => _accounts = next),
                    ),
                    _FirmTab(
                      me: me,
                      form: _form!,
                      firmDetail: _firmDetail,
                      firmMembers: _firmMembers,
                      allFirms: _allFirms,
                      onChanged: _refreshForm,
                      onFirmUpdated: (next) => setState(() => _firmDetail = next),
                    ),
                    SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: const [
                          _SecurityCard(),
                          SizedBox(height: 16),
                          _DangerZone(),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _LoadingBody extends StatelessWidget {
  const _LoadingBody();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Skeleton(height: 60, width: double.infinity),
        const SizedBox(height: 12),
        Skeleton(height: 200, width: double.infinity),
        const SizedBox(height: 12),
        Skeleton(height: 140, width: double.infinity),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LAWYER · PROFILE TAB
// ─────────────────────────────────────────────────────────────────────────

class _LawyerProfileTab extends ConsumerStatefulWidget {
  const _LawyerProfileTab({
    required this.form,
    required this.onChange,
    required this.onSaved,
  });
  final Map<String, dynamic> form;
  final void Function(String, dynamic) onChange;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_LawyerProfileTab> createState() => _LawyerProfileTabState();
}

class _LawyerProfileTabState extends ConsumerState<_LawyerProfileTab> {
  late TextEditingController _practiceAreas;
  late TextEditingController _jurisdictions;
  late TextEditingController _languages;
  late TextEditingController _years;
  late TextEditingController _bar;
  late TextEditingController _bio;
  String _country = '';
  bool _busy = false;
  String? _error;
  bool _savedFlash = false;

  @override
  void initState() {
    super.initState();
    final f = widget.form;
    _practiceAreas = TextEditingController(
      text: (f['practice_areas'] as List? ?? const []).join(', '),
    );
    _jurisdictions = TextEditingController(
      text: (f['jurisdictions'] as List? ?? const []).join(', '),
    );
    _languages = TextEditingController(
      text: (f['languages'] as List? ?? const []).join(', '),
    );
    _years = TextEditingController(text: '${f['years_experience'] ?? 0}');
    _bar = TextEditingController(text: f['bar_number'] as String? ?? '');
    _bio = TextEditingController(text: f['bio'] as String? ?? '');
    _country = f['country'] as String? ?? '';
  }

  @override
  void dispose() {
    _practiceAreas.dispose();
    _jurisdictions.dispose();
    _languages.dispose();
    _years.dispose();
    _bar.dispose();
    _bio.dispose();
    super.dispose();
  }

  List<String> _parse(String s) =>
      s.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{
        'practice_areas': _parse(_practiceAreas.text),
        'jurisdictions': _parse(_jurisdictions.text),
        'languages': _parse(_languages.text),
        'years_experience': int.tryParse(_years.text.trim()) ?? 0,
        'bar_number': _bar.text.trim(),
        'bio': _bio.text,
        'country': _country,
      };
      await ref
          .read(endpointsProvider)
          .rawPatch('/api/v1/me/lawyer-profile/', data: payload);
      await widget.onSaved();
      if (!mounted) return;
      setState(() => _savedFlash = true);
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _savedFlash = false);
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _AvatarRow(),
          const SizedBox(height: 16),
          const _SectionHeader(icon: LucideIcons.user, text: 'Profile'),
          const SizedBox(height: 12),
          _Field(
            label: 'Practice areas (comma separated)',
            child: TextField(controller: _practiceAreas),
          ),
          _Field(
            label: 'Country (for flag badge)',
            child: _CountryDropdown(
              value: _country,
              onChanged: (v) => setState(() => _country = v ?? ''),
            ),
          ),
          _Field(
            label: 'Languages',
            child: TextField(controller: _languages),
          ),
          _Field(
            label: 'Jurisdictions',
            child: TextField(controller: _jurisdictions),
          ),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Years experience',
                  child: TextField(
                    controller: _years,
                    keyboardType: TextInputType.number,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _Field(
                  label: 'Bar number',
                  child: TextField(controller: _bar),
                ),
              ),
            ],
          ),
          _Field(
            label: 'Bio',
            child: TextField(
              controller: _bio,
              maxLines: 4,
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 4),
            ErrorBanner(message: _error!),
          ],
          if (_savedFlash) ...[
            const SizedBox(height: 4),
            const Text('✓ Saved',
                style: TextStyle(
                    color: Color(0xFF047857),
                    fontWeight: FontWeight.w700,
                    fontSize: 12)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save changes'),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LAWYER · KYC TAB (practising certificate)
// ─────────────────────────────────────────────────────────────────────────

class _LawyerKycTab extends ConsumerStatefulWidget {
  const _LawyerKycTab({
    required this.form,
    required this.onChange,
    required this.onSaved,
  });
  final Map<String, dynamic> form;
  final void Function(String, dynamic) onChange;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_LawyerKycTab> createState() => _LawyerKycTabState();
}

class _LawyerKycTabState extends ConsumerState<_LawyerKycTab> {
  late TextEditingController _certNumber;
  DateTime? _issued;
  DateTime? _expires;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _certNumber = TextEditingController(
      text: widget.form['practising_certificate_number'] as String? ?? '',
    );
    final issuedRaw = widget.form['practising_certificate_issued'] as String?;
    if (issuedRaw != null && issuedRaw.isNotEmpty) {
      _issued = DateTime.tryParse(issuedRaw);
    }
    final raw = widget.form['practising_certificate_expires'] as String?;
    if (raw != null && raw.isNotEmpty) {
      _expires = DateTime.tryParse(raw);
    }
  }

  @override
  void dispose() {
    _certNumber.dispose();
    super.dispose();
  }

  Future<void> _pickIssued() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _issued ?? DateTime.now(),
      firstDate: DateTime(1970),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _issued = picked);
  }

  Future<void> _pickExpires() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _expires ?? DateTime.now().add(const Duration(days: 365)),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _expires = picked);
  }

  Future<void> _uploadCertificate() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    if (picked == null || picked.files.isEmpty) return;
    final f = picked.files.first;
    if (f.path == null) return;
    setState(() => _busy = true);
    try {
      final form = FormData.fromMap({
        'practising_certificate_file': await MultipartFile.fromFile(
          f.path!,
          filename: f.name,
        ),
      });
      await ref
          .read(endpointsProvider)
          .rawPatchMultipart('/api/v1/me/lawyer-profile/', form);
      await widget.onSaved();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Certificate uploaded.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{
        'practising_certificate_number': _certNumber.text.trim(),
        'practising_certificate_issued':
            _issued == null ? null : DateFormat('yyyy-MM-dd').format(_issued!),
        'practising_certificate_expires':
            _expires == null ? null : DateFormat('yyyy-MM-dd').format(_expires!),
      };
      await ref
          .read(endpointsProvider)
          .rawPatch('/api/v1/me/lawyer-profile/', data: payload);
      await widget.onSaved();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile saved.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasCert = (widget.form['practising_certificate_number'] as String?)
            ?.isNotEmpty ==
        true;
    final fileUrl = widget.form['practising_certificate_file_url'] as String?;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: _SectionHeader(
                  icon: LucideIcons.fileText,
                  text: 'Practising certificate',
                ),
              ),
              if (hasCert)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.brandLight.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.shieldCheck, size: 12, color: AppColors.brandDark),
                      SizedBox(width: 4),
                      Text(
                        'ON FILE',
                        style: TextStyle(
                            color: AppColors.brandDark,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.6),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Required for KYC. Your certificate is checked against the bar registry — make sure both fields are accurate.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          _Field(
            label: 'Certificate number',
            child: TextField(
              controller: _certNumber,
              decoration: const InputDecoration(hintText: 'e.g. PC-2026-0184'),
            ),
          ),
          _Field(
            label: 'Issued / admitted on',
            child: InkWell(
              onTap: _pickIssued,
              child: InputDecorator(
                decoration: const InputDecoration(),
                child: Text(
                  _issued == null
                      ? 'Select a date'
                      : DateFormat('d MMM yyyy').format(_issued!),
                  style: TextStyle(
                    color: _issued == null ? AppColors.muted : AppColors.ink,
                  ),
                ),
              ),
            ),
          ),
          _Field(
            label: 'Expires on',
            child: InkWell(
              onTap: _pickExpires,
              child: InputDecorator(
                decoration: const InputDecoration(),
                child: Text(
                  _expires == null
                      ? 'Select a date'
                      : DateFormat('d MMM yyyy').format(_expires!),
                  style: TextStyle(
                    color: _expires == null ? AppColors.muted : AppColors.ink,
                  ),
                ),
              ),
            ),
          ),
          _Field(
            label: 'Certificate file',
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surface,
                border: Border.all(
                  color: AppColors.line,
                  style: BorderStyle.solid,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  FilledButton(
                    onPressed: _busy ? null : _uploadCertificate,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                    ),
                    child: Text(_busy
                        ? 'Uploading…'
                        : fileUrl != null
                            ? 'Replace file'
                            : 'Upload PDF / image'),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: fileUrl != null
                        ? InkWell(
                            onTap: () => launchUrl(Uri.parse(fileUrl),
                                mode: LaunchMode.externalApplication),
                            child: const Text(
                              'View current certificate',
                              style: TextStyle(
                                  color: AppColors.brand, fontSize: 12),
                              overflow: TextOverflow.ellipsis,
                            ),
                          )
                        : const Text(
                            'No file uploaded yet.',
                            style: TextStyle(
                                color: AppColors.muted, fontSize: 12),
                          ),
                  ),
                ],
              ),
            ),
          ),
          if (_error != null) ErrorBanner(message: _error!),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save changes'),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LAWYER · RATES TAB
// ─────────────────────────────────────────────────────────────────────────

class _LawyerRatesTab extends ConsumerStatefulWidget {
  const _LawyerRatesTab({
    required this.form,
    required this.onChange,
    required this.onSaved,
  });
  final Map<String, dynamic> form;
  final void Function(String, dynamic) onChange;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_LawyerRatesTab> createState() => _LawyerRatesTabState();
}

class _LawyerRatesTabState extends ConsumerState<_LawyerRatesTab> {
  static const _step = 5;
  String? _hourly;
  late TextEditingController _consult;
  late TextEditingController _retainer;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _hourly = widget.form['hourly_rate'] as String?;
    _consult = TextEditingController(
      text: widget.form['consultation_price'] as String? ?? '',
    );
    _retainer = TextEditingController(
      text: widget.form['monthly_retainer_fee'] as String? ?? '',
    );
  }

  @override
  void dispose() {
    _consult.dispose();
    _retainer.dispose();
    super.dispose();
  }

  double? get _min {
    final v = widget.form['hourly_rate_min'] as String?;
    return v == null ? null : double.tryParse(v);
  }

  double? get _max {
    final v = widget.form['hourly_rate_max'] as String?;
    return v == null ? null : double.tryParse(v);
  }

  double? get _current {
    if (_hourly == null || _hourly!.isEmpty) return null;
    return double.tryParse(_hourly!);
  }

  void _stepRate(int direction) {
    final cur = _current;
    final min = _min;
    final max = _max;
    if (cur == null) {
      setState(() => _hourly = (min ?? 0).toStringAsFixed(2));
      return;
    }
    var next = cur + direction * _step;
    if (min != null) next = next < min ? min : next;
    if (max != null) next = next > max ? max : next;
    setState(() => _hourly = next.toStringAsFixed(2));
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{
        'hourly_rate': _hourly,
        'consultation_price': _consult.text.trim().isEmpty ? null : _consult.text.trim(),
        'monthly_retainer_fee': _retainer.text.trim().isEmpty ? null : _retainer.text.trim(),
      };
      await ref
          .read(endpointsProvider)
          .rawPatch('/api/v1/me/lawyer-profile/', data: payload);
      await widget.onSaved();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rates saved.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cur = _current;
    final min = _min;
    final max = _max;
    final bounded = min != null && max != null;
    final canDec = cur != null && (min == null || cur > min);
    final canInc = cur != null && (max == null || cur < max);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionHeader(
              icon: LucideIcons.creditCard, text: 'Your rates'),
          const SizedBox(height: 16),
          const Text('Hourly rate (USD)',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                  letterSpacing: 0.6)),
          const SizedBox(height: 8),
          Row(
            children: [
              _StepperButton(
                label: '−',
                onTap: canDec ? () => _stepRate(-1) : null,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    border: Border.all(color: AppColors.line),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    children: [
                      Text(
                        cur != null ? '\$${cur.toStringAsFixed(2)}' : '—',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      if (bounded)
                        Text(
                          'of \$${min.toStringAsFixed(0)}–\$${max.toStringAsFixed(0)}',
                          style: const TextStyle(
                              fontSize: 10,
                              color: AppColors.muted,
                              letterSpacing: 0.4),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _StepperButton(
                label: '+',
                onTap: canInc ? () => _stepRate(1) : null,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            bounded
                ? 'Within the bar-association bracket \$${min.toStringAsFixed(0)}–\$${max.toStringAsFixed(0)}.'
                : 'Bracket is derived from your country + years of experience.',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
          const SizedBox(height: 20),
          _Field(
            label: 'Consultation base (USD)',
            hint: 'Charged per consultation booking.',
            child: TextField(
              controller: _consult,
              keyboardType: TextInputType.number,
            ),
          ),
          const SizedBox(height: 12),
          _Field(
            label: 'Monthly retainer fee (USD)',
            hint: 'Billed to clients who keep you on retainer, every month.',
            child: TextField(
              controller: _retainer,
              keyboardType: TextInputType.number,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.3),
              border: Border.all(color: AppColors.brandLight),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'About your hourly rate',
                  style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: AppColors.brandDark,
                      fontSize: 12),
                ),
                SizedBox(height: 4),
                Text(
                  'Your rate is pegged to the local bar association\'s bracket '
                  'for your country and years of experience. Use +/− to adjust '
                  'within the bracket. Anything outside the band is clamped on save.',
                  style: TextStyle(color: AppColors.brandDark, fontSize: 11),
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            ErrorBanner(message: _error!),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save changes'),
          ),
        ],
      ),
    );
  }
}

class _StepperButton extends StatelessWidget {
  const _StepperButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 48,
        width: 48,
        decoration: BoxDecoration(
          color: AppColors.cardTint,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(10),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: enabled ? AppColors.ink : AppColors.muted.withValues(alpha: 0.4),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PAYMENT ACCOUNTS TAB
// ─────────────────────────────────────────────────────────────────────────

const _accountTypes = <Map<String, dynamic>>[
  {'value': 'ecocash', 'label': 'EcoCash', 'icon': LucideIcons.smartphone},
  {'value': 'onemoney', 'label': 'OneMoney', 'icon': LucideIcons.wallet},
  {'value': 'bank', 'label': 'Bank', 'icon': LucideIcons.landmark},
  {'value': 'innbucks', 'label': 'InnBucks', 'icon': LucideIcons.creditCard},
  {'value': 'omari', 'label': "O'mari", 'icon': LucideIcons.wallet},
  {'value': 'cash', 'label': 'Cash', 'icon': LucideIcons.creditCard},
];

IconData _iconForType(String t) {
  for (final a in _accountTypes) {
    if (a['value'] == t) return a['icon'] as IconData;
  }
  return LucideIcons.creditCard;
}

class _PaymentAccountsTab extends ConsumerStatefulWidget {
  const _PaymentAccountsTab({required this.accounts, required this.onChange});
  final List<Map<String, dynamic>> accounts;
  final ValueChanged<List<Map<String, dynamic>>> onChange;
  @override
  ConsumerState<_PaymentAccountsTab> createState() =>
      _PaymentAccountsTabState();
}

class _PaymentAccountsTabState extends ConsumerState<_PaymentAccountsTab> {
  Future<void> _delete(Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Remove ${a['account_type_display']} account?'),
        content: const Text(
            'Clients will no longer see this account when paying you.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref
          .read(endpointsProvider)
          .rawDelete('/api/v1/payment-accounts/${a['id']}/');
      final next = [...widget.accounts]..removeWhere((x) => x['id'] == a['id']);
      widget.onChange(next);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment account removed.')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openSheet({Map<String, dynamic>? record}) async {
    final saved = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PaymentAccountSheet(record: record),
    );
    if (saved == null) return;
    final next = [...widget.accounts];
    final idx = next.indexWhere((x) => x['id'] == saved['id']);
    if (idx == -1) {
      next.add(saved);
    } else {
      next[idx] = saved;
    }
    widget.onChange(next);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: _SectionHeader(
                  icon: LucideIcons.wallet,
                  text: 'Payment accounts',
                ),
              ),
              FilledButton.icon(
                onPressed: () => _openSheet(),
                icon: const Icon(LucideIcons.plus, size: 14),
                label: const Text('Add account'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Clients see these accounts when they pay you. Add an entry for every method you accept.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          if (widget.accounts.isEmpty)
            const EmptyState(
              icon: LucideIcons.wallet,
              title: 'No payment accounts yet',
              subtitle: 'Add one so clients know where to send funds.',
            )
          else
            for (final a in widget.accounts) _AccountRow(
              account: a,
              onEdit: () => _openSheet(record: a),
              onRemove: () => _delete(a),
            ),
        ],
      ),
    );
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({
    required this.account,
    required this.onEdit,
    required this.onRemove,
  });
  final Map<String, dynamic> account;
  final VoidCallback onEdit;
  final VoidCallback onRemove;
  @override
  Widget build(BuildContext context) {
    final icon = _iconForType(account['account_type'] as String? ?? '');
    final bank = account['bank_name'] as String?;
    final branch = account['branch'] as String?;
    final extras = [
      if (bank != null && bank.isNotEmpty) bank,
      if (branch != null && branch.isNotEmpty) branch,
    ].join(' · ');
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: AppColors.brandDark),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${account['account_type_display'] ?? ''}'
                  '${(account['account_name'] as String?)?.isNotEmpty == true ? ' · ${account['account_name']}' : ''}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                      fontSize: 13),
                ),
                Text(
                  '${account['identifier'] ?? ''}${extras.isEmpty ? '' : ' · $extras'}',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.muted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          IconButton(
            iconSize: 18,
            onPressed: onEdit,
            icon: const Icon(LucideIcons.edit, color: AppColors.muted),
          ),
          IconButton(
            iconSize: 18,
            onPressed: onRemove,
            icon: const Icon(LucideIcons.trash2, color: Colors.redAccent),
          ),
        ],
      ),
    );
  }
}

class _PaymentAccountSheet extends ConsumerStatefulWidget {
  const _PaymentAccountSheet({this.record});
  final Map<String, dynamic>? record;
  @override
  ConsumerState<_PaymentAccountSheet> createState() =>
      _PaymentAccountSheetState();
}

class _PaymentAccountSheetState extends ConsumerState<_PaymentAccountSheet> {
  late String _type;
  late TextEditingController _identifier;
  late TextEditingController _accountName;
  late TextEditingController _bankName;
  late TextEditingController _branch;
  late TextEditingController _swift;
  late TextEditingController _notes;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final r = widget.record;
    _type = r?['account_type'] as String? ?? 'ecocash';
    _identifier = TextEditingController(text: r?['identifier'] as String? ?? '');
    _accountName = TextEditingController(text: r?['account_name'] as String? ?? '');
    _bankName = TextEditingController(text: r?['bank_name'] as String? ?? '');
    _branch = TextEditingController(text: r?['branch'] as String? ?? '');
    _swift = TextEditingController(text: r?['swift_code'] as String? ?? '');
    _notes = TextEditingController(text: r?['notes'] as String? ?? '');
  }

  @override
  void dispose() {
    _identifier.dispose();
    _accountName.dispose();
    _bankName.dispose();
    _branch.dispose();
    _swift.dispose();
    _notes.dispose();
    super.dispose();
  }

  bool get _isBank => _type == 'bank';
  bool get _isEdit => widget.record != null;

  String get _identifierLabel {
    if (_type == 'bank') return 'Account number';
    if (_type == 'cash') return 'Hand-off location';
    return 'Phone number';
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = <String, dynamic>{
        'account_type': _type,
        'identifier': _identifier.text.trim(),
        'account_name': _accountName.text.trim(),
        'bank_name': _isBank ? _bankName.text.trim() : '',
        'branch': _isBank ? _branch.text.trim() : '',
        'swift_code': _isBank ? _swift.text.trim() : '',
        'notes': _notes.text.trim(),
      };
      final ep = ref.read(endpointsProvider);
      final saved = _isEdit
          ? await ep.rawPatch(
              '/api/v1/payment-accounts/${widget.record!['id']}/',
              data: payload,
            )
          : await ep.rawPost('/api/v1/payment-accounts/', data: payload);
      if (!mounted) return;
      Navigator.pop(context, Map<String, dynamic>.from(saved as Map));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        top: false,
        child: Container(
          constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.9),
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: AppColors.line,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Text(
                  _isEdit ? 'Edit payment account' : 'Add payment account',
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink),
                ),
                const SizedBox(height: 16),
                const Text('Method',
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.muted,
                        letterSpacing: 0.6)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final a in _accountTypes)
                      InkWell(
                        onTap: () =>
                            setState(() => _type = a['value'] as String),
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: (MediaQuery.of(context).size.width - 48) / 3,
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: _type == a['value']
                                ? AppColors.brand.withValues(alpha: 0.1)
                                : AppColors.surface,
                            border: Border.all(
                              color: _type == a['value']
                                  ? AppColors.brand
                                  : AppColors.line,
                            ),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                width: 28,
                                height: 28,
                                decoration: BoxDecoration(
                                  color: _type == a['value']
                                      ? AppColors.brand
                                      : AppColors.canvas,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(
                                  a['icon'] as IconData,
                                  size: 14,
                                  color: _type == a['value']
                                      ? Colors.white
                                      : AppColors.muted,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                a['label'] as String,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: _type == a['value']
                                      ? AppColors.brandDark
                                      : AppColors.ink,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                _Field(
                  label: _identifierLabel,
                  child: TextField(
                    controller: _identifier,
                    decoration: InputDecoration(
                      hintText:
                          _isBank ? '0000-0000-0000' : '+263 7…',
                    ),
                  ),
                ),
                _Field(
                  label: 'Account holder',
                  child: TextField(
                    controller: _accountName,
                    decoration: const InputDecoration(
                        hintText: 'Name on the account'),
                  ),
                ),
                if (_isBank) ...[
                  Row(
                    children: [
                      Expanded(
                        child: _Field(
                          label: 'Bank',
                          child: TextField(controller: _bankName),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _Field(
                          label: 'Branch',
                          child: TextField(controller: _branch),
                        ),
                      ),
                    ],
                  ),
                  _Field(
                    label: 'SWIFT / BIC',
                    child: TextField(controller: _swift),
                  ),
                ],
                _Field(
                  label: 'Notes (optional)',
                  child: TextField(
                    controller: _notes,
                    decoration: const InputDecoration(
                        hintText: 'Anything the payer should know'),
                  ),
                ),
                if (_error != null) ErrorBanner(message: _error!),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => Navigator.pop(context),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: Text(_busy
                            ? 'Saving…'
                            : _isEdit
                                ? 'Save changes'
                                : 'Add account'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FIRM TAB
// ─────────────────────────────────────────────────────────────────────────

class _FirmTab extends ConsumerStatefulWidget {
  const _FirmTab({
    required this.me,
    required this.form,
    required this.firmDetail,
    required this.firmMembers,
    required this.allFirms,
    required this.onChanged,
    required this.onFirmUpdated,
  });
  final dynamic me;
  final Map<String, dynamic> form;
  final Map<String, dynamic>? firmDetail;
  final List<Map<String, dynamic>> firmMembers;
  final List<Map<String, dynamic>> allFirms;
  final Future<void> Function() onChanged;
  final ValueChanged<Map<String, dynamic>> onFirmUpdated;
  @override
  ConsumerState<_FirmTab> createState() => _FirmTabState();
}

class _FirmTabState extends ConsumerState<_FirmTab> {
  bool _busy = false;
  bool _editing = false;
  late TextEditingController _name;
  late TextEditingController _website;
  late TextEditingController _description;
  late TextEditingController _defaultHourly;
  late TextEditingController _defaultConsult;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    _website = TextEditingController();
    _description = TextEditingController();
    _defaultHourly = TextEditingController();
    _defaultConsult = TextEditingController();
    _seed();
  }

  @override
  void didUpdateWidget(covariant _FirmTab old) {
    super.didUpdateWidget(old);
    if (old.firmDetail != widget.firmDetail) _seed();
  }

  void _seed() {
    final d = widget.firmDetail;
    if (d == null) return;
    _name.text = d['name'] as String? ?? '';
    _website.text = d['website'] as String? ?? '';
    _description.text = d['description'] as String? ?? '';
    _defaultHourly.text = d['default_hourly_rate'] as String? ?? '';
    _defaultConsult.text = d['default_consultation_price'] as String? ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    _website.dispose();
    _description.dispose();
    _defaultHourly.dispose();
    _defaultConsult.dispose();
    super.dispose();
  }

  Future<void> _join(int firmId) async {
    setState(() => _busy = true);
    try {
      await ref.read(endpointsProvider).rawPost(
            '/api/v1/me/firm/',
            data: {'firm_id': firmId},
          );
      await widget.onChanged();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Firm joined.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _leave() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Leave this firm?'),
        content: const Text(
            'You and the rest of the firm will lose shared oversight on matters.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Leave firm'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(endpointsProvider).rawDelete('/api/v1/me/firm/');
      await widget.onChanged();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('You left the firm.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveFirm() async {
    final firmId = widget.firmDetail?['id'];
    if (firmId == null) return;
    setState(() => _busy = true);
    try {
      final updated = await ref.read(endpointsProvider).rawPatch(
        '/api/v1/firms/$firmId/',
        data: {
          'name': _name.text.trim(),
          'website': _website.text.trim(),
          'description': _description.text,
          'default_hourly_rate':
              _defaultHourly.text.trim().isEmpty ? null : _defaultHourly.text.trim(),
          'default_consultation_price':
              _defaultConsult.text.trim().isEmpty ? null : _defaultConsult.text.trim(),
        },
      );
      widget.onFirmUpdated(Map<String, dynamic>.from(updated as Map));
      if (!mounted) return;
      setState(() => _editing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Firm details updated.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _claimAdmin() async {
    final firmId = widget.firmDetail?['id'];
    if (firmId == null || widget.me == null) return;
    try {
      final updated = await ref.read(endpointsProvider).rawPost(
            '/api/v1/firms/$firmId/admin/',
            data: {'user_id': widget.me.id},
          );
      widget.onFirmUpdated(Map<String, dynamic>.from(updated as Map));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('You are now an admin of ${updated['name']}.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _promote(int userId) async {
    final firmId = widget.firmDetail?['id'];
    if (firmId == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Make this lawyer the firm admin?'),
        content: const Text(
            'They will be able to edit firm details, rates and firm-wide payment accounts. You will keep all member privileges.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Promote'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final updated = await ref.read(endpointsProvider).rawPost(
            '/api/v1/firms/$firmId/admin/',
            data: {'user_id': userId},
          );
      widget.onFirmUpdated(Map<String, dynamic>.from(updated as Map));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Admin role transferred.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final firm = widget.firmDetail;
    final isAdmin = firm != null && widget.me != null && firm['admin'] == widget.me.id;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: _SectionHeader(
                    icon: LucideIcons.building2, text: 'Law firm'),
              ),
              if (firm != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.brandLight.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(LucideIcons.shieldCheck,
                          size: 12, color: AppColors.brandDark),
                      const SizedBox(width: 4),
                      Text(
                        (isAdmin ? 'Admin' : 'Member').toUpperCase(),
                        style: const TextStyle(
                            color: AppColors.brandDark,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.6),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (firm == null) ...[
            const Text(
              'Joining a firm gives every member shared oversight of all matters '
              'assigned to any lawyer in the firm. You can be in one firm at a time.',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            if (widget.allFirms.isEmpty)
              const Text('No firms available yet.',
                  style: TextStyle(color: AppColors.muted, fontSize: 13))
            else
              for (final f in widget.allFirms)
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
                              f['name'] as String? ?? '',
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.ink,
                                  fontSize: 13),
                            ),
                            Text(
                              '${f['lawyer_count'] ?? 0} lawyer${(f['lawyer_count'] ?? 0) == 1 ? '' : 's'}',
                              style: const TextStyle(
                                  fontSize: 11, color: AppColors.muted),
                            ),
                          ],
                        ),
                      ),
                      FilledButton(
                        onPressed: _busy ? null : () => _join(f['id'] as int),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                        ),
                        child: const Text('Join'),
                      ),
                    ],
                  ),
                ),
          ] else ...[
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(
                    color: AppColors.brandDark,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(LucideIcons.building2,
                      color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(firm['name'] as String? ?? '',
                          style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                              fontSize: 15)),
                      if ((firm['website'] as String?)?.isNotEmpty == true)
                        InkWell(
                          onTap: () => launchUrl(
                              Uri.parse(firm['website'] as String),
                              mode: LaunchMode.externalApplication),
                          child: Text(
                            firm['website'] as String,
                            style: const TextStyle(
                                color: AppColors.brand, fontSize: 11),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'You and other firm lawyers can see all matters assigned to any member of ${firm['name']}.',
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
            if (isAdmin) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.canvas,
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text('MANAGE FIRM',
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.muted,
                                  letterSpacing: 0.6)),
                        ),
                        if (!_editing)
                          TextButton.icon(
                            onPressed: () => setState(() => _editing = true),
                            icon:
                                const Icon(LucideIcons.edit, size: 14),
                            label: const Text('Edit'),
                          ),
                      ],
                    ),
                    if (_editing) ...[
                      _Field(label: 'Firm name', child: TextField(controller: _name)),
                      _Field(label: 'Website', child: TextField(controller: _website)),
                      _Field(
                        label: 'Description',
                        child: TextField(controller: _description, maxLines: 3),
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: _Field(
                              label: 'Default hourly rate',
                              child: TextField(
                                controller: _defaultHourly,
                                keyboardType: TextInputType.number,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _Field(
                              label: 'Default consultation',
                              child: TextField(
                                controller: _defaultConsult,
                                keyboardType: TextInputType.number,
                              ),
                            ),
                          ),
                        ],
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          OutlinedButton(
                            onPressed:
                                _busy ? null : () => setState(() => _editing = false),
                            child: const Text('Cancel'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: _busy ? null : _saveFirm,
                            child: Text(_busy ? 'Saving…' : 'Save firm'),
                          ),
                        ],
                      ),
                    ] else ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('HOURLY',
                                    style: TextStyle(
                                        fontSize: 9,
                                        color: AppColors.muted,
                                        letterSpacing: 0.6)),
                                Text(
                                  (firm['default_hourly_rate'] as String?)?.isNotEmpty == true
                                      ? '\$${firm['default_hourly_rate']}'
                                      : '—',
                                  style: const TextStyle(color: AppColors.ink),
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('CONSULTATION',
                                    style: TextStyle(
                                        fontSize: 9,
                                        color: AppColors.muted,
                                        letterSpacing: 0.6)),
                                Text(
                                  (firm['default_consultation_price'] as String?)?.isNotEmpty == true
                                      ? '\$${firm['default_consultation_price']}'
                                      : '—',
                                  style: const TextStyle(color: AppColors.ink),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.canvas,
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('MEMBERS',
                            style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: AppColors.muted,
                                letterSpacing: 0.6)),
                      ),
                      if (firm['admin'] == null)
                        FilledButton(
                          onPressed: _claimAdmin,
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 6),
                          ),
                          child: const Text('Claim admin',
                              style: TextStyle(fontSize: 11)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (widget.firmMembers.isEmpty)
                    const Text('Just you so far.',
                        style: TextStyle(
                            color: AppColors.muted, fontSize: 12))
                  else
                    for (final m in widget.firmMembers)
                      _MemberRow(
                        member: m,
                        isAdminMember: firm['admin'] == m['id'],
                        canPromote: isAdmin && firm['admin'] != m['id'],
                        onPromote: () => _promote(m['id'] as int),
                      ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _busy ? null : _leave,
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: AppColors.line),
              ),
              child: Text(_busy ? 'Working…' : 'Leave firm'),
            ),
          ],
        ],
      ),
    );
  }
}

class _MemberRow extends StatelessWidget {
  const _MemberRow({
    required this.member,
    required this.isAdminMember,
    required this.canPromote,
    required this.onPromote,
  });
  final Map<String, dynamic> member;
  final bool isAdminMember;
  final bool canPromote;
  final VoidCallback onPromote;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  member['full_name'] as String? ?? '',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                      fontSize: 12),
                ),
                Text(
                  member['email'] as String? ?? '',
                  style: const TextStyle(
                      fontSize: 10, color: AppColors.muted),
                ),
              ],
            ),
          ),
          if (isAdminMember)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.brandLight.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Text('ADMIN',
                  style: TextStyle(
                      color: AppColors.brandDark,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6)),
            )
          else if (canPromote)
            OutlinedButton(
              onPressed: onPromote,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 6),
                textStyle: const TextStyle(fontSize: 10),
              ),
              child: const Text('Make admin'),
            ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT SETTINGS
// ─────────────────────────────────────────────────────────────────────────

class _ClientSettings extends ConsumerStatefulWidget {
  const _ClientSettings();
  @override
  ConsumerState<_ClientSettings> createState() => _ClientSettingsState();
}

class _ClientSettingsState extends ConsumerState<_ClientSettings>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  Map<String, dynamic>? _profile;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ref
          .read(endpointsProvider)
          .rawGet('/api/v1/me/client-profile/');
      if (!mounted) return;
      setState(() {
        _profile = Map<String, dynamic>.from(res as Map);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadError = 'Could not load profile.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        bottom: TabBar(
          controller: _tabs,
          labelColor: AppColors.brandDark,
          unselectedLabelColor: AppColors.muted,
          indicatorColor: AppColors.brandDark,
          labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          tabs: const [
            Tab(icon: Icon(LucideIcons.user, size: 16), text: 'Profile'),
            Tab(icon: Icon(LucideIcons.fileText, size: 16), text: 'KYC'),
            Tab(icon: Icon(LucideIcons.shield, size: 16), text: 'Security'),
          ],
        ),
      ),
      body: _loading
          ? const _LoadingBody()
          : _loadError != null
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: ErrorBanner(message: _loadError!))
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _ClientProfileTab(
                      profile: _profile!,
                      onSaved: _load,
                    ),
                    _ClientKycTab(
                      profile: _profile!,
                      onSaved: _load,
                    ),
                    SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: const [
                          _SecurityCard(),
                          SizedBox(height: 16),
                          _DangerZone(),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _ClientProfileTab extends ConsumerStatefulWidget {
  const _ClientProfileTab({required this.profile, required this.onSaved});
  final Map<String, dynamic> profile;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_ClientProfileTab> createState() => _ClientProfileTabState();
}

class _ClientProfileTabState extends ConsumerState<_ClientProfileTab> {
  late TextEditingController _businessName;
  bool _isBusiness = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _businessName = TextEditingController(
        text: widget.profile['business_name'] as String? ?? '');
    _isBusiness = widget.profile['is_business'] as bool? ?? false;
  }

  @override
  void dispose() {
    _businessName.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final form = FormData.fromMap({
        'business_name': _businessName.text.trim(),
        'is_business': _isBusiness ? 'true' : 'false',
        'id_document_type':
            widget.profile['id_document_type'] as String? ?? 'national_id',
        'id_document_number':
            widget.profile['id_document_number'] as String? ?? '',
      });
      await ref
          .read(endpointsProvider)
          .rawPatchMultipart('/api/v1/me/client-profile/', form);
      await widget.onSaved();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile saved.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _AvatarRow(),
          const SizedBox(height: 20),
          const _SectionHeader(icon: LucideIcons.user, text: 'Profile'),
          const SizedBox(height: 12),
          CheckboxListTile(
            value: _isBusiness,
            onChanged: (v) => setState(() => _isBusiness = v ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text(
              "I'm booking as a business",
              style: TextStyle(fontSize: 13, color: AppColors.ink),
            ),
            dense: true,
          ),
          if (_isBusiness)
            _Field(
              label: 'Business name',
              child: TextField(controller: _businessName),
            ),
          if (_error != null) ErrorBanner(message: _error!),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save'),
          ),
        ],
      ),
    );
  }
}

class _ClientKycTab extends ConsumerStatefulWidget {
  const _ClientKycTab({required this.profile, required this.onSaved});
  final Map<String, dynamic> profile;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_ClientKycTab> createState() => _ClientKycTabState();
}

class _ClientKycTabState extends ConsumerState<_ClientKycTab> {
  late String _idType;
  late TextEditingController _idNumber;
  String? _pickedFilePath;
  String? _pickedFileName;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _idType = widget.profile['id_document_type'] as String? ?? 'national_id';
    _idNumber = TextEditingController(
        text: widget.profile['id_document_number'] as String? ?? '');
  }

  @override
  void dispose() {
    _idNumber.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    if (picked == null || picked.files.isEmpty) return;
    final f = picked.files.first;
    setState(() {
      _pickedFilePath = f.path;
      _pickedFileName = f.name;
    });
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final map = <String, dynamic>{
        'business_name': widget.profile['business_name'] as String? ?? '',
        'is_business': (widget.profile['is_business'] as bool? ?? false) ? 'true' : 'false',
        'id_document_type': _idType,
        'id_document_number': _idNumber.text.trim(),
      };
      if (_pickedFilePath != null) {
        map['id_document_file'] = await MultipartFile.fromFile(
          _pickedFilePath!,
          filename: _pickedFileName,
        );
      }
      final form = FormData.fromMap(map);
      await ref
          .read(endpointsProvider)
          .rawPatchMultipart('/api/v1/me/client-profile/', form);
      await widget.onSaved();
      if (!mounted) return;
      setState(() {
        _pickedFilePath = null;
        _pickedFileName = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_pickedFilePath != null
              ? 'KYC submitted — awaiting review.'
              : 'Profile saved.'),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.profile['kyc_status'] as String? ?? '';
    final statusDisplay = widget.profile['kyc_status_display'] as String? ?? status;
    final fileUrl = widget.profile['id_document_file_url'] as String?;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: _SectionHeader(
                    icon: LucideIcons.fileText,
                    text: 'KYC verification'),
              ),
              StatusPill(status: status, label: statusDisplay),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Upload a clear photo of a government-issued ID. Lawyers need this to open trust accounts on your behalf.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Document type',
                  child: DropdownButtonFormField<String>(
                    initialValue: _idType,
                    items: const [
                      DropdownMenuItem(
                          value: 'national_id', child: Text('National ID')),
                      DropdownMenuItem(
                          value: 'passport', child: Text('Passport')),
                      DropdownMenuItem(
                          value: 'drivers_licence',
                          child: Text("Driver's licence")),
                    ],
                    onChanged: (v) =>
                        setState(() => _idType = v ?? 'national_id'),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _Field(
                  label: 'Document number',
                  child: TextField(controller: _idNumber),
                ),
              ),
            ],
          ),
          _Field(
            label: 'Upload document',
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.cardTint,
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  FilledButton(
                    onPressed: _busy ? null : _pickFile,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                    ),
                    child: Text(fileUrl != null ? 'Replace file' : 'Choose file'),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _pickedFileName != null
                        ? Text(_pickedFileName!,
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.ink),
                            overflow: TextOverflow.ellipsis)
                        : (fileUrl != null
                            ? InkWell(
                                onTap: () => launchUrl(Uri.parse(fileUrl),
                                    mode: LaunchMode.externalApplication),
                                child: const Text('View uploaded ID',
                                    style: TextStyle(
                                        color: AppColors.brand,
                                        fontSize: 12)),
                              )
                            : const Text('PDF or image, no larger than 5MB.',
                                style: TextStyle(
                                    fontSize: 12, color: AppColors.muted))),
                  ),
                ],
              ),
            ),
          ),
          if (_error != null) ErrorBanner(message: _error!),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save'),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SECURITY CARD
// ─────────────────────────────────────────────────────────────────────────

class _SecurityCard extends ConsumerStatefulWidget {
  const _SecurityCard();
  @override
  ConsumerState<_SecurityCard> createState() => _SecurityCardState();
}

class _SecurityCardState extends ConsumerState<_SecurityCard> {
  String _stage = 'idle'; // idle, enrolling, disabling
  String _method = 'email';
  late TextEditingController _number;
  late TextEditingController _code;
  String? _challenge;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final me = ref.read(authProvider).me;
    _number = TextEditingController(
        text: me?.whatsappNumber ?? me?.phoneNumber ?? '');
    _code = TextEditingController();
  }

  @override
  void dispose() {
    _number.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _startEnroll() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(endpointsProvider).rawPost(
        '/api/v1/auth/2fa/setup/',
        data: {
          'method': _method,
          if (_method == 'whatsapp') 'whatsapp_number': _number.text.trim(),
        },
      );
      if (!mounted) return;
      setState(() {
        _challenge = (res as Map)['challenge_token'] as String?;
        _stage = 'enrolling';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Code sent via ${_method == 'email' ? 'email' : 'WhatsApp'}.'),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finishEnroll() async {
    if (_code.text.length != 6 || _challenge == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).rawPost(
        '/api/v1/auth/2fa/setup/confirm/',
        data: {'challenge_token': _challenge, 'code': _code.text.trim()},
      );
      await ref.read(authProvider.notifier).reloadMe();
      if (!mounted) return;
      setState(() {
        _stage = 'idle';
        _code.clear();
        _challenge = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Two-factor authentication is on.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _startDisable() async {
    final me = ref.read(authProvider).me;
    final method = me?.twoFactorMethod ?? 'email';
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref
          .read(endpointsProvider)
          .rawPost('/api/v1/auth/2fa/setup/', data: {'method': method});
      if (!mounted) return;
      setState(() {
        _challenge = (res as Map)['challenge_token'] as String?;
        _stage = 'disabling';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Code sent — enter it below to disable 2FA.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finishDisable() async {
    if (_code.text.length != 6 || _challenge == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).rawPost(
        '/api/v1/auth/2fa/disable/',
        data: {'challenge_token': _challenge, 'code': _code.text.trim()},
      );
      await ref.read(authProvider.notifier).reloadMe();
      if (!mounted) return;
      setState(() {
        _stage = 'idle';
        _code.clear();
        _challenge = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Two-factor authentication disabled.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final current = me?.twoFactorMethod ?? 'off';
    final enabled = current != 'off';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: _SectionHeader(
                    icon: LucideIcons.shield,
                    text: 'Two-factor authentication'),
              ),
              StatusPill(
                status: enabled ? 'active' : 'off',
                label: enabled ? 'On · $current' : 'Off',
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Add a second layer to your sign-in. We\'ll send a 6-digit code to your email or WhatsApp every time you log in.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          if (_stage == 'idle' && !enabled) ...[
            Row(
              children: [
                Expanded(
                  child: _MethodTile(
                    icon: LucideIcons.mail,
                    label: 'Email',
                    selected: _method == 'email',
                    onTap: () => setState(() => _method = 'email'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _MethodTile(
                    icon: LucideIcons.messageSquare,
                    label: 'WhatsApp',
                    selected: _method == 'whatsapp',
                    onTap: () => setState(() => _method = 'whatsapp'),
                  ),
                ),
              ],
            ),
            if (_method == 'whatsapp') ...[
              const SizedBox(height: 12),
              _Field(
                label: 'WhatsApp number',
                child: TextField(
                  controller: _number,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(hintText: '+263 77…'),
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (_error != null) ErrorBanner(message: _error!),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _busy ||
                        (_method == 'whatsapp' && _number.text.trim().isEmpty)
                    ? null
                    : _startEnroll,
                child: Text(_busy ? 'Sending code…' : 'Enable 2FA'),
              ),
            ),
          ],
          if (_stage == 'enrolling' || _stage == 'disabling') ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _stage == 'enrolling'
                    ? AppColors.brandLight.withValues(alpha: 0.3)
                    : const Color(0xFFFEE2E2),
                border: Border.all(
                  color: _stage == 'enrolling'
                      ? AppColors.brandLight
                      : const Color(0xFFFCA5A5),
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _stage == 'enrolling'
                        ? 'Enter the 6-digit code we just sent via $_method.'
                        : 'Enter the 6-digit code we sent to confirm.',
                    style: TextStyle(
                      fontSize: 12,
                      color: _stage == 'enrolling'
                          ? AppColors.brandDark
                          : const Color(0xFFB91C1C),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 24, letterSpacing: 8, fontFamily: 'monospace'),
                    decoration: const InputDecoration(
                        hintText: '••••••', counterText: ''),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 8),
                  if (_error != null) ErrorBanner(message: _error!),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      OutlinedButton(
                        onPressed: _busy
                            ? null
                            : () {
                                setState(() {
                                  _stage = 'idle';
                                  _code.clear();
                                  _challenge = null;
                                });
                              },
                        child: const Text('Cancel'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed:
                            _busy || _code.text.length != 6
                                ? null
                                : (_stage == 'enrolling'
                                    ? _finishEnroll
                                    : _finishDisable),
                        style: _stage == 'disabling'
                            ? FilledButton.styleFrom(
                                backgroundColor: Colors.red)
                            : null,
                        child: Text(_busy
                            ? 'Working…'
                            : _stage == 'enrolling'
                                ? 'Confirm'
                                : 'Disable'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
          if (_stage == 'idle' && enabled) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Currently sending codes via $current.',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.muted),
                  ),
                ),
                OutlinedButton(
                  onPressed: _busy ? null : _startDisable,
                  style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                  child: const Text('Disable 2FA'),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
          ],
        ],
      ),
    );
  }
}

class _MethodTile extends StatelessWidget {
  const _MethodTile({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.brand.withValues(alpha: 0.08)
              : AppColors.surface,
          border: Border.all(
            color: selected ? AppColors.brand : AppColors.line,
            width: selected ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: selected ? AppColors.brand : AppColors.canvas,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon,
                  size: 16,
                  color: selected ? Colors.white : AppColors.muted),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: selected ? AppColors.brandDark : AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DANGER ZONE
// ─────────────────────────────────────────────────────────────────────────

class _DangerZone extends ConsumerStatefulWidget {
  const _DangerZone();
  @override
  ConsumerState<_DangerZone> createState() => _DangerZoneState();
}

class _DangerZoneState extends ConsumerState<_DangerZone> {
  String? _busy; // 'export' | 'delete'

  Future<void> _exportData() async {
    setState(() => _busy = 'export');
    try {
      final data = await ref
          .read(endpointsProvider)
          .rawGet('/api/v1/me/export/');
      if (!mounted) return;
      // Show a sheet with the export size + preview snippet — full download is
      // a desktop affordance; on mobile we surface the payload in-app.
      final pretty = data.toString();
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Data export',
                    style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                        fontSize: 15)),
                const SizedBox(height: 6),
                const Text(
                    'Everything we hold about you. Tap-and-hold to copy.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12)),
                const SizedBox(height: 12),
                Container(
                  constraints: BoxConstraints(
                      maxHeight:
                          MediaQuery.of(context).size.height * 0.55),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    border: Border.all(color: AppColors.line),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: SingleChildScrollView(
                    child: SelectableText(
                      pretty,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _deleteAccount() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'This is irreversible. Your personal details will be anonymised and your sign-in will be disabled. Matter and ledger records are retained for compliance.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete account'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = 'delete');
    try {
      await ref.read(endpointsProvider).rawPost(
        '/api/v1/me/delete/',
        data: {'confirm': 'DELETE'},
      );
      if (!mounted) return;
      await ref.read(authProvider.notifier).logout();
      if (!mounted) return;
      context.go(Routes.landing);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        border: Border.all(color: const Color(0xFFFCA5A5)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'DANGER ZONE',
            style: TextStyle(
              color: Color(0xFFB91C1C),
              fontWeight: FontWeight.w700,
              fontSize: 11,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Export everything we hold about you, or delete your account.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy != null ? null : _exportData,
                  child: Text(_busy == 'export' ? 'Exporting…' : 'Export my data'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.red),
                  onPressed: _busy != null ? null : _deleteAccount,
                  child:
                      Text(_busy == 'delete' ? 'Deleting…' : 'Delete account'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED WIDGETS
// ─────────────────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.muted),
        const SizedBox(width: 6),
        Text(
          text.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.6,
          ),
        ),
      ],
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child, this.hint});
  final String label;
  final Widget child;
  final String? hint;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
                letterSpacing: 0.3,
              ),
            ),
          ),
          child,
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(hint!,
                style:
                    const TextStyle(fontSize: 11, color: AppColors.muted)),
          ],
        ],
      ),
    );
  }
}

class _CountryDropdown extends StatelessWidget {
  const _CountryDropdown({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String?> onChanged;
  @override
  Widget build(BuildContext context) {
    final entries = countryNames.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return DropdownButtonFormField<String>(
      initialValue: value.isEmpty ? null : value,
      isExpanded: true,
      items: [
        const DropdownMenuItem(value: '', child: Text('— Select —')),
        for (final e in entries)
          DropdownMenuItem(
            value: e.key,
            child: Text('${flagForCountry(e.key)}  ${e.value}'),
          ),
      ],
      onChanged: onChanged,
    );
  }
}

class _AvatarRow extends ConsumerStatefulWidget {
  const _AvatarRow();
  @override
  ConsumerState<_AvatarRow> createState() => _AvatarRowState();
}

class _AvatarRowState extends ConsumerState<_AvatarRow> {
  bool _busy = false;

  Future<void> _pickAvatar() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1024,
      imageQuality: 85,
    );
    if (picked == null) return;
    setState(() => _busy = true);
    try {
      final form = FormData.fromMap({
        'avatar': await MultipartFile.fromFile(
          picked.path,
          filename: picked.name,
        ),
      });
      await ref
          .read(endpointsProvider)
          .rawPostMultipart('/api/v1/users/me/avatar/', form);
      await ref.read(authProvider.notifier).reloadMe();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile picture updated.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeAvatar() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove profile picture?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(endpointsProvider)
          .rawDelete('/api/v1/users/me/avatar/');
      await ref.read(authProvider.notifier).reloadMe();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile picture removed.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final initials =
        '${me?.firstName.isNotEmpty == true ? me!.firstName[0] : '?'}'
        '${me?.lastName.isNotEmpty == true ? me!.lastName[0] : ''}';
    return Row(
      children: [
        Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.line),
                color: AppColors.canvas,
              ),
              clipBehavior: Clip.antiAlias,
              child: me?.avatarUrl != null
                  ? Image.network(
                      me!.avatarUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Center(
                        child: Text(
                          initials,
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: AppColors.brandDark,
                          ),
                        ),
                      ),
                    )
                  : Center(
                      child: Text(
                        initials,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          color: AppColors.brandDark,
                        ),
                      ),
                    ),
            ),
            Positioned(
              bottom: -2,
              right: -2,
              child: Material(
                color: AppColors.surface,
                shape: const CircleBorder(
                  side: BorderSide(color: AppColors.line),
                ),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _busy ? null : _pickAvatar,
                  child: const Padding(
                    padding: EdgeInsets.all(6),
                    child: Icon(LucideIcons.image,
                        size: 14, color: AppColors.brandDark),
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                me?.fullName ?? '',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                  fontSize: 15,
                ),
              ),
              Text(
                me?.email ?? '',
                style:
                    const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              if (me?.avatarUrl != null)
                TextButton.icon(
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 28),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    foregroundColor: AppColors.muted,
                  ),
                  onPressed: _busy ? null : _removeAvatar,
                  icon: const Icon(LucideIcons.trash2, size: 12),
                  label: const Text('Remove picture',
                      style: TextStyle(fontSize: 11)),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

