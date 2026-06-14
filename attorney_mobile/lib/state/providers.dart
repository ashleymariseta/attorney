import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/endpoints.dart';
import '../api/models.dart';

void _log(String msg) => debugPrint('[auth] $msg');

/// Shared GlobalKey for the AppShell's Scaffold. Lets any screen open the
/// shell drawer (the per-screen Scaffold.of() lookup finds the inner
/// Scaffold which has no drawer).
final appShellScaffoldKeyProvider =
    Provider<GlobalKey<ScaffoldState>>((_) => GlobalKey<ScaffoldState>());

/// Root Dio + secure-storage client. Long-lived for the app lifetime.
final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final endpointsProvider = Provider<Endpoints>((ref) {
  return Endpoints(ref.watch(apiClientProvider));
});

/// Tri-state auth status — populated by [AuthController.refresh].
enum AuthStatus { unknown, authed, anonymous }

class AuthState {
  AuthState({required this.status, this.me});
  final AuthStatus status;
  final User? me;

  AuthState copyWith({AuthStatus? status, User? me}) =>
      AuthState(status: status ?? this.status, me: me ?? this.me);
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(AuthState(status: AuthStatus.unknown));
  final Ref _ref;

  ApiClient get _api => _ref.read(apiClientProvider);
  Endpoints get _ep => _ref.read(endpointsProvider);

  /// Called on app start. Reads the access token from secure storage and
  /// verifies it by calling /users/me. Hard-caps the verify roundtrip at
  /// 6s so a flaky backend can't pin the splash forever — falls back to
  /// anonymous on any error or timeout.
  Future<void> refresh() async {
    _log('refresh() start');
    bool authed;
    try {
      authed = await _api.isAuthed().timeout(const Duration(seconds: 3));
      _log('isAuthed -> $authed');
    } catch (e) {
      _log('isAuthed FAILED: $e');
      authed = false;
    }
    if (!authed) {
      _log('no token -> anonymous');
      state = AuthState(status: AuthStatus.anonymous);
      return;
    }
    try {
      _log('calling /users/me/ …');
      final me = await _ep.me().timeout(const Duration(seconds: 6));
      _log('/me OK -> ${me.email}');
      state = AuthState(status: AuthStatus.authed, me: me);
    } catch (e) {
      _log('/me FAILED: $e');
      try {
        await _api.clearTokens();
      } catch (_) {}
      state = AuthState(status: AuthStatus.anonymous);
    }
  }

  void forceAnonymous() {
    if (state.status == AuthStatus.unknown) {
      _log('forceAnonymous (safety hatch)');
      state = AuthState(status: AuthStatus.anonymous);
    }
  }

  Future<void> markAuthed() async {
    try {
      final me = await _ep.me();
      state = AuthState(status: AuthStatus.authed, me: me);
    } catch (_) {
      // Tokens were just set so this shouldn't fail; if it does, bail.
      await logout();
    }
  }

  Future<void> logout() async {
    await _ep.logout();
    state = AuthState(status: AuthStatus.anonymous);
  }

  Future<void> reloadMe() async {
    if (state.status != AuthStatus.authed) return;
    try {
      final me = await _ep.me();
      state = state.copyWith(me: me);
    } catch (_) {}
  }
}

final authProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref);
});
