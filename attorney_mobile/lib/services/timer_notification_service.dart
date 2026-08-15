import 'dart:io' show Platform;

import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// iOS-only bridge to the native ActivityKit Live Activity (Dynamic Island /
/// lock-screen). No-ops until the `LegalOnlineTimerWidget` Xcode target +
/// `LiveActivityBridge` are added (see ios/LiveActivity/README.md) — a
/// `MissingPluginException` is swallowed so the Dart side is always safe to
/// call.
class _LiveActivity {
  static const _channel = MethodChannel('legalonline/live_activity');

  static Future<void> start(String matterTitle, DateTime startedAt) async {
    if (!Platform.isIOS) return;
    try {
      await _channel.invokeMethod<void>('start', {
        'matterTitle': matterTitle,
        'startedAtEpochMs': startedAt.toUtc().millisecondsSinceEpoch,
      });
    } on PlatformException {
      // ignore — Live Activities unavailable/disabled on this device
    } on MissingPluginException {
      // ignore — native target not wired yet
    }
  }

  static Future<void> stop() async {
    if (!Platform.isIOS) return;
    try {
      await _channel.invokeMethod<void>('stop');
    } on PlatformException {
      // ignore
    } on MissingPluginException {
      // ignore
    }
  }
}

/// Keys used to hand the running-timer state to the background isolate. The
/// TaskHandler runs in its own isolate, so it can only read what we persist
/// via `FlutterForegroundTask.saveData` before starting the service.
class _Keys {
  static const startEpochMs = 'timer_start_epoch_ms';
  static const matterTitle = 'timer_matter_title';
}

/// Wraps [FlutterForegroundTask] to surface the running billables timer as an
/// ongoing, live-ticking notification — visible on the lock screen the way
/// Google Maps / inDrive show an active trip.
///
/// Android: a real foreground service (a dataSync-typed service) that keeps
/// ticking while the app is backgrounded or the phone is locked.
///
/// iOS: `flutter_foreground_task` shows a plain local notification (no
/// live-ticking Dynamic Island). Full iOS parity needs a native ActivityKit
/// Live Activity Widget Extension — see ios/LiveActivity/README for the target
/// the Flutter side cannot scaffold. This service still no-ops safely on iOS.
class TimerNotificationService {
  const TimerNotificationService._();

  /// Wire up the plugin's isolate communication port + notification channel.
  /// Call once from `main()` after `WidgetsFlutterBinding.ensureInitialized()`.
  static void init() {
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'legalonline_timer',
        channelName: 'Active time tracker',
        channelDescription: 'Shows a running billable timer while it is active.',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: true,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        // Tick once a second so the notification clock stays live.
        eventAction: ForegroundTaskEventAction.repeat(1000),
        autoRunOnBoot: false,
        allowWakeLock: true,
        allowWifiLock: false,
      ),
    );
  }

  /// Request the runtime notification permission (Android 13+ / iOS). Safe to
  /// call more than once — a no-op once granted.
  static Future<void> ensurePermission() async {
    final status = await FlutterForegroundTask.checkNotificationPermission();
    if (status != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }
  }

  /// Start (or update) the ongoing notification for a running timer.
  static Future<void> start({
    required String matterTitle,
    required DateTime startedAt,
  }) async {
    await FlutterForegroundTask.saveData(
      key: _Keys.startEpochMs,
      value: startedAt.toUtc().millisecondsSinceEpoch,
    );
    await FlutterForegroundTask.saveData(
      key: _Keys.matterTitle,
      value: matterTitle,
    );

    // iOS: a native live-ticking Live Activity (Dynamic Island / lock screen).
    await _LiveActivity.start(matterTitle, startedAt);

    // Android: a real foreground service. On iOS this also shows a plain
    // fallback notification, harmless alongside the Live Activity.
    final title = 'Tracking · $matterTitle';
    const text = '00:00:00';
    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.updateService(
        notificationTitle: title,
        notificationText: text,
      );
    } else {
      await FlutterForegroundTask.startService(
        serviceId: 42,
        notificationTitle: title,
        notificationText: text,
        callback: startTimerTaskCallback,
      );
    }
  }

  /// Tear down the ongoing notification when the timer stops.
  static Future<void> stop() async {
    await _LiveActivity.stop();
    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.stopService();
    }
  }

  /// Reconcile the notification with server truth on app resume / screen load:
  /// show it when a timer is running, hide it otherwise.
  static Future<void> sync({String? matterTitle, DateTime? startedAt}) async {
    final running = matterTitle != null && startedAt != null;
    if (running) {
      await start(matterTitle: matterTitle, startedAt: startedAt);
    } else {
      await stop();
    }
  }
}

/// Entry point the plugin invokes in the background isolate. Must be a
/// top-level / static function annotated with `@pragma('vm:entry-point')`.
@pragma('vm:entry-point')
void startTimerTaskCallback() {
  FlutterForegroundTask.setTaskHandler(_TimerTaskHandler());
}

class _TimerTaskHandler extends TaskHandler {
  DateTime? _start;
  String _title = 'Tracking';

  Future<void> _loadState() async {
    final epoch = await FlutterForegroundTask.getData<int>(key: _Keys.startEpochMs);
    _start = epoch == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(epoch, isUtc: true);
    _title = await FlutterForegroundTask.getData<String>(key: _Keys.matterTitle) ??
        'Tracking';
  }

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    await _loadState();
    _update();
  }

  @override
  void onRepeatEvent(DateTime timestamp) => _update();

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}

  void _update() {
    final start = _start;
    if (start == null) return;
    final elapsed = DateTime.now().toUtc().difference(start);
    FlutterForegroundTask.updateService(
      notificationTitle: 'Tracking · $_title',
      notificationText: _fmt(elapsed),
    );
  }

  String _fmt(Duration d) {
    final s = d.inSeconds < 0 ? 0 : d.inSeconds;
    final h = (s ~/ 3600).toString().padLeft(2, '0');
    final m = ((s % 3600) ~/ 60).toString().padLeft(2, '0');
    final sec = (s % 60).toString().padLeft(2, '0');
    return '$h:$m:$sec';
  }
}
