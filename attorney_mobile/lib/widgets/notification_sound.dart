import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// One-shot ring.mp3 player used for incoming chat messages and other major
/// toast events. Mirrors the web Toast's `major: true` behavior.
class NotificationSound {
  NotificationSound._();

  static final _player = AudioPlayer()
    ..setReleaseMode(ReleaseMode.stop)
    ..setSource(AssetSource('audio/ring.mp3')).catchError((_) {});

  /// Play the ring sound. Silently swallows errors — sound is a nice-to-have,
  /// never a blocker.
  static Future<void> play() async {
    try {
      await _player.stop();
      await _player.setVolume(0.6);
      await _player.play(AssetSource('audio/ring.mp3'));
    } catch (e) {
      debugPrint('[sound] play failed: $e');
    }
  }
}
