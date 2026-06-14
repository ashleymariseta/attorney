import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';
import '../../theme/app_theme.dart';

void _slog(String m) => debugPrint('[splash] $m');

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _slog('initState — scheduling postFrameCallback');
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      _slog('postFrame fired — calling refresh()');
      final notifier = ref.read(authProvider.notifier);
      try {
        await notifier.refresh().timeout(const Duration(seconds: 8));
        _slog('refresh() returned');
      } catch (e) {
        _slog('refresh() threw or timed out: $e');
      }
      if (!mounted) return;
      _slog('about to call forceAnonymous (no-op if already settled)');
      notifier.forceAnonymous();
      _slog('post-forceAnonymous status=${ref.read(authProvider).status}');
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/img/logos/logo-primary-teal.png',
              width: 180,
              fit: BoxFit.contain,
            ),
            const SizedBox(height: 24),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.brand),
            ),
          ],
        ),
      ),
    );
  }
}
