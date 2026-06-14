import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors frontend/app/accept-invite/page.tsx — previews the invite by
/// token, then asks the user to set a password to activate the account.
class AcceptInviteScreen extends ConsumerStatefulWidget {
  const AcceptInviteScreen({super.key, required this.token});
  final String token;

  @override
  ConsumerState<AcceptInviteScreen> createState() => _AcceptInviteScreenState();
}

class _AcceptInviteScreenState extends ConsumerState<AcceptInviteScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  bool _loadingPreview = true;
  bool _busy = false;
  String? _error;

  String? _matterTitle;
  String? _previewError;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _loadPreview() async {
    if (widget.token.isEmpty) {
      setState(() {
        _loadingPreview = false;
        _previewError = 'Missing invite token. Please use the link from your invite.';
      });
      return;
    }
    try {
      final p = await ref.read(endpointsProvider).previewInvite(widget.token);
      if (!mounted) return;
      setState(() {
        _matterTitle = p['matter_title'] as String?;
        _email.text = (p['email'] as String?) ?? '';
        _loadingPreview = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _previewError = e.message;
        _loadingPreview = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _previewError = 'This invite is invalid or has already been used.';
        _loadingPreview = false;
      });
    }
  }

  Future<void> _submit() async {
    setState(() => _error = null);
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
      await ref.read(endpointsProvider).acceptInvite(
            token: widget.token,
            password: _password.text,
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
          );
      await ref.read(authProvider.notifier).markAuthed();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Welcome — your account is ready.')),
      );
      context.go(Routes.dashboard);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not accept the invite.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                'Accept your invite',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.ink),
              ),
              const SizedBox(height: 6),
              if (_loadingPreview)
                const Text('Loading invite…', style: TextStyle(color: AppColors.muted, fontSize: 13))
              else if (_previewError != null) ...[
                EmptyState(
                  icon: LucideIcons.mailOpen,
                  title: widget.token.isEmpty ? 'Open the link from your email' : 'Invite unavailable',
                  subtitle: _previewError,
                ),
                Center(
                  child: TextButton(
                    onPressed: () => context.go(Routes.login),
                    child: const Text('Back to log in'),
                  ),
                ),
              ] else ...[
                RichText(
                  text: TextSpan(
                    style: const TextStyle(color: AppColors.muted, fontSize: 13, height: 1.4),
                    children: [
                      const TextSpan(text: "You've been invited to the matter "),
                      TextSpan(
                        text: '"${_matterTitle ?? ''}"',
                        style: const TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700),
                      ),
                      const TextSpan(text: '. Set a password to activate your account.'),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'Email',
                    hintText: 'you@example.com',
                    helperText: "This is the address you'll use to log in.",
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Password',
                    hintText: 'At least 8 characters',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirm,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Confirm password'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  ErrorBanner(message: _error!),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'Activating…' : 'Activate account'),
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () => context.go(Routes.login),
                    child: const Text('Already have an account? Log in'),
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
