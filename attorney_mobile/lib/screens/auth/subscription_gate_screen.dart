import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/endpoints.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';

/// Blocking gate for lawyers whose monthly subscription isn't active. Mirrors
/// the web SubscriptionGate: upload proof of payment, then wait ~30 min for
/// verification. The only ways out are a verified payment or logging out.
/// Shown by AppShell when `me.subscriptionBlocking` is true.
class SubscriptionGateScreen extends ConsumerStatefulWidget {
  const SubscriptionGateScreen({super.key});

  @override
  ConsumerState<SubscriptionGateScreen> createState() => _SubscriptionGateScreenState();
}

class _SubscriptionGateScreenState extends ConsumerState<SubscriptionGateScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _uploadPop() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    if (picked == null || picked.files.isEmpty) return;
    final f = picked.files.first;
    if (f.path == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(endpointsProvider).uploadSubscriptionPop(f.path!, f.name);
      await ref.read(authProvider.notifier).reloadMe();
      // On success `me.subscriptionBlocking` may flip to pending (still gated,
      // but the screen re-renders into the awaiting state).
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not upload. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final sub = me?.subscription;
    final pending = sub?.state == 'pending';
    final rejected = sub?.state == 'rejected';

    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppColors.brandLight,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Icon(
                          pending ? LucideIcons.clock : LucideIcons.shieldCheck,
                          size: 20,
                          color: AppColors.brandDark,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          pending ? 'Awaiting verification' : 'Monthly subscription required',
                          style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (pending) ...[
                    const Text(
                      "We've received your proof of payment. Verification usually takes "
                      'about 30 minutes. You\'ll get full access as soon as it\'s confirmed.',
                      style: TextStyle(fontSize: 14, color: AppColors.muted),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _busy ? null : () => ref.read(authProvider.notifier).reloadMe(),
                      child: const Text("I've waited — check again"),
                    ),
                  ] else ...[
                    if (rejected && (sub?.reviewNote ?? '').isNotEmpty) ...[
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(sub!.reviewNote!,
                            style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
                      ),
                      const SizedBox(height: 12),
                    ],
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        border: Border.all(color: AppColors.line),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        children: [
                          const Text('THIS MONTH',
                              style: TextStyle(fontSize: 10, letterSpacing: 0.6, fontWeight: FontWeight.w700, color: AppColors.muted)),
                          const SizedBox(height: 4),
                          Text('\$${sub?.amount ?? '0'}',
                              style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: AppColors.brandDark)),
                          const Text('per month', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Pay this month\'s subscription, then upload your proof of payment. '
                      'We\'ll verify it (usually within 30 minutes) and restore full access.',
                      style: TextStyle(fontSize: 14, color: AppColors.muted),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _busy ? null : _uploadPop,
                      icon: const Icon(LucideIcons.upload, size: 16),
                      label: Text(_busy ? 'Uploading…' : 'Upload proof of payment'),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
                    ),
                  ],
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _busy ? null : () => ref.read(authProvider.notifier).logout(),
                    child: const Text('Log out instead'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
