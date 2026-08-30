import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/providers.dart';
import '../theme/app_theme.dart';

/// Checks the app's build against the server's app-config and shows a branded
/// MaterialBanner prompting an update (opens the store). When below the minimum
/// build the banner is non-dismissible (only "Update"). All best-effort.
class UpdateChecker extends ConsumerStatefulWidget {
  const UpdateChecker({
    super.key,
    required this.messengerKey,
    required this.child,
  });
  final GlobalKey<ScaffoldMessengerState> messengerKey;
  final Widget child;

  @override
  ConsumerState<UpdateChecker> createState() => _UpdateCheckerState();
}

class _UpdateCheckerState extends ConsumerState<UpdateChecker> {
  bool _checked = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    if (_checked) return;
    _checked = true;
    try {
      final info = await PackageInfo.fromPlatform();
      final build = int.tryParse(info.buildNumber) ?? 0;
      final cfg = await ref.read(endpointsProvider).getAppConfig();
      if (build >= cfg.mobileLatestBuild) return; // up to date

      final forced = build < cfg.mobileMinBuild;
      final storeUrl = Platform.isIOS ? cfg.iosStoreUrl : cfg.androidStoreUrl;
      final messenger = widget.messengerKey.currentState;
      if (messenger == null) return;

      messenger.showMaterialBanner(
        MaterialBanner(
          backgroundColor: AppColors.brandDark,
          leading: const Icon(Icons.system_update, color: Colors.white),
          content: Text(
            forced
                ? 'A required update is available. Please update to keep using Legal Online.'
                : 'A new version of Legal Online is available.',
            style: const TextStyle(color: Colors.white),
          ),
          actions: [
            if (!forced)
              TextButton(
                onPressed: () => messenger.hideCurrentMaterialBanner(),
                child: const Text('Later', style: TextStyle(color: Colors.white70)),
              ),
            TextButton(
              onPressed: () async {
                if (storeUrl.isNotEmpty) {
                  await launchUrl(Uri.parse(storeUrl), mode: LaunchMode.externalApplication);
                }
              },
              child: const Text('Update', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );
    } catch (_) {
      // never break the app over a version check
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
