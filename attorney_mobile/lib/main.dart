import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const ProviderScope(child: AttorneyApp()));
}

class AttorneyApp extends ConsumerWidget {
  const AttorneyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Attorney',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      routerConfig: router,
      // Dismiss the on-screen keyboard whenever the user taps outside a
      // focused text field — the most common mobile UX oversight.
      builder: (context, child) => GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () {
          final scope = FocusManager.instance.primaryFocus;
          if (scope != null && scope.hasFocus) scope.unfocus();
        },
        child: child,
      ),
    );
  }
}
