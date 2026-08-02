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

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  String? _error;
  bool _busy = false;
  String? _challenge;
  String? _method;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // Dismiss the keyboard before the network call so the user sees the
    // loader / success state without it covering the screen.
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ep = ref.read(endpointsProvider);
      if (_challenge == null) {
        final res = await ep.login(_email.text.trim(), _password.text);
        if (res.requires2fa) {
          setState(() {
            _challenge = res.challengeToken;
            _method = res.method;
          });
          return;
        }
        await ref.read(authProvider.notifier).markAuthed();
      } else {
        await ep.verify2fa(_challenge!, _otp.text.trim());
        await ref.read(authProvider.notifier).markAuthed();
      }
    } on ApiException catch (e) {
      // SimpleJWT's default "no token returned" comes back as 400 with a
      // generic body — surface a friendlier hint while preserving the raw
      // server message when it's informative.
      String msg = e.message;
      if (e.statusCode == 400 && _challenge == null) {
        if (msg.toLowerCase().contains('no active') ||
            msg.toLowerCase().contains('credentials') ||
            msg.toLowerCase().startsWith('request failed') ||
            msg.toLowerCase().startsWith("we couldn't process")) {
          msg = 'Wrong email or password — please try again.';
        }
      }
      if (e.statusCode == 400 && _challenge != null) {
        msg = 'That code didn\'t match. Check it and try again.';
      }
      setState(() => _error = msg);
    } catch (_) {
      setState(() => _error = 'Login failed. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inOtp = _challenge != null;
    return AuthScaffold(
      title: inOtp ? 'Verify your login' : 'Welcome back',
      subtitle: inOtp
          ? 'We sent a 6-digit code via ${_method ?? 'email'}. It expires in 10 minutes.'
          : 'Log in to reach your lawyers, matters and documents.',
      footer: inOtp
          ? Center(
              child: TextButton(
                onPressed: () => setState(() {
                  _challenge = null;
                  _otp.clear();
                }),
                child: const Text('Use a different account'),
              ),
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('New here?', style: TextStyle(color: AppColors.muted, fontSize: 13)),
                TextButton(
                  onPressed: () => context.go(Routes.register),
                  child: const Text('Create an account'),
                ),
              ],
            ),
      children: [
        if (!inOtp) ...[
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
              labelText: 'Password',
              prefixIcon: Icon(LucideIcons.lock, size: 18, color: AppColors.muted),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => context.go(Routes.forgotPassword),
              child: const Text('Forgot password?'),
            ),
          ),
        ] else ...[
          TextField(
            controller: _otp,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, letterSpacing: 8, fontFamily: 'monospace'),
            decoration: const InputDecoration(
              labelText: '6-digit code',
              counterText: '',
              prefixIcon: Icon(LucideIcons.shieldCheck, size: 18, color: AppColors.muted),
            ),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          ErrorBanner(message: _error!),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: Icon(inOtp ? LucideIcons.checkCircle2 : LucideIcons.logIn, size: 16),
          label: Text(_busy ? 'Working…' : (inOtp ? 'Verify' : 'Log in')),
        ),
      ],
    );
  }
}
