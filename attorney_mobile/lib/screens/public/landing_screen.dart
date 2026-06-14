import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../router.dart';
import '../../theme/app_theme.dart';

/// Marketing landing page — hero, services strip, how-it-works, features,
/// trust + safety, and CTA. Mirrors the web /page.tsx but reflowed
/// for a vertical mobile canvas.
class LandingScreen extends ConsumerWidget {
  const LandingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              backgroundColor: AppColors.surface,
              foregroundColor: AppColors.ink,
              elevation: 0,
              pinned: true,
              titleSpacing: 16,
              title: const _BrandWordmark(),
              actions: [
                TextButton(
                  onPressed: () => context.go(Routes.login),
                  style: TextButton.styleFrom(foregroundColor: AppColors.ink),
                  child: const Text('Log in'),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 12, left: 4),
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.brandDark,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                    ),
                    onPressed: () => context.go(Routes.lawyersPublic),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Find a lawyer'),
                        SizedBox(width: 6),
                        Icon(LucideIcons.chevronRight, size: 14),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SliverToBoxAdapter(child: _ServicesStrip()),
            SliverToBoxAdapter(child: _Hero(onFindLawyer: () => context.go(Routes.lawyersPublic), onRegister: () => context.go(Routes.register), onLogin: () => context.go(Routes.login))),
            const SliverToBoxAdapter(child: _ProofStrip()),
            const SliverToBoxAdapter(child: _HowItWorks()),
            const SliverToBoxAdapter(child: _Features()),
            const SliverToBoxAdapter(child: _Trust()),
            SliverToBoxAdapter(
              child: _FinalCta(
                onFindLawyer: () => context.go(Routes.lawyersPublic),
                onRegister: () => context.go(Routes.register),
              ),
            ),
            SliverToBoxAdapter(child: _Footer(onTerms: () => context.go(Routes.terms), onPrivacy: () => context.go(Routes.privacy), onLawyers: () => context.go(Routes.lawyersPublic))),
          ],
        ),
      ),
    );
  }
}

class _BrandWordmark extends StatelessWidget {
  const _BrandWordmark();
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppColors.brandDark, AppColors.brand],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(LucideIcons.gavel, size: 16, color: Colors.white),
        ),
        const SizedBox(width: 8),
        const Text(
          'Attorney',
          style: TextStyle(
            color: AppColors.brandDark,
            fontSize: 18,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.3,
          ),
        ),
      ],
    );
  }
}

class _ServicesStrip extends StatelessWidget {
  const _ServicesStrip();
  static const _services = [
    'Name Transfer',
    'Bond Registration',
    'Conveyancing',
    'Trust Accounts',
    'Family Law',
    'Notarial',
    'Estate Planning',
    'Commercial Law',
    'Litigation',
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(color: AppColors.line),
          bottom: BorderSide(color: AppColors.line),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: SizedBox(
        height: 18,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: _services.length,
          separatorBuilder: (_, __) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Center(
              child: Container(
                width: 3,
                height: 3,
                decoration: const BoxDecoration(color: AppColors.brand, shape: BoxShape.circle),
              ),
            ),
          ),
          itemBuilder: (_, i) => Center(
            child: Text(
              _services[i].toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 2.4,
                color: AppColors.brandDark,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.onFindLawyer, required this.onRegister, required this.onLogin});
  final VoidCallback onFindLawyer;
  final VoidCallback onRegister;
  final VoidCallback onLogin;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          left: 0,
          right: 0,
          top: -40,
          child: Container(
            height: 280,
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment.topCenter,
                radius: 0.9,
                colors: [
                  AppColors.brand.withValues(alpha: 0.18),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.brandLight.withValues(alpha: 0.4),
                  border: Border.all(color: AppColors.brandLight),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(color: AppColors.brand, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'Verified legal counsel, on demand',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.brandDark),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              RichText(
                text: const TextSpan(
                  style: TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w700,
                    height: 1.08,
                    color: AppColors.ink,
                  ),
                  children: [
                    TextSpan(text: 'A workspace for you and your '),
                    TextSpan(text: 'lawyer', style: TextStyle(color: AppColors.brand)),
                    TextSpan(text: '.\n'),
                    TextSpan(
                      text: 'Not another inbox.',
                      style: TextStyle(color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Choose a verified lawyer, book a consultation, and do the work in one place — '
                'messages, documents, drafts, and trust-accounted payments.',
                style: TextStyle(fontSize: 15, color: AppColors.muted, height: 1.5),
              ),
              const SizedBox(height: 22),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.brandDark,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  minimumSize: const Size(double.infinity, 0),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: onFindLawyer,
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('Find a lawyer', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                    SizedBox(width: 8),
                    Icon(LucideIcons.chevronRight, size: 16),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  minimumSize: const Size(double.infinity, 0),
                ),
                onPressed: onRegister,
                child: const Text('Create an account'),
              ),
              const SizedBox(height: 4),
              Center(
                child: TextButton(
                  onPressed: onLogin,
                  child: const Text('Already a member? Log in'),
                ),
              ),
              const SizedBox(height: 18),
              const _HeroImage(),
              const SizedBox(height: 22),
              const Wrap(
                spacing: 18,
                runSpacing: 10,
                children: [
                  _TrustChip(icon: LucideIcons.shield, label: 'Bar-verified lawyers'),
                  _TrustChip(icon: LucideIcons.lock, label: 'Funds held in escrow'),
                  _TrustChip(icon: LucideIcons.sparkles, label: 'Same-day matters'),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TrustChip extends StatelessWidget {
  const _TrustChip({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.muted),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      ],
    );
  }
}

class _HeroImage extends StatelessWidget {
  const _HeroImage();
  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 4 / 5,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.line),
          boxShadow: [
            BoxShadow(
              color: AppColors.brandDarker.withValues(alpha: 0.25),
              blurRadius: 40,
              offset: const Offset(0, 20),
            ),
          ],
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.brandDark,
                    AppColors.brandDarker,
                  ],
                ),
              ),
            ),
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Know your rights'.toUpperCase(),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 3,
                        color: AppColors.brandLight.withValues(alpha: 0.9),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'You have the right to an attorney.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Exercise it — on your terms, from anywhere.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 14,
              bottom: 14,
              child: _FloatingCard(
                icon: LucideIcons.checkCircle2,
                title: 'Matter opened',
                subtitle: 'Lease review · Today',
              ),
            ),
            Positioned(
              right: 14,
              top: 14,
              child: _FloatingCard(
                icon: LucideIcons.calendar,
                title: 'Consultation booked',
                subtitle: 'Tomorrow · 10:30',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FloatingCard extends StatelessWidget {
  const _FloatingCard({required this.icon, required this.title, required this.subtitle});
  final IconData icon;
  final String title;
  final String subtitle;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(10),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Icon(icon, size: 14, color: AppColors.brandDark),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.ink)),
              const SizedBox(height: 1),
              Text(subtitle, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            ],
          ),
        ],
      ),
    );
  }
}

class _ProofStrip extends StatelessWidget {
  const _ProofStrip();
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.canvas,
        border: Border(
          top: BorderSide(color: AppColors.line),
          bottom: BorderSide(color: AppColors.line),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      child: const Wrap(
        alignment: WrapAlignment.spaceEvenly,
        runSpacing: 10,
        spacing: 16,
        children: [
          _ProofItem(text: 'Bar-verified'),
          _ProofItem(text: 'Trust-accounted'),
          _ProofItem(text: 'End-to-end secure'),
          _ProofItem(text: 'Built for retainers'),
        ],
      ),
    );
  }
}

class _ProofItem extends StatelessWidget {
  const _ProofItem({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 10,
        fontWeight: FontWeight.w800,
        letterSpacing: 2,
        color: AppColors.muted,
      ),
    );
  }
}

class _HowItWorks extends StatelessWidget {
  const _HowItWorks();
  static const _steps = [
    (n: '01', t: 'Find a verified lawyer', d: 'Browse profiles, areas of practice, and rates. Every lawyer is bar-verified before listing.'),
    (n: '02', t: 'Open a matter', d: 'Book a consultation or, if on retainer, jump straight into a private matter room.'),
    (n: '03', t: 'Work in one room', d: 'Chat, share documents, sign drafts, and pay — all from a single timeline.'),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 36, 20, 36),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionEyebrow('How it works'),
          const SizedBox(height: 10),
          const Text(
            'From question to counsel in three steps.',
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.15),
          ),
          const SizedBox(height: 12),
          const Text(
            'Skip the cold calls and email chains. Match with a verified lawyer, fund the matter, and work together in a dedicated room.',
            style: TextStyle(fontSize: 14, color: AppColors.muted, height: 1.5),
          ),
          const SizedBox(height: 24),
          for (final s in _steps) ...[
            _StepCard(n: s.n, title: s.t, desc: s.d),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _StepCard extends StatelessWidget {
  const _StepCard({required this.n, required this.title, required this.desc});
  final String n;
  final String title;
  final String desc;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            n,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
              color: AppColors.brand,
            ),
          ),
          const SizedBox(height: 8),
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.ink)),
          const SizedBox(height: 6),
          Text(desc, style: const TextStyle(fontSize: 13, color: AppColors.muted, height: 1.5)),
        ],
      ),
    );
  }
}

class _Features extends StatelessWidget {
  const _Features();
  static const _items = [
    (t: 'Matter rooms', d: 'Slack-style channels per engagement, with files, drafts, and decisions in one timeline.', i: LucideIcons.messageSquare),
    (t: 'On retainer', d: 'Keep counsel on standby. Skip the intake call — open a room and pick up where you left off.', i: LucideIcons.sparkles),
    (t: 'Trust accounting', d: 'Client funds held in escrow until released. Every movement is logged on the trust ledger.', i: LucideIcons.lock),
    (t: 'Verified counsel', d: 'Every lawyer is bar-verified before they list. Profiles show practice areas and rates upfront.', i: LucideIcons.shield),
    (t: 'Documents that sign themselves', d: 'Upload, redline, and sign drafts directly in the room. Versioning baked in.', i: LucideIcons.fileText),
    (t: 'Provider-agnostic payments', d: 'Card, transfer, or manual proof-of-payment — same ledger, same review flow.', i: LucideIcons.creditCard),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.canvas,
      padding: const EdgeInsets.fromLTRB(20, 36, 20, 36),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionEyebrow('Features'),
          const SizedBox(height: 10),
          const Text(
            "Everything a matter needs. Nothing it doesn't.",
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.15),
          ),
          const SizedBox(height: 12),
          const Text(
            'Purpose-built for client-lawyer work: rooms instead of inboxes, escrow instead of invoices, and provenance for every document.',
            style: TextStyle(fontSize: 14, color: AppColors.muted, height: 1.5),
          ),
          const SizedBox(height: 24),
          for (final f in _items) ...[
            _FeatureCard(icon: f.i, title: f.t, desc: f.d),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({required this.icon, required this.title, required this.desc});
  final IconData icon;
  final String title;
  final String desc;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.brandLight.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.brandDark, size: 20),
          ),
          const SizedBox(height: 14),
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
          const SizedBox(height: 6),
          Text(desc, style: const TextStyle(fontSize: 13, color: AppColors.muted, height: 1.5)),
        ],
      ),
    );
  }
}

class _Trust extends StatelessWidget {
  const _Trust();
  static const _points = [
    'Escrow-first payments with reviewed proof of payment',
    'Bar verification before any lawyer can list',
    'Per-matter access controls and audit trail',
    'JWT auth with rotating refresh and blacklist',
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 36, 20, 36),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 5 / 4,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: AppColors.line),
                gradient: const LinearGradient(
                  colors: [AppColors.brandDark, AppColors.brand],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              alignment: Alignment.center,
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(LucideIcons.landmark, color: Colors.white, size: 36),
                    const SizedBox(height: 14),
                    Text(
                      'Trust ledger'.toUpperCase(),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 3,
                        color: AppColors.brandLight.withValues(alpha: 0.9),
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Auditable end-to-end',
                      style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 22),
          const _SectionEyebrow('Trust & safety'),
          const SizedBox(height: 10),
          const Text(
            'Built on the same rails your firm already trusts.',
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.15),
          ),
          const SizedBox(height: 12),
          const Text(
            'Client money never mingles with operating funds. Every deposit, hold, and release posts to an internal trust ledger you can audit at any time.',
            style: TextStyle(fontSize: 14, color: AppColors.muted, height: 1.5),
          ),
          const SizedBox(height: 18),
          for (final p in _points)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 22,
                    height: 22,
                    margin: const EdgeInsets.only(top: 1),
                    decoration: BoxDecoration(
                      color: AppColors.brandLight.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Icon(LucideIcons.check, size: 14, color: AppColors.brandDark),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(p, style: const TextStyle(fontSize: 14, color: AppColors.ink, height: 1.4)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SectionEyebrow extends StatelessWidget {
  const _SectionEyebrow(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        letterSpacing: 2,
        color: AppColors.brand,
      ),
    );
  }
}

class _FinalCta extends StatelessWidget {
  const _FinalCta({required this.onFindLawyer, required this.onRegister});
  final VoidCallback onFindLawyer;
  final VoidCallback onRegister;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 36),
      child: Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: AppColors.brandDarker,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Open your first matter today.',
              style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700, height: 1.15),
            ),
            const SizedBox(height: 10),
            Text(
              'Free to sign up. You only fund a matter when you choose to engage a lawyer.',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 20),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: AppColors.brandDarker,
                padding: const EdgeInsets.symmetric(vertical: 14),
                minimumSize: const Size(double.infinity, 0),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              onPressed: onFindLawyer,
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Find a lawyer'),
                  SizedBox(width: 8),
                  Icon(LucideIcons.chevronRight, size: 16),
                ],
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
                padding: const EdgeInsets.symmetric(vertical: 14),
                minimumSize: const Size(double.infinity, 0),
              ),
              onPressed: onRegister,
              child: const Text('Create an account'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.onTerms, required this.onPrivacy, required this.onLawyers});
  final VoidCallback onTerms;
  final VoidCallback onPrivacy;
  final VoidCallback onLawyers;

  @override
  Widget build(BuildContext context) {
    final year = DateTime.now().year;
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
      child: Column(
        children: [
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 16,
            children: [
              TextButton(onPressed: onLawyers, child: const Text('Find a lawyer', style: TextStyle(fontSize: 12, color: AppColors.muted))),
              TextButton(onPressed: onTerms, child: const Text('Terms', style: TextStyle(fontSize: 12, color: AppColors.muted))),
              TextButton(onPressed: onPrivacy, child: const Text('Privacy', style: TextStyle(fontSize: 12, color: AppColors.muted))),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '© $year Attorney. All rights reserved.',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}
