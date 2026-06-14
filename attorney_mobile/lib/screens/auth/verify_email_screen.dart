import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mirrors frontend/app/verify-email/page.tsx — picks ``uid`` and ``token``
/// out of the deep-link query string and POSTs them to the backend.
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key, required this.uid, required this.token});
  final String uid;
  final String token;

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

enum _VerifyState { pending, ok, err }

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  _VerifyState _state = _VerifyState.pending;
  String _message = '';

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    if (widget.uid.isEmpty || widget.token.isEmpty) {
      setState(() {
        _state = _VerifyState.err;
        _message = 'Missing verification details — use the link from your email.';
      });
      return;
    }
    try {
      await ref
          .read(endpointsProvider)
          .confirmEmailVerify(uid: widget.uid, token: widget.token);
      if (!mounted) return;
      setState(() {
        _state = _VerifyState.ok;
        _message = 'Your email is verified.';
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _VerifyState.err;
        _message = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _state = _VerifyState.err;
        _message = 'Could not verify this link.';
      });
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
              Text(
                switch (_state) {
                  _VerifyState.pending => 'Verifying your email…',
                  _VerifyState.ok => 'Email verified',
                  _VerifyState.err => 'Verification failed',
                },
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              if (_state == _VerifyState.pending) ...[
                Row(
                  children: [
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    const SizedBox(width: 10),
                    Text(_message.isEmpty ? 'Talking to the server…' : _message,
                        style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                  ],
                ),
              ] else if (_state == _VerifyState.ok) ...[
                Text(_message, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () async {
                    // If they already have tokens, jump straight in. Else just go to login.
                    if (ref.read(authProvider).status == AuthStatus.authed) {
                      context.go(Routes.dashboard);
                    } else {
                      context.go(Routes.login);
                    }
                  },
                  child: const Text('Continue'),
                ),
              ] else ...[
                ErrorBanner(message: _message),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () => context.go(Routes.login),
                  child: const Text('Back to login'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
