import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../router.dart';
import '../../theme/app_theme.dart';

/// Static Terms of Service page. Prose copied verbatim from
/// frontend/app/terms/page.tsx.
class TermsScreen extends ConsumerWidget {
  const TermsScreen({super.key});

  static const _sections = <_Section>[
    _Section(
      heading: '1. Acceptance of terms',
      body:
          'By creating an Attorney account or using the platform you agree to these terms. '
          'If you do not agree, do not use the service.',
    ),
    _Section(
      heading: '2. Who we are',
      body:
          'Attorney is a workspace that introduces clients to verified lawyers and supports their '
          'engagement (consultations, document sharing, trust-accounted payments). We are not a law firm '
          'and do not provide legal advice.',
    ),
    _Section(
      heading: '3. Accounts',
      body:
          'You must provide accurate information when registering. You are responsible for everything '
          'that happens under your account, and you must keep your credentials confidential.',
    ),
    _Section(
      heading: '4. Lawyer verification & KYC',
      body:
          'Lawyers must submit a valid practising certificate and bar number. Clients may be asked to '
          'provide a government-issued ID. We may suspend accounts that fail verification.',
    ),
    _Section(
      heading: '5. Payments & trust accounting',
      body:
          'Client funds are tracked on an internal trust ledger until released to the assigned lawyer. '
          "Refunds and chargebacks follow each payment method's rules. We do not advance funds.",
    ),
    _Section(
      heading: '6. Acceptable use',
      body:
          'You may not use the platform for unlawful activity, to harass others, or to circumvent our '
          'fees by taking engagements off-platform that originated here.',
    ),
    _Section(
      heading: '7. Termination',
      body:
          'We may suspend or terminate accounts that violate these terms. You can delete your account '
          'at any time by contacting support.',
    ),
    _Section(
      heading: '8. Disclaimers',
      body:
          'The platform is provided “as is”. We make no warranty about outcomes of any legal matter and '
          'disclaim liability to the extent allowed by law.',
    ),
    _Section(
      heading: '9. Changes',
      body: "We may update these terms; we'll notify users of material changes by email.",
    ),
    _Section(
      heading: '10. Contact',
      body: 'Questions? Reach us at hello@attorney.local.',
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lastUpdated = DateFormat.yMMMMd().format(DateTime.now());
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.canPop() ? context.pop() : context.go(Routes.landing),
        ),
        title: const Text('Terms of Service'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          TextButton(
            onPressed: () => context.go(Routes.landing),
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              foregroundColor: AppColors.brand,
              minimumSize: const Size(0, 28),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              alignment: Alignment.centerLeft,
            ),
            child: Text(
              '← Back home'.toUpperCase(),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 2),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Terms of Service',
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppColors.ink, height: 1.15),
          ),
          const SizedBox(height: 6),
          Text(
            'Last updated · $lastUpdated',
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 24),
          for (final s in _sections) ...[
            Text(
              s.heading,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink),
            ),
            const SizedBox(height: 6),
            Text(
              s.body,
              style: TextStyle(fontSize: 14, color: AppColors.ink.withValues(alpha: 0.85), height: 1.55),
            ),
            const SizedBox(height: 18),
          ],
          const SizedBox(height: 8),
          const Divider(color: AppColors.line),
          const SizedBox(height: 12),
          Text(
            'Questions? Reach us at hello@attorney.local.',
            style: TextStyle(fontSize: 13, color: AppColors.ink.withValues(alpha: 0.85)),
          ),
        ],
      ),
    );
  }
}

class _Section {
  const _Section({required this.heading, required this.body});
  final String heading;
  final String body;
}
