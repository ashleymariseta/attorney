import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../router.dart';
import '../services/push_service.dart';
import '../state/providers.dart';

/// Boots FCM once and keeps the device token in sync with auth: registers the
/// token when the user is signed in, deactivates it on sign-out. Foreground
/// pushes surface as a toast; tapping a push routes to its `link`.
class PushRegistrar extends ConsumerStatefulWidget {
  const PushRegistrar({
    super.key,
    required this.messengerKey,
    required this.child,
  });
  final GlobalKey<ScaffoldMessengerState> messengerKey;
  final Widget child;

  @override
  ConsumerState<PushRegistrar> createState() => _PushRegistrarState();
}

class _PushRegistrarState extends ConsumerState<PushRegistrar> {
  bool _initStarted = false;
  bool _registered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  Future<void> _boot() async {
    if (_initStarted) return;
    _initStarted = true;
    await PushService.instance.initialize(
      onForeground: (title, body) {
        widget.messengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(body.isEmpty ? title : '$title — $body')),
        );
      },
      onOpenLink: (link) {
        if (link != null && link.startsWith('/')) {
          ref.read(routerProvider).go(link);
        }
      },
    );
    // If already signed in at launch, register straight away.
    if (ref.read(authProvider).status == AuthStatus.authed) {
      _registered = true;
      await PushService.instance.registerWith(ref.read(endpointsProvider));
    }
  }

  @override
  Widget build(BuildContext context) {
    // React to auth transitions: register on sign-in, unregister on sign-out.
    ref.listen<AuthState>(authProvider, (prev, next) {
      final ep = ref.read(endpointsProvider);
      if (next.status == AuthStatus.authed && !_registered) {
        _registered = true;
        PushService.instance.registerWith(ep);
      } else if (next.status == AuthStatus.anonymous && _registered) {
        _registered = false;
        PushService.instance.unregister(ep);
      }
    });
    return widget.child;
  }
}
