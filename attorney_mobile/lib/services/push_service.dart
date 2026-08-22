import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../api/endpoints.dart';

/// Background isolate handler. Must be a top-level, vm:entry-point function.
/// FCM shows notification-type messages in the system tray automatically when
/// the app is backgrounded, so there's nothing to do here beyond ensuring
/// Firebase is initialised in this isolate.
@pragma('vm:entry-point')
Future<void> fcmBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Firebase not configured — nothing to do.
  }
}

/// Thin wrapper around firebase_messaging. Everything is guarded so the app
/// runs normally when Firebase isn't configured (no google-services.json /
/// GoogleService-Info.plist) — push just stays disabled.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  FirebaseMessaging? _messaging;
  String? _token;
  bool _ready = false;

  bool get isReady => _ready;

  static String platformName() => Platform.isIOS ? 'ios' : 'android';

  /// Initialise Firebase + messaging and wire up foreground / tap handlers.
  /// Returns false (and disables push) if Firebase isn't configured.
  Future<bool> initialize({
    required void Function(String title, String body) onForeground,
    required void Function(String? link) onOpenLink,
  }) async {
    if (_ready) return true;
    try {
      await Firebase.initializeApp();
    } catch (_) {
      return false; // no native config files yet — push disabled, app is fine.
    }
    try {
      final m = FirebaseMessaging.instance;
      _messaging = m;
      FirebaseMessaging.onBackgroundMessage(fcmBackgroundHandler);
      await m.requestPermission(alert: true, badge: true, sound: true);
      // iOS: show banners while the app is foregrounded too.
      await m.setForegroundNotificationPresentationOptions(
        alert: true, badge: true, sound: true,
      );

      FirebaseMessaging.onMessage.listen((msg) {
        final n = msg.notification;
        if (n != null) onForeground(n.title ?? 'Notification', n.body ?? '');
      });
      FirebaseMessaging.onMessageOpenedApp.listen((msg) {
        onOpenLink(msg.data['link'] as String?);
      });
      final initial = await m.getInitialMessage();
      if (initial != null) onOpenLink(initial.data['link'] as String?);

      _ready = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Fetch the FCM token and register it with the backend. Call once the user
  /// is authenticated. Also keeps the backend in sync on token refresh.
  Future<void> registerWith(Endpoints ep) async {
    if (!_ready) return;
    try {
      final token = await _messaging!.getToken();
      if (token == null) return;
      _token = token;
      await ep.registerDevice(token, platformName());
      _messaging!.onTokenRefresh.listen((t) {
        _token = t;
        ep.registerDevice(t, platformName()).catchError((_) {});
      });
    } catch (_) {
      // best-effort — never block the app on push registration.
    }
  }

  /// Deactivate this device's token on the backend and locally (on logout).
  Future<void> unregister(Endpoints ep) async {
    try {
      final t = _token;
      if (t != null) await ep.unregisterDevice(t);
      await _messaging?.deleteToken();
    } catch (_) {
      // ignore
    } finally {
      _token = null;
    }
  }
}
