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

/// Mirrors frontend/app/forgot-password/page.tsx — collects an email and
/// asks the backend to email a reset link. Shows a success card after
/// submission instead of a toast bar.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Email is required.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).requestPasswordReset(email);
      if (!mounted) return;
      setState(() => _sent = true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Check your email for the reset link.')),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not send reset email.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Forgot password?',
      subtitle: "Enter the email you signed up with and we'll send you a reset link.",
      onBack: () => context.go(Routes.login),
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('Remembered it?', style: TextStyle(color: AppColors.muted, fontSize: 13)),
          TextButton(
            onPressed: () => context.go(Routes.login),
            child: const Text('Log in'),
          ),
        ],
      ),
      children: [
        if (_sent) ...[
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFECFDF5),
              border: Border.all(color: const Color(0xFFA7F3D0)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(LucideIcons.mailCheck, size: 18, color: Color(0xFF059669)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "If an account exists for ${_email.text.trim()}, a reset email is on the way. "
                    "The link expires in 24 hours.",
                    style: const TextStyle(color: Color(0xFF065F46), fontSize: 13, height: 1.4),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: () => context.go(Routes.login),
            icon: const Icon(LucideIcons.arrowLeft, size: 16),
            label: const Text('Back to log in'),
          ),
        ] else ...[
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'you@example.com',
              prefixIcon: Icon(LucideIcons.mail, size: 18, color: AppColors.muted),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            ErrorBanner(message: _error!),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: const Icon(LucideIcons.send, size: 16),
            label: Text(_busy ? 'Sending…' : 'Send reset link'),
          ),
        ],
      ],
    );
  }
}
