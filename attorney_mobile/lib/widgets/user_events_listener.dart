import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';
import 'notification_sound.dart';

/// Listens to the account-level SSE feed (GET /api/v1/me/events/) for the whole
/// app session and surfaces events that aren't scoped to a matter room — e.g. a
/// new booking pushed to the lawyer. Mirrors the web useUserEvents hook. Hosted
/// once in the MaterialApp builder so it survives navigation.
class UserEventsListener extends ConsumerStatefulWidget {
  const UserEventsListener({
    super.key,
    required this.child,
    required this.messengerKey,
  });
  final Widget child;
  final GlobalKey<ScaffoldMessengerState> messengerKey;

  @override
  ConsumerState<UserEventsListener> createState() => _UserEventsListenerState();
}

class _UserEventsListenerState extends ConsumerState<UserEventsListener> {
  StreamSubscription<List<int>>? _sub;
  CancelToken? _cancel;
  String _buffer = '';
  bool _needsRefresh = false;
  bool _running = false;
  int _attempt = 0;
  Timer? _retry;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (ref.read(authProvider).status == AuthStatus.authed) _connect();
    });
  }

  Future<void> _connect() async {
    if (_running) return;
    _running = true;
    try {
      final api = ref.read(apiClientProvider);
      if (_needsRefresh) {
        _needsRefresh = false;
        await api.refreshAccess();
      }
      final token = await api.getAccess() ?? '';
      if (token.isEmpty) {
        _running = false;
        return; // not authed — a login will kick us off via ref.listen
      }
      _cancel?.cancel();
      _cancel = CancelToken();
      _buffer = '';
      final resp = await api.dio.get<ResponseBody>(
        '/api/v1/me/events/?token=${Uri.encodeComponent(token)}',
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: Duration.zero,
          headers: {'Accept': 'text/event-stream'},
        ),
        cancelToken: _cancel,
      );
      _attempt = 0;
      _sub = resp.data!.stream.listen(
        _onChunk,
        onError: (_) => _onClosed(),
        onDone: _onClosed,
        cancelOnError: true,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) _needsRefresh = true;
      _onClosed();
    } catch (_) {
      _onClosed();
    }
  }

  void _onClosed() {
    _running = false;
    _sub = null;
    // Only reconnect while authed.
    if (ref.read(authProvider).status != AuthStatus.authed) return;
    _attempt += 1;
    final delay =
        Duration(milliseconds: (500 * (1 << _attempt)).clamp(500, 30000));
    _retry?.cancel();
    _retry = Timer(delay, _connect);
  }

  void _stop() {
    _retry?.cancel();
    _retry = null;
    _sub?.cancel();
    _sub = null;
    _cancel?.cancel();
    _running = false;
  }

  void _onChunk(List<int> bytes) {
    _buffer += utf8.decode(bytes, allowMalformed: true);
    int idx;
    while ((idx = _buffer.indexOf('\n\n')) != -1) {
      final frame = _buffer.substring(0, idx);
      _buffer = _buffer.substring(idx + 2);
      for (final raw in frame.split('\n')) {
        final line = raw.replaceAll('\r', '');
        if (!line.startsWith('data:')) continue;
        final data = line.substring(5).trim();
        if (data.isEmpty) continue;
        try {
          _dispatch(jsonDecode(data) as Map<String, dynamic>);
        } catch (_) {}
      }
    }
  }

  void _dispatch(Map<String, dynamic> e) {
    final type = e['type'] as String?;
    if (type == 'consultation.created' || type == 'notification') {
      final title = e['title'] as String? ?? 'New activity on your account';
      NotificationSound.play();
      widget.messengerKey.currentState?.showSnackBar(
        SnackBar(content: Text(title), behavior: SnackBarBehavior.floating),
      );
    }
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // React to login/logout: connect when authed, stop otherwise.
    ref.listen(authProvider.select((s) => s.status), (prev, next) {
      if (next == AuthStatus.authed) {
        _connect();
      } else {
        _stop();
      }
    });
    return widget.child;
  }
}
