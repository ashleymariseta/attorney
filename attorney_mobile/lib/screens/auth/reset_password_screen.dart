import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors frontend/app/reset-password/page.tsx — reads ``uid`` and ``token``
/// from the deep-link query string, asks the user for a new password, then
/// signs them in by stashing the returned access/refresh pair.
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, required this.uid, required this.token});
  final String uid;
  final String token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (widget.uid.isEmpty || widget.token.isEmpty) {
      setState(() => _error = 'Missing reset details. Use the link from your email.');
      return;
    }
    if (_password.text.length < 8) {
      setState(() => _error = 'Password must be at least 8 characters.');
      return;
    }
    if (_password.text != _confirm.text) {
      setState(() => _error = 'Passwords do not match.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(endpointsProvider).confirmPasswordReset(
            uid: widget.uid,
            token: widget.token,
            password: _password.text,
          );
      await ref.read(authProvider.notifier).markAuthed();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password updated.')),
      );
      // markAuthed will trigger the router redirect to dashboard, but be
      // explicit in case we're already on the auth side.
      context.go(Routes.dashboard);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reset password.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final missingLink = widget.uid.isEmpty || widget.token.isEmpty;
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: BackButton(onPressed: () => context.go(Routes.login)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: ListView(
            children: [
              const Text(
                'Attorney',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.brandDark,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Choose a new password',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.ink),
              ),
              const SizedBox(height: 4),
              const Text(
                'Make it strong — at least 8 characters.',
                style: TextStyle(color: AppColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 24),
              if (missingLink) ...[
                const EmptyState(
                  icon: LucideIcons.mailOpen,
                  title: 'Open the link from your email',
                  subtitle: 'This page needs the reset link sent to your inbox.',
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () => context.go(Routes.forgotPassword),
                    child: const Text('Request another link'),
                  ),
                ),
              ] else ...[
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'New password'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirm,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Confirm new password'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  ErrorBanner(message: _error!),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'Saving…' : 'Update password'),
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () => context.go(Routes.forgotPassword),
                    child: const Text('Need a new link? Request another'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
