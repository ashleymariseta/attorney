import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../router.dart';
import '../../theme/app_theme.dart';

/// Static Privacy Policy page. Prose copied verbatim from
/// frontend/app/privacy/page.tsx.
class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});

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
        title: const Text('Privacy Policy'),
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
            'Privacy Policy',
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppColors.ink, height: 1.15),
          ),
          const SizedBox(height: 6),
          Text(
            'Last updated · $lastUpdated',
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 24),

          const _Heading('What we collect'),
          const _Bullet(
            bold: 'Account details',
            text: ' — name, email, role, optional phone number, optional profile picture.',
          ),
          const _Bullet(
            bold: 'KYC',
            text: ' — for clients, an ID document (type, number, file). For lawyers, practising '
                'certificate details and file.',
          ),
          const _Bullet(
            bold: 'Matter content',
            text: ' — messages, documents you upload, drafts you sign, time entries, payments, '
                'consultations.',
          ),
          const _Bullet(
            bold: 'Technical',
            text: ' — IP address and basic device info in server logs.',
          ),

          const SizedBox(height: 18),
          const _Heading('How we use it'),
          const _Bullet(text: 'To operate the platform and connect clients with verified lawyers.'),
          const _Bullet(text: 'To process payments and maintain a trust ledger.'),
          const _Bullet(
            text: 'To send transactional emails (invites, password resets, booking and payment events).',
          ),
          const _Bullet(text: 'For security, fraud prevention, and to comply with legal obligations.'),

          const SizedBox(height: 18),
          const _Heading('Who can see your data'),
          const _Bullet(
            bold: 'Your assigned lawyer',
            text: ' sees your matter content. If they belong to a firm, other lawyers in that firm '
                'can also see matters opened with any firm member.',
          ),
          const _Bullet(
            bold: 'Platform admins',
            text: ' may review proof-of-payment uploads and KYC documents.',
          ),
          const _Bullet(text: 'We do not sell your data and do not share it with third parties for marketing.'),

          const SizedBox(height: 18),
          const _Heading('Where it lives'),
          const _Body(
            'Data is stored on our application database and object storage. Files marked KYC are kept '
            'in a restricted bucket only accessible to verifiers.',
          ),

          const SizedBox(height: 18),
          const _Heading('Your rights'),
          const _Body(
            'You can request a copy of your data or ask us to delete your account by contacting '
            'privacy@attorney.local. Deletion may be delayed where law requires us to retain certain '
            'records (e.g. trust-ledger entries).',
          ),

          const SizedBox(height: 18),
          const _Heading('Cookies'),
          const _Body(
            'We use essential cookies/localStorage to keep you signed in. We do not run third-party '
            'advertising trackers.',
          ),

          const SizedBox(height: 18),
          const _Heading('Changes'),
          const _Body(
            "If we make material changes to this policy we'll notify users by email.",
          ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(fontSize: 14, color: AppColors.ink.withValues(alpha: 0.85), height: 1.55),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({this.bold, this.text = ''});
  final String? bold;
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 8, right: 10),
            child: SizedBox(
              width: 4,
              height: 4,
              child: DecoratedBox(
                decoration: BoxDecoration(color: AppColors.brand, shape: BoxShape.circle),
              ),
            ),
          ),
          Expanded(
            child: RichText(
              text: TextSpan(
                style: TextStyle(fontSize: 14, color: AppColors.ink.withValues(alpha: 0.85), height: 1.55),
                children: [
                  if (bold != null)
                    TextSpan(
                      text: bold,
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                    ),
                  TextSpan(text: text),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
