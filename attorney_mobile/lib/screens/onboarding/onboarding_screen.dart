import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/brand_illustration.dart';

class _Slide {
  const _Slide({
    required this.svg,
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.body,
  });
  final String? svg; // null → icon-only slide
  final IconData icon;
  final String eyebrow;
  final String title;
  final String body;
}

const _slides = <_Slide>[
  _Slide(
    svg: Illustrations.judge,
    icon: LucideIcons.scale,
    eyebrow: 'VERIFIED COUNSEL',
    title: 'Real lawyers,\non demand',
    body:
        'Browse vetted legal practitioners, see their practice areas and rates, '
        'and book a consultation in minutes — no walk-ins, no waiting rooms.',
  ),
  _Slide(
    svg: Illustrations.contract,
    icon: LucideIcons.fileText,
    eyebrow: 'MATTERS & DOCUMENTS',
    title: 'Your matters,\nall in one place',
    body:
        'Share documents, track progress and message your lawyer inside a secure '
        'matter room. Everything stays on the record and easy to find.',
  ),
  _Slide(
    svg: null,
    icon: LucideIcons.shieldCheck,
    eyebrow: 'SECURE & TRANSPARENT',
    title: 'Pay with\nconfidence',
    body:
        'Funds are held safely and released only as work is verified. Clear '
        'pricing and proof of payment — so you always know where things stand.',
  ),
];

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _isLast => _page == _slides.length - 1;

  Future<void> _finish(String route) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('seen_onboarding', true);
    ref.read(onboardingSeenProvider.notifier).state = true;
    if (mounted) context.go(route);
  }

  void _next() {
    if (_isLast) {
      _finish(Routes.register);
    } else {
      _controller.nextPage(duration: const Duration(milliseconds: 320), curve: Curves.easeOut);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            // Skip
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 8, top: 4),
                child: TextButton(
                  onPressed: () => _finish(Routes.login),
                  style: TextButton.styleFrom(foregroundColor: AppColors.muted),
                  child: const Text('Skip'),
                ),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (_, i) => _SlideView(slide: _slides[i]),
              ),
            ),
            // Dots
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_slides.length, (i) {
                final active = i == _page;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  height: 7,
                  width: active ? 22 : 7,
                  decoration: BoxDecoration(
                    color: active ? AppColors.brand : AppColors.line,
                    borderRadius: BorderRadius.circular(999),
                  ),
                );
              }),
            ),
            // CTA
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 8),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _next,
                  icon: Icon(_isLast ? LucideIcons.arrowRight : LucideIcons.chevronRight, size: 18),
                  label: Text(_isLast ? 'Get started' : 'Next'),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: TextButton(
                onPressed: () => _finish(Routes.login),
                child: const Text('I already have an account'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideView extends StatelessWidget {
  const _SlideView({required this.slide});
  final _Slide slide;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Illustration on a soft teal disc.
          Center(
            child: Container(
              height: 260,
              width: 260,
              decoration: const BoxDecoration(
                color: AppColors.cardTint,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              padding: const EdgeInsets.all(34),
              child: slide.svg != null
                  ? BrandIllustration(slide.svg!, height: 180, semanticLabel: slide.title)
                  : Icon(slide.icon, size: 110, color: AppColors.brand),
            ),
          ),
          const SizedBox(height: 40),
          Row(
            children: [
              Icon(slide.icon, size: 14, color: AppColors.brand),
              const SizedBox(width: 6),
              Text(
                slide.eyebrow,
                style: const TextStyle(
                  color: AppColors.brand,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            slide.title,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 28,
              fontWeight: FontWeight.w800,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            slide.body,
            style: const TextStyle(color: AppColors.muted, fontSize: 14.5, height: 1.5),
          ),
        ],
      ),
    );
  }
}
