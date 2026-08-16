import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Lawyer opens a matter for a client — mirrors the web CreateMatterModal.
/// Pick an existing client, or invite a brand-new one by email; the backend
/// creates the matter (+ channel) and sends the invite when needed.
class CreateMatterScreen extends ConsumerStatefulWidget {
  const CreateMatterScreen({super.key});

  @override
  ConsumerState<CreateMatterScreen> createState() => _CreateMatterScreenState();
}

enum _Mode { existing, invite }

class _CreateMatterScreenState extends ConsumerState<CreateMatterScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _practiceArea = TextEditingController();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();

  _Mode _mode = _Mode.existing;
  int? _clientId;
  bool _submitting = false;
  String? _error;

  late Future<List<Map<String, dynamic>>> _clients;

  @override
  void initState() {
    super.initState();
    _clients = ref.read(endpointsProvider).listLawyerClients();
  }

  @override
  void dispose() {
    for (final c in [_title, _description, _practiceArea, _firstName, _lastName, _email, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _validate() {
    if (_title.text.trim().isEmpty) return 'Give the matter a title.';
    if (_mode == _Mode.existing) {
      if (_clientId == null) return 'Pick an existing client, or switch to Invite new.';
    } else {
      if (_firstName.text.trim().isEmpty || _lastName.text.trim().isEmpty) {
        return "Enter the new client's first and last name.";
      }
      if (_email.text.trim().isEmpty && _phone.text.trim().isEmpty) {
        return 'Add an email or phone so they can be reached.';
      }
    }
    return null;
  }

  Future<void> _submit() async {
    final err = _validate();
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final payload = <String, dynamic>{
      'title': _title.text.trim(),
      if (_description.text.trim().isNotEmpty) 'description': _description.text.trim(),
      if (_practiceArea.text.trim().isNotEmpty) 'practice_area': _practiceArea.text.trim(),
    };
    if (_mode == _Mode.existing) {
      payload['client_id'] = _clientId;
    } else {
      payload['contact'] = {
        'first_name': _firstName.text.trim(),
        'last_name': _lastName.text.trim(),
        if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
        if (_phone.text.trim().isNotEmpty) 'phone_number': _phone.text.trim(),
      };
    }
    try {
      final created = await ref.read(endpointsProvider).createMatterForClient(payload);
      final id = (created['id'] as num).toInt();
      final invited = created['invited'] == true;
      final clientEmail = created['client_email'] as String?;
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      // Replace this screen with the new matter room (web parity).
      context.pop();
      context.push(Routes.matter(id));
      messenger.showSnackBar(
        SnackBar(
          content: Text(invited
              ? 'New client invited${clientEmail != null ? ' · $clientEmail' : ''} — matter opened.'
              : 'Matter opened.'),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.canPop() ? context.pop() : context.go(Routes.matters),
        ),
        title: const Text('New matter'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_error != null) ...[
            ErrorBanner(message: _error!),
            const SizedBox(height: 12),
          ],
          _label('Matter title'),
          TextField(
            controller: _title,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: 'e.g. Lease dispute — 12 Baker St'),
          ),
          const SizedBox(height: 14),
          _label('Description (optional)'),
          TextField(
            controller: _description,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(hintText: 'A short note on what this matter covers'),
          ),
          const SizedBox(height: 14),
          _label('Practice area (optional)'),
          TextField(
            controller: _practiceArea,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(hintText: 'e.g. Property, Family, Commercial'),
          ),
          const SizedBox(height: 20),

          _label('Client'),
          const SizedBox(height: 4),
          SegmentedButton<_Mode>(
            segments: const [
              ButtonSegment(value: _Mode.existing, label: Text('Existing'), icon: Icon(LucideIcons.userCheck, size: 15)),
              ButtonSegment(value: _Mode.invite, label: Text('Invite new'), icon: Icon(LucideIcons.userPlus, size: 15)),
            ],
            selected: {_mode},
            onSelectionChanged: (s) => setState(() {
              _mode = s.first;
              _error = null;
            }),
          ),
          const SizedBox(height: 12),

          if (_mode == _Mode.existing)
            _existingPicker()
          else
            _inviteForm(),

          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(LucideIcons.folderPlus, size: 18),
            label: Text(_submitting ? 'Opening…' : 'Open matter'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        ],
      ),
    );
  }

  Widget _existingPicker() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _clients,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return Skeleton(height: 54, width: double.infinity);
        }
        final clients = snap.data ?? const <Map<String, dynamic>>[];
        if (clients.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.canvas,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text(
              'No existing clients yet — switch to “Invite new” to bring one on.',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          );
        }
        return DropdownButtonFormField<int>(
          initialValue: _clientId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Choose a client'),
          items: [
            for (final c in clients)
              DropdownMenuItem(
                value: (c['id'] as num).toInt(),
                child: Text(
                  '${c['full_name'] ?? 'Client'}${(c['email'] ?? '').toString().isNotEmpty ? ' · ${c['email']}' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: (v) => setState(() {
            _clientId = v;
            _error = null;
          }),
        );
      },
    );
  }

  Widget _inviteForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _firstName,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'First name'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _lastName,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Last name'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Email (for the invite)'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Phone (optional)'),
        ),
        const SizedBox(height: 8),
        const Text(
          'We’ll email them a link to set a password and join the matter room.',
          style: TextStyle(fontSize: 11, color: AppColors.muted),
        ),
      ],
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.5),
        ),
      );
}
