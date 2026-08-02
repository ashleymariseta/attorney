import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/common.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _role = 'client_individual';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ep = ref.read(endpointsProvider);
      await ep.register(
        email: _email.text.trim(),
        password: _password.text,
        firstName: _firstName.text.trim(),
        lastName: _lastName.text.trim(),
        role: _role,
      );
      await ep.login(_email.text.trim(), _password.text);
      await ref.read(authProvider.notifier).markAuthed();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Registration failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Create your account',
      subtitle: 'Book counsel, open matters and keep everything on record.',
      onBack: () => context.go(Routes.login),
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('Already registered?', style: TextStyle(color: AppColors.muted, fontSize: 13)),
          TextButton(
            onPressed: () => context.go(Routes.login),
            child: const Text('Log in'),
          ),
        ],
      ),
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _firstName,
                decoration: const InputDecoration(
                  labelText: 'First name',
                  prefixIcon: Icon(LucideIcons.user, size: 18, color: AppColors.muted),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _lastName,
                decoration: const InputDecoration(labelText: 'Last name'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'Email',
            prefixIcon: Icon(LucideIcons.mail, size: 18, color: AppColors.muted),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _password,
          obscureText: true,
          decoration: const InputDecoration(
            labelText: 'Password (min 8 chars)',
            prefixIcon: Icon(LucideIcons.lock, size: 18, color: AppColors.muted),
          ),
        ),
        const SizedBox(height: 12),
        const Text('I want to…',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.muted)),
        const SizedBox(height: 8),
        _IntentButton(
          icon: LucideIcons.search,
          title: 'Find a lawyer',
          subtitle: 'Book consultations and manage matters',
          selected: _role == 'client_individual',
          onTap: () => setState(() => _role = 'client_individual'),
        ),
        const SizedBox(height: 8),
        _IntentButton(
          icon: LucideIcons.building2,
          title: 'Find a lawyer for my business',
          subtitle: 'Represent a company or organisation',
          selected: _role == 'client_business',
          onTap: () => setState(() => _role = 'client_business'),
        ),
        const SizedBox(height: 8),
        _IntentButton(
          icon: LucideIcons.scale,
          title: 'Practise as a lawyer',
          subtitle: 'Offer legal services on Legal Online',
          selected: _role == 'lawyer',
          onTap: () => setState(() => _role = 'lawyer'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          ErrorBanner(message: _error!),
        ],
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: const Icon(LucideIcons.userPlus, size: 16),
          label: Text(_busy ? 'Creating…' : 'Create account'),
        ),
      ],
    );
  }
}

/// Selectable "intent" tile used on the register screen in place of the role
/// dropdown — clearer, tap-friendly role selection.
class _IntentButton extends StatelessWidget {
  const _IntentButton({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
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
          color: selected ? AppColors.cardTint : AppColors.surface,
          border: Border.all(
            color: selected ? AppColors.brand : AppColors.line,
            width: selected ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: selected ? AppColors.brand : AppColors.brandLight,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon,
                  size: 18,
                  color: selected ? Colors.white : AppColors.brandDark),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink)),
                  Text(subtitle,
                      style:
                          const TextStyle(fontSize: 11, color: AppColors.muted)),
                ],
              ),
            ),
            if (selected)
              const Icon(LucideIcons.checkCircle2,
                  size: 18, color: AppColors.brand),
          ],
        ),
      ),
    );
  }
}
