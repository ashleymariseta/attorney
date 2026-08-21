import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/endpoints.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';

/// Blocking verification screen for lawyers who haven't submitted their
/// practising credentials. Mirrors the web VerificationGateModal: it can't be
/// dismissed — the only ways out are submitting the certificate or logging out.
/// Shown by AppShell when `me.lawyerNeedsVerification` is true.
class LawyerVerificationScreen extends ConsumerStatefulWidget {
  const LawyerVerificationScreen({super.key});

  @override
  ConsumerState<LawyerVerificationScreen> createState() =>
      _LawyerVerificationScreenState();
}

class _LawyerVerificationScreenState
    extends ConsumerState<LawyerVerificationScreen> {
  final _certNumber = TextEditingController();
  final _barNumber = TextEditingController();
  final _retainerFee = TextEditingController();
  DateTime? _issued;
  DateTime? _expires;
  String? _fileName;
  String? _filePath;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _certNumber.dispose();
    _barNumber.dispose();
    _retainerFee.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool issued}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: issued ? now : now.add(const Duration(days: 365)),
      firstDate: DateTime(1970),
      lastDate: DateTime(2100),
    );
    if (picked != null) {
      setState(() => issued ? _issued = picked : _expires = picked);
    }
  }

  Future<void> _pickFile() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    if (picked == null || picked.files.isEmpty) return;
    final f = picked.files.first;
    if (f.path == null) return;
    setState(() {
      _fileName = f.name;
      _filePath = f.path;
    });
  }

  Future<void> _submit() async {
    if (_certNumber.text.trim().isEmpty) {
      setState(() => _error = 'Enter your practising certificate number.');
      return;
    }
    if (_issued == null) {
      setState(() => _error = 'Enter the date your certificate was issued.');
      return;
    }
    if (_filePath == null) {
      setState(() => _error = 'Upload a copy of your practising certificate.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final fmt = DateFormat('yyyy-MM-dd');
      final form = FormData.fromMap({
        'bar_number': _barNumber.text.trim(),
        'practising_certificate_number': _certNumber.text.trim(),
        'practising_certificate_issued': fmt.format(_issued!),
        if (_expires != null)
          'practising_certificate_expires': fmt.format(_expires!),
        if (_retainerFee.text.trim().isNotEmpty)
          'monthly_retainer_fee': _retainerFee.text.trim(),
        'practising_certificate_file':
            await MultipartFile.fromFile(_filePath!, filename: _fileName),
      });
      await ref
          .read(endpointsProvider)
          .rawPatchMultipart('/api/v1/me/lawyer-profile/', form);
      await ref.read(authProvider.notifier).reloadMe();
      // On success `me.lawyerNeedsVerification` flips false and AppShell
      // stops rendering this screen.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not submit. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('d MMM yyyy');
    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppColors.brandLight,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Icon(LucideIcons.shieldCheck,
                            size: 20, color: AppColors.brandDark),
                      ),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Verify your credentials',
                                style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.ink)),
                            Text('Required before you can practise on Legal Online.',
                                style: TextStyle(
                                    fontSize: 12, color: AppColors.muted)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'To protect clients, every practitioner is verified before '
                    'taking on work. Enter your certificate details and upload '
                    'your practising certificate.',
                    style: TextStyle(fontSize: 14, color: AppColors.muted),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _certNumber,
                    decoration: const InputDecoration(
                        labelText: 'Practising certificate number'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _barNumber,
                    decoration: const InputDecoration(
                        labelText: 'Bar / roll number (optional)'),
                  ),
                  const SizedBox(height: 12),
                  _DateRow(
                    label: 'Issued / admitted on',
                    value: _issued == null ? 'Choose date' : df.format(_issued!),
                    hint: 'Used to calculate your years of experience.',
                    onTap: () => _pickDate(issued: true),
                  ),
                  const SizedBox(height: 12),
                  _DateRow(
                    label: 'Expiry (optional)',
                    value:
                        _expires == null ? 'Choose date' : df.format(_expires!),
                    onTap: () => _pickDate(issued: false),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _retainerFee,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Monthly retainer fee (USD)',
                      prefixText: '\$ ',
                      helperText: 'What a client pays each month to keep you on retainer.',
                      helperMaxLines: 2,
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _pickFile,
                    icon: const Icon(LucideIcons.upload, size: 16),
                    label: Text(_fileName ?? 'Upload practising certificate'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(_error!,
                          style: const TextStyle(
                              color: Color(0xFFB91C1C), fontSize: 13)),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: Text(_busy ? 'Submitting…' : 'Submit for verification'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => ref.read(authProvider.notifier).logout(),
                    child: const Text('Log out instead'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DateRow extends StatelessWidget {
  const _DateRow({
    required this.label,
    required this.value,
    required this.onTap,
    this.hint,
  });
  final String label;
  final String value;
  final String? hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InputDecorator(
          decoration: InputDecoration(labelText: label),
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(value, style: const TextStyle(color: AppColors.ink)),
                  const Icon(LucideIcons.calendar,
                      size: 16, color: AppColors.muted),
                ],
              ),
            ),
          ),
        ),
        if (hint != null)
          Padding(
            padding: const EdgeInsets.only(top: 4, left: 2),
            child: Text(hint!,
                style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          ),
      ],
    );
  }
}
