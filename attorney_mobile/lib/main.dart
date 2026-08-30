import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'theme/app_theme.dart';
import 'widgets/push_registrar.dart';
import 'widgets/update_checker.dart';
import 'widgets/user_events_listener.dart';

/// App-wide messenger so the account SSE listener can toast from above the
/// route tree.
final rootMessengerKey = GlobalKey<ScaffoldMessengerState>();

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: AttorneyApp()));
}

class AttorneyApp extends ConsumerWidget {
  const AttorneyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Legal Online',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      routerConfig: router,
      scaffoldMessengerKey: rootMessengerKey,
      // Dismiss the on-screen keyboard whenever the user taps outside a
      // focused text field — the most common mobile UX oversight.
      builder: (context, child) => PushRegistrar(
        messengerKey: rootMessengerKey,
        child: UpdateChecker(
          messengerKey: rootMessengerKey,
          child: UserEventsListener(
            messengerKey: rootMessengerKey,
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () {
                final scope = FocusManager.instance.primaryFocus;
                if (scope != null && scope.hasFocus) scope.unfocus();
              },
              child: child ?? const SizedBox.shrink(),
            ),
          ),
        ),
      ),
    );
  }
}
