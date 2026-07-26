import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kReleaseMode;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Production API host. Release builds (Play Store / App Store) default to this
/// so a shipped app always talks to the deployed backend.
const String _prodApiBase = 'https://api.legalonline.co.zw';

/// Default API base. Precedence:
///   1. --dart-define=API_BASE=… (any build) — use for staging/overrides.
///   2. Release builds → production (_prodApiBase).
///   3. Debug: Android emulator needs 10.0.2.2; everything else 127.0.0.1.
const String _envApiBase = String.fromEnvironment('API_BASE', defaultValue: '');
String get kDefaultApiBase {
  if (_envApiBase.isNotEmpty) return _envApiBase;
  if (kReleaseMode) return _prodApiBase;
  if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:8000';
  return 'http://127.0.0.1:8000';
}

const _accessKey = 'attorney.access';
const _refreshKey = 'attorney.refresh';

/// Thin wrapper around Dio with the same behaviour as the web client
/// (frontend/lib/api.ts): bearer-token attach, single in-flight refresh,
/// retry-once on 401, no double-refresh storms.
class ApiClient {
  ApiClient({String? baseUrl})
      : _storage = const FlutterSecureStorage(),
        dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? kDefaultApiBase,
          contentType: 'application/json',
          connectTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(seconds: 60),
        )) {
    dio.interceptors.add(_authInterceptor());
  }

  final FlutterSecureStorage _storage;
  final Dio dio;

  Future<String?> getAccess() => _storage.read(key: _accessKey);
  Future<String?> getRefresh() => _storage.read(key: _refreshKey);

  Future<void> setTokens({required String access, required String refresh}) async {
    await _storage.write(key: _accessKey, value: access);
    await _storage.write(key: _refreshKey, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }

  Future<bool> isAuthed() async => (await getAccess()) != null;

  /// Coalesce concurrent refresh attempts so a burst of 401s only spawns
  /// ONE refresh round-trip.
  Future<String?>? _inflightRefresh;

  Future<String?> _refresh() async {
    final refresh = await getRefresh();
    if (refresh == null) return null;
    try {
      final res = await dio.post(
        '/api/v1/auth/token/refresh/',
        data: {'refresh': refresh},
        options: Options(headers: {'Authorization': null}),
      );
      final access = res.data is Map ? res.data['access'] as String? : null;
      final newRefresh = res.data is Map ? res.data['refresh'] as String? : null;
      if (access == null) {
        await clearTokens();
        return null;
      }
      await _storage.write(key: _accessKey, value: access);
      if (newRefresh != null) {
        await _storage.write(key: _refreshKey, value: newRefresh);
      }
      return access;
    } catch (_) {
      await clearTokens();
      return null;
    }
  }

  Interceptor _authInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        if (!options.headers.containsKey('Authorization') ||
            options.headers['Authorization'] == null) {
          final token = await getAccess();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          } else {
            options.headers.remove('Authorization');
          }
        } else if (options.headers['Authorization'] == null) {
          options.headers.remove('Authorization');
        }
        handler.next(options);
      },
      onError: (err, handler) async {
        // Auto-refresh on 401 once.
        final isUnauthorized = err.response?.statusCode == 401;
        final alreadyRetried = err.requestOptions.extra['__retried'] == true;
        final isRefreshCall = err.requestOptions.path.contains('/auth/token/refresh/');
        if (!isUnauthorized || alreadyRetried || isRefreshCall) {
          return handler.next(err);
        }
        try {
          _inflightRefresh ??= _refresh();
          final fresh = await _inflightRefresh;
          _inflightRefresh = null;
          if (fresh == null) return handler.next(err);

          final req = err.requestOptions;
          req.headers['Authorization'] = 'Bearer $fresh';
          req.extra['__retried'] = true;
          final clone = await dio.fetch(req);
          return handler.resolve(clone);
        } catch (_) {
          return handler.next(err);
        }
      },
    );
  }
}
