import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Multi-step booking flow. Mirrors frontend/components/BookModal.tsx:
///  Step 1: Matter (title, practice areas, description)
///  Step 2: Schedule (preferred time, duration, mode)
///  Step 3: Payment (method) + summary + confirm
///  Then: optional proof-of-payment upload, then success state.
class BookLawyerScreen extends ConsumerStatefulWidget {
  const BookLawyerScreen({super.key, required this.lawyerId});
  final int lawyerId;

  @override
  ConsumerState<BookLawyerScreen> createState() => _BookLawyerScreenState();
}

const _durations = <int>[15, 30, 45, 60, 90, 120];

const _modes = <_Choice>[
  _Choice(value: 'video', label: 'Video call', icon: LucideIcons.video, sub: 'Meet on screen'),
  _Choice(value: 'phone', label: 'Phone call', icon: LucideIcons.phone, sub: 'Just a call'),
  _Choice(value: 'in_person', label: 'In person', icon: LucideIcons.mapPin, sub: 'At their office'),
];

const _payMethods = <_Choice>[
  _Choice(value: 'ecocash', label: 'EcoCash', icon: LucideIcons.smartphone, sub: 'Mobile money'),
  _Choice(value: 'onemoney', label: 'OneMoney', icon: LucideIcons.wallet, sub: 'Mobile money'),
  _Choice(value: 'bank', label: 'Bank', icon: LucideIcons.landmark, sub: 'EFT transfer'),
  _Choice(value: 'innbucks', label: 'InnBucks', icon: LucideIcons.creditCard, sub: 'Mobile wallet'),
  _Choice(value: 'omari', label: "O'mari", icon: LucideIcons.wallet, sub: 'Mobile wallet'),
  _Choice(value: 'cash', label: 'Cash', icon: LucideIcons.creditCard, sub: 'Pay in person'),
];

const _cashlessMethods = <String>{'ecocash', 'onemoney', 'bank', 'innbucks', 'omari'};

enum _Step { matter, schedule, payment, proof, done }

class _BookLawyerScreenState extends ConsumerState<BookLawyerScreen> {
  Lawyer? _lawyer;
  String? _loadError;
  bool _loading = true;

  _Step _step = _Step.matter;

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _refCtrl = TextEditingController();

  final Set<String> _areas = {};
  DateTime? _scheduledAt;
  int _duration = 30;
  String _mode = 'video';
  String _payMethod = 'ecocash';

  bool _busy = false;
  String? _error;

  int? _matterId;
  int? _paymentId;
  String? _proofPath;
  String? _proofName;

  @override
  void initState() {
    super.initState();
    _loadLawyer();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _refCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadLawyer() async {
    try {
      final l = await ref.read(endpointsProvider).getLawyer(widget.lawyerId);
      if (!mounted) return;
      setState(() {
        _lawyer = l;
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
        _loadError = 'We could not find this lawyer.';
        _loading = false;
      });
    }
  }

  double get _price {
    final rateStr = _lawyer?.hourlyRate;
    final rate = rateStr == null ? 0.0 : double.tryParse(rateStr) ?? 0.0;
    return (rate * _duration) / 60.0;
  }

  bool get _onRetainer => _lawyer?.onRetainer ?? false;

  int get _totalSteps => _onRetainer ? 1 : 3;

  int get _currentStageIndex {
    switch (_step) {
      case _Step.matter:
        return 0;
      case _Step.schedule:
        return 1;
      case _Step.payment:
        return 2;
      default:
        return 2;
    }
  }

  void _next() {
    if (_step == _Step.matter && _titleCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Give your matter a short title to continue.');
      return;
    }
    setState(() {
      _error = null;
      if (_onRetainer) {
        _submit();
      } else if (_step == _Step.matter) {
        _step = _Step.schedule;
      } else if (_step == _Step.schedule) {
        _step = _Step.payment;
      }
    });
  }

  void _back() {
    setState(() {
      _error = null;
      if (_step == _Step.schedule) {
        _step = _Step.matter;
      } else if (_step == _Step.payment) {
        _step = _Step.schedule;
      }
    });
  }

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final initial = _scheduledAt ?? now.add(const Duration(hours: 24));
    final d = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (d == null) return;
    if (!mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (t == null) return;
    setState(() {
      _scheduledAt = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    });
  }

  Future<void> _submit() async {
    if (_lawyer == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final isCashless = _cashlessMethods.contains(_payMethod);
      final backendPayMethod = isCashless ? 'online' : 'cash';
      final providerLabel = _payMethods.firstWhere(
        (m) => m.value == _payMethod,
        orElse: () => _payMethods.first,
      ).label;
      final desc = _descCtrl.text.trim();
      final noteWithProvider = isCashless
          ? '$providerLabel${desc.isEmpty ? '' : ' — $desc'}'
          : desc;

      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'lawyer': _lawyer!.id,
        'description': noteWithProvider,
        'practice_areas': _areas.toList(),
        'duration_minutes': _duration,
        'consult_method': _mode,
        'payment_method': backendPayMethod,
        if (_scheduledAt != null)
          'scheduled_time': _scheduledAt!.toUtc().toIso8601String(),
      };

      final created = await ref.read(endpointsProvider).createMatter(payload);
      _matterId = (created['id'] as num?)?.toInt();
      _paymentId = (created['payment_id'] as num?)?.toInt();

      if (!mounted) return;

      if (_onRetainer) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Workspace opened with ${_lawyer!.fullName}.')),
        );
        if (_matterId != null) context.push(Routes.matter(_matterId!));
        return;
      }

      if (backendPayMethod == 'online' && _paymentId != null) {
        setState(() => _step = _Step.proof);
      } else {
        setState(() => _step = _Step.done);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not start the engagement.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickProofFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
      withData: false,
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.single;
    if (f.path == null) return;
    setState(() {
      _proofPath = f.path;
      _proofName = f.name;
    });
  }

  Future<void> _uploadProof() async {
    if (_paymentId == null) return;
    if (_proofPath == null) {
      setState(() => _error = 'Choose your proof of payment file.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final form = FormData.fromMap({
        'proof_of_payment': await MultipartFile.fromFile(
          _proofPath!,
          filename: _proofName ?? 'proof',
        ),
        if (_refCtrl.text.trim().isNotEmpty) 'reference': _refCtrl.text.trim(),
      });
      await ref.read(endpointsProvider).rawPostMultipart(
            '/api/v1/payments/$_paymentId/upload-proof/',
            form,
          );
      if (!mounted) return;
      setState(() => _step = _Step.done);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Upload failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go(Routes.lawyersPublic),
        ),
        title: Text(_onRetainer ? 'Open workspace' : 'Book consultation'),
      ),
      body: _loading
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Skeleton(height: 80, width: double.infinity),
                const SizedBox(height: 12),
                Skeleton(height: 200, width: double.infinity),
              ],
            )
          : _loadError != null
              ? ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    ErrorBanner(message: _loadError!),
                    const SizedBox(height: 12),
                    Center(
                      child: OutlinedButton.icon(
                        icon: const Icon(LucideIcons.chevronLeft, size: 14),
                        label: const Text('Back to directory'),
                        onPressed: () => context.go(Routes.lawyersPublic),
                      ),
                    ),
                  ],
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _header(),
                    const SizedBox(height: 12),
                    if (_step == _Step.matter ||
                        _step == _Step.schedule ||
                        _step == _Step.payment)
                      _stepBody()
                    else if (_step == _Step.proof)
                      _proofBody()
                    else
                      _doneBody(),
                  ],
                ),
    );
  }

  Widget _header() {
    final lawyer = _lawyer!;
    final initials = lawyer.fullName.isEmpty
        ? '?'
        : lawyer.fullName
            .trim()
            .split(RegExp(r'\s+'))
            .take(2)
            .map((p) => p.isEmpty ? '' : p[0])
            .join();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
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
                radius: 22,
                backgroundColor: AppColors.brandLight,
                foregroundImage: (lawyer.avatarUrl?.isNotEmpty ?? false)
                    ? CachedNetworkImageProvider(lawyer.avatarUrl!, maxWidth: 150)
                    : null,
                child: Text(
                  initials.toUpperCase(),
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
                    Text(
                      _onRetainer ? 'Open a workspace' : 'Book a consultation',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      'with ${lawyer.fullName}'
                      '${(!_onRetainer && (lawyer.hourlyRate?.isNotEmpty ?? false)) ? ' · \$${lawyer.hourlyRate}/hr' : ''}',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (!_onRetainer &&
              (_step == _Step.matter || _step == _Step.schedule || _step == _Step.payment)) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  'Step ${_currentStageIndex + 1}',
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted,
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  'of $_totalSteps',
                  style: const TextStyle(fontSize: 10, color: AppColors.muted),
                ),
                const Spacer(),
                Text(
                  _stageLabel(_currentStageIndex),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandDark,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                for (var i = 0; i < _totalSteps; i++) ...[
                  Expanded(
                    child: Container(
                      height: 4,
                      decoration: BoxDecoration(
                        color: i <= _currentStageIndex ? AppColors.brandDark : AppColors.line,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  if (i < _totalSteps - 1) const SizedBox(width: 4),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _stageLabel(int i) {
    switch (i) {
      case 0:
        return 'Matter';
      case 1:
        return 'Schedule';
      default:
        return 'Payment';
    }
  }

  Widget _stepBody() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_onRetainer) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.brandLight.withValues(alpha: 0.4),
                border: Border.all(color: AppColors.brandLight),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: const [
                  Icon(LucideIcons.graduationCap, size: 18, color: AppColors.brandDark),
                  SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'On your legal team',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.brandDark,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          'No consultation or payment needed — we’ll open the room.',
                          style: TextStyle(color: AppColors.brandDark, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (_onRetainer || _step == _Step.matter) _matterStage(),
          if (!_onRetainer && _step == _Step.schedule) _scheduleStage(),
          if (!_onRetainer && _step == _Step.payment) _paymentStage(),
          if (_error != null) ...[
            const SizedBox(height: 12),
            ErrorBanner(message: _error!),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              if (!_onRetainer && _step != _Step.matter)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _back,
                    icon: const Icon(LucideIcons.chevronLeft, size: 16),
                    label: const Text('Back'),
                  ),
                )
              else
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => context.canPop()
                            ? context.pop()
                            : context.go(Routes.lawyersPublic),
                    child: const Text('Cancel'),
                  ),
                ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy
                      ? null
                      : (_onRetainer || _step == _Step.payment ? _submit : _next),
                  icon: Icon(
                    _onRetainer || _step == _Step.payment
                        ? LucideIcons.check
                        : LucideIcons.chevronRight,
                    size: 16,
                  ),
                  label: Text(
                    _busy
                        ? 'Working…'
                        : _onRetainer
                            ? 'Open workspace'
                            : _step == _Step.payment
                                ? 'Confirm booking'
                                : 'Continue',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _matterStage() {
    final available = _lawyer?.profile?.practiceAreas ?? const [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldLabel(icon: LucideIcons.fileText, label: 'What do you need help with?'),
        const SizedBox(height: 6),
        TextField(
          controller: _titleCtrl,
          decoration: const InputDecoration(hintText: 'e.g. Review my commercial lease'),
        ),
        const SizedBox(height: 12),
        if (available.isNotEmpty) ...[
          _FieldLabel(
            icon: LucideIcons.tag,
            label: 'Practice area(s)',
            hint: 'Optional — pick any that apply.',
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final a in available)
                _ToggleChip(
                  label: a,
                  active: _areas.contains(a),
                  onTap: () => setState(() {
                    if (_areas.contains(a)) {
                      _areas.remove(a);
                    } else {
                      _areas.add(a);
                    }
                  }),
                ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        _FieldLabel(
          icon: LucideIcons.fileText,
          label: 'Details',
          hint: 'Optional. The lawyer will see this before the consult.',
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _descCtrl,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(
            hintText: 'A short summary helps your lawyer prepare.',
          ),
        ),
      ],
    );
  }

  Widget _scheduleStage() {
    final whenLabel = _scheduledAt == null
        ? 'Flexible'
        : DateFormat('EEE d MMM · HH:mm').format(_scheduledAt!.toLocal());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldLabel(icon: LucideIcons.calendar, label: 'Preferred time'),
        const SizedBox(height: 6),
        OutlinedButton.icon(
          onPressed: _pickDateTime,
          icon: const Icon(LucideIcons.calendar, size: 16),
          label: Text(whenLabel),
        ),
        if (_scheduledAt != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _scheduledAt = null),
              icon: const Icon(LucideIcons.x, size: 14),
              label: const Text('Clear'),
            ),
          ),
        const SizedBox(height: 12),
        _FieldLabel(icon: LucideIcons.clock, label: 'Duration'),
        const SizedBox(height: 6),
        DropdownButtonFormField<int>(
          initialValue: _duration,
          items: [
            for (final d in _durations) DropdownMenuItem(value: d, child: Text('$d min')),
          ],
          onChanged: (v) => setState(() => _duration = v ?? 30),
        ),
        const SizedBox(height: 12),
        const Text(
          'HOW WOULD YOU LIKE TO CONSULT?',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.6,
          ),
        ),
        const SizedBox(height: 6),
        _ChoiceGrid(
          choices: _modes,
          active: _mode,
          onTap: (v) => setState(() => _mode = v),
        ),
      ],
    );
  }

  Widget _paymentStage() {
    final rate = _lawyer?.hourlyRate ?? '0';
    final modeChoice = _modes.firstWhere((m) => m.value == _mode, orElse: () => _modes.first);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'PAYMENT METHOD',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
            letterSpacing: 0.6,
          ),
        ),
        const SizedBox(height: 6),
        _ChoiceGrid(
          choices: _payMethods,
          active: _payMethod,
          onTap: (v) => setState(() => _payMethod = v),
        ),
        const SizedBox(height: 14),
        Container(
          decoration: BoxDecoration(
            color: AppColors.canvas,
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'SUMMARY',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 8),
              _SummaryRow(
                icon: LucideIcons.fileText,
                label: 'Matter',
                value: _titleCtrl.text.trim().isEmpty ? '—' : _titleCtrl.text.trim(),
              ),
              _SummaryRow(
                icon: LucideIcons.calendar,
                label: 'When',
                value: _scheduledAt == null
                    ? 'Flexible'
                    : DateFormat('EEE d MMM · HH:mm').format(_scheduledAt!.toLocal()),
              ),
              _SummaryRow(icon: LucideIcons.clock, label: 'Duration', value: '$_duration min'),
              _SummaryRow(icon: modeChoice.icon, label: 'Mode', value: modeChoice.label),
              const Divider(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '$_duration min × \$$rate/hr',
                    style: const TextStyle(fontSize: 11, color: AppColors.muted),
                  ),
                  Text(
                    '\$${_price.toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _proofBody() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 20,
                backgroundColor: AppColors.brandLight,
                child: Icon(LucideIcons.receipt, color: AppColors.brandDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'AMOUNT DUE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.muted,
                        letterSpacing: 0.6,
                      ),
                    ),
                    Text(
                      '\$${_price.toStringAsFixed(2)}',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Upload your proof of payment to submit this booking.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 14),
          _FieldLabel(icon: LucideIcons.receipt, label: 'Proof of payment'),
          const SizedBox(height: 6),
          InkWell(
            onTap: _pickProofFile,
            borderRadius: BorderRadius.circular(10),
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
                  Expanded(
                    child: Text(
                      _proofName ?? 'Choose a PDF or image…',
                      style: TextStyle(
                        fontSize: 13,
                        color: _proofName == null ? AppColors.muted : AppColors.ink,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.brandDark,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text(
                      'Browse',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          _FieldLabel(
            icon: LucideIcons.tag,
            label: 'Bank reference',
            hint: 'Optional, helps with reconciliation.',
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _refCtrl,
            decoration: const InputDecoration(hintText: 'e.g. TX-29481'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            ErrorBanner(message: _error!),
          ],
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy ? null : _uploadProof,
            icon: const Icon(LucideIcons.check, size: 16),
            label: Text(_busy ? 'Uploading…' : 'Submit proof of payment'),
          ),
        ],
      ),
    );
  }

  Widget _doneBody() {
    final cash = _payMethod == 'cash';
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                color: Color(0xFFECFDF5),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Icon(LucideIcons.check, color: Color(0xFF047857), size: 28),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Booking submitted',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink),
          ),
          const SizedBox(height: 8),
          Text(
            cash
                ? 'You chose to pay cash in person. We’ve notified ${_lawyer?.fullName ?? 'the lawyer'}. You’ll see the status update once they confirm.'
                : 'Your proof of payment is in review. We’ve notified ${_lawyer?.fullName ?? 'the lawyer'}. You’ll see the status update once they confirm.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.muted, height: 1.4),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _matterId == null ? null : () => context.push(Routes.matter(_matterId!)),
            icon: const Icon(LucideIcons.chevronRight, size: 16),
            label: const Text('Go to matter room'),
          ),
        ],
      ),
    );
  }
}

class _Choice {
  const _Choice({required this.value, required this.label, required this.icon, required this.sub});
  final String value;
  final String label;
  final IconData icon;
  final String sub;
}

class _ChoiceGrid extends StatelessWidget {
  const _ChoiceGrid({required this.choices, required this.active, required this.onTap});
  final List<_Choice> choices;
  final String active;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final cols = c.maxWidth > 360 ? 3 : 2;
        final gap = 8.0;
        final tileWidth = (c.maxWidth - gap * (cols - 1)) / cols;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final ch in choices)
              SizedBox(
                width: tileWidth,
                child: _ChoiceTile(
                  choice: ch,
                  active: ch.value == active,
                  onTap: () => onTap(ch.value),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({required this.choice, required this.active, required this.onTap});
  final _Choice choice;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: active ? AppColors.brand.withValues(alpha: 0.06) : AppColors.surface,
          border: Border.all(color: active ? AppColors.brand : AppColors.line),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: active ? AppColors.brand : AppColors.canvas,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                choice.icon,
                size: 16,
                color: active ? Colors.white : AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              choice.label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: active ? AppColors.brandDark : AppColors.ink,
              ),
            ),
            Text(
              choice.sub,
              style: const TextStyle(fontSize: 10, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToggleChip extends StatelessWidget {
  const _ToggleChip({required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.brand : AppColors.surface,
          border: Border.all(color: active ? AppColors.brand : AppColors.line),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (active) const Icon(LucideIcons.check, size: 12, color: Colors.white),
            if (active) const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: active ? Colors.white : AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.icon, required this.label, this.hint});
  final IconData icon;
  final String label;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 12, color: AppColors.muted),
            const SizedBox(width: 6),
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: AppColors.muted,
                letterSpacing: 0.6,
              ),
            ),
          ],
        ),
        if (hint != null) ...[
          const SizedBox(height: 2),
          Text(hint!, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
        ],
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(icon, size: 13, color: AppColors.muted),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: AppColors.ink, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

