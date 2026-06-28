import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/app_theme.dart';

/// Branded scaffold for the auth screens: a teal gradient header (white logo,
/// title, subtitle and a faint scales-of-justice watermark) above a white
/// rounded sheet that holds the form. Keeps every screen visually consistent.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.onBack,
    this.footer,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;
  final VoidCallback? onBack;

  /// Pinned to the bottom of the white sheet (e.g. a "create account" link).
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.of(context).padding.top;
    final screenH = MediaQuery.of(context).size.height;
    return Scaffold(
      backgroundColor: AppColors.brandDark,
      resizeToAvoidBottomInset: true,
      body: LayoutBuilder(
        builder: (context, constraints) {
          // The form sheet should begin around the middle of the screen, so the
          // header takes ~half the screen height. `constraints.maxHeight` is the
          // space left after the keyboard, so the header yields to the keyboard
          // (always leaving room for the inputs) and never gets too small.
          final available = constraints.maxHeight;
          double headerH = screenH * 0.5;
          const formMin = 200.0;
          if (headerH > available - formMin) headerH = available - formMin;
          if (headerH < 220) headerH = 220;
          if (headerH > available) headerH = available;

          return Column(
            children: [
              // ---- Gradient header ------------------------------------------
              SizedBox(
                height: headerH,
                width: double.infinity,
                child: DecoratedBox(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.brand, AppColors.brandDarker],
                    ),
                  ),
                  child: Stack(
                    children: [
                      // Soft top-right glow — ambient light on the panel.
                      Positioned(
                        right: -70,
                        top: -60,
                        child: Container(
                          width: 240,
                          height: 240,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: RadialGradient(
                              colors: [
                                AppColors.brandLight.withValues(alpha: 0.22),
                                AppColors.brandLight.withValues(alpha: 0.0),
                              ],
                            ),
                          ),
                        ),
                      ),
                      // Cool counter-glow bottom-left for depth.
                      Positioned(
                        left: -50,
                        bottom: -60,
                        child: Container(
                          width: 200,
                          height: 200,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: RadialGradient(
                              colors: [
                                AppColors.brand.withValues(alpha: 0.28),
                                AppColors.brand.withValues(alpha: 0.0),
                              ],
                            ),
                          ),
                        ),
                      ),
                      // Flowing bezier ribbons — same subtle motif as the dashboard.
                      const Positioned.fill(child: CustomPaint(painter: _AuthRibbonPainter())),

                      // Brand logo, top-right.
                      Positioned(
                        top: topPad + 16,
                        right: 8,
                        child: Image.asset(
                          'assets/img/logos/logo-horizontal-white.png',
                          height: 64,
                          fit: BoxFit.contain,
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.fromLTRB(24, topPad + 14, 24, 28),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (onBack != null)
                              _CircleIconButton(icon: LucideIcons.arrowLeft, onTap: onBack!),
                            // Pushes the title to the bottom of the header — a
                            // generous gap below the logo that grows with height.
                            const Spacer(),
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                                height: 1.1,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              subtitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.82),
                                fontSize: 14,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // ---- White form sheet -----------------------------------------
              Expanded(
                child: Container(
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  ),
                  child: SafeArea(
                    top: false,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 26, 24, 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ...children,
                          if (footer != null) ...[
                            const SizedBox(height: 14),
                            footer!,
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Subtle flowing bezier ribbons across the gradient header — the same visual
/// motif used on the dashboard hero card.
class _AuthRibbonPainter extends CustomPainter {
  const _AuthRibbonPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    void ribbon(double yOffset, double curveStrength, double opacity, double strokeWidth) {
      final paint = Paint()
        ..color = Colors.white.withValues(alpha: opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round;
      final path = Path()
        ..moveTo(-30, h * yOffset)
        ..cubicTo(
          w * 0.30, h * (yOffset - curveStrength),
          w * 0.65, h * (yOffset + curveStrength),
          w + 30, h * (yOffset - curveStrength * 0.4),
        );
      canvas.drawPath(path, paint);
    }

    ribbon(0.30, 0.16, 0.10, 1.4);

    final accent = Paint()
      ..shader = LinearGradient(
        colors: [
          AppColors.brandLight.withValues(alpha: 0.0),
          AppColors.brandLight.withValues(alpha: 0.40),
          AppColors.brandLight.withValues(alpha: 0.0),
        ],
      ).createShader(Rect.fromLTWH(0, 0, w, h))
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    final mid = Path()
      ..moveTo(-30, h * 0.62)
      ..cubicTo(w * 0.25, h * 0.42, w * 0.75, h * 0.86, w + 30, h * 0.58);
    canvas.drawPath(mid, accent);

    ribbon(0.86, 0.12, 0.08, 1.0);
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

class _CircleIconButton extends StatelessWidget {
  const _CircleIconButton({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.16),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, size: 18, color: Colors.white),
        ),
      ),
    );
  }
}
