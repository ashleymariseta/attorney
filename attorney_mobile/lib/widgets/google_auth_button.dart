import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../api/endpoints.dart';
import '../state/providers.dart';
import '../theme/app_theme.dart';

// OAuth client IDs (not secret — safe to ship in the client). The web client is
// passed as serverClientId so the returned ID token's audience matches what the
// backend verifies; the iOS client is used by the native flow on Apple devices.
const _webClientId = '987691681405-9t8ibr8ni78n22dnt6a4s7tpvtao7e43.apps.googleusercontent.com';
const _iosClientId = '987691681405-3qievjgeloq3pniub32k4j7hfprbhgnl.apps.googleusercontent.com';

bool _gsiInitialized = false;

/// "Continue with Google" button — runs the native Google sign-in, exchanges
/// the ID token with our backend, and marks the session authenticated.
class GoogleAuthButton extends ConsumerStatefulWidget {
  const GoogleAuthButton({super.key, this.label = 'Continue with Google', this.onError});

  final String label;
  final void Function(String message)? onError;

  @override
  ConsumerState<GoogleAuthButton> createState() => _GoogleAuthButtonState();
}

class _GoogleAuthButtonState extends ConsumerState<GoogleAuthButton> {
  bool _busy = false;

  Future<void> _signIn() async {
    setState(() => _busy = true);
    try {
      final signIn = GoogleSignIn.instance;
      if (!_gsiInitialized) {
        await signIn.initialize(
          clientId: Platform.isIOS ? _iosClientId : null,
          serverClientId: _webClientId,
        );
        _gsiInitialized = true;
      }
      final account = await signIn.authenticate(scopeHint: const ['email', 'profile']);
      final idToken = account.authentication.idToken;
      if (idToken == null) {
        widget.onError?.call('Google did not return a token — please try again.');
        return;
      }
      await ref.read(endpointsProvider).googleSignIn(idToken);
      await ref.read(authProvider.notifier).markAuthed();
    } on GoogleSignInException catch (e) {
      if (e.code != GoogleSignInExceptionCode.canceled) {
        widget.onError?.call('Google sign-in failed — please try again.');
      }
    } on ApiException catch (e) {
      widget.onError?.call(e.message);
    } catch (_) {
      widget.onError?.call('Google sign-in failed — please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: _busy ? null : _signIn,
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        side: const BorderSide(color: AppColors.line),
        padding: const EdgeInsets.symmetric(vertical: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: _busy
          ? const SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.brand),
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const _GoogleGlyph(),
                const SizedBox(width: 10),
                Text(
                  widget.label,
                  style: const TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 14),
                ),
              ],
            ),
    );
  }
}

/// A subtle "or" divider, used between a form and the Google button.
class OrDivider extends StatelessWidget {
  const OrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          Expanded(child: Divider(color: AppColors.line)),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 10),
            child: Text('or', style: TextStyle(color: AppColors.muted, fontSize: 12)),
          ),
          Expanded(child: Divider(color: AppColors.line)),
        ],
      ),
    );
  }
}

/// A small four-colour Google "G" mark, drawn so we don't need an asset.
class _GoogleGlyph extends StatelessWidget {
  const _GoogleGlyph();

  @override
  Widget build(BuildContext context) {
    return const Text(
      'G',
      style: TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w700,
        color: Color(0xFF4285F4), // Google blue
        height: 1.0,
      ),
    );
  }
}
