import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/app_theme.dart';

/// Faint, scattered legal-themed icons used as the chat background.
/// Mirrors frontend/components/ChatDoodles.tsx — same deterministic PRNG
/// (mulberry32) and seed so the layout matches the web pixel-for-pixel
/// at the same viewport size.
class ChatDoodles extends StatelessWidget {
  const ChatDoodles({super.key});

  static const _icons = <IconData>[
    LucideIcons.scale,
    LucideIcons.gavel,
    LucideIcons.bookOpen,
    LucideIcons.fileText,
    LucideIcons.stamp,
    LucideIcons.briefcase,
    LucideIcons.landmark,
    LucideIcons.graduationCap,
    LucideIcons.penLine,
    LucideIcons.scroll,
    LucideIcons.shieldCheck,
    LucideIcons.fileSignature,
    LucideIcons.paperclip,
    LucideIcons.building2,
    LucideIcons.banknote,
    LucideIcons.mail,
  ];

  static final List<_Spot> _spots = _generateSpots();

  static List<_Spot> _generateSpots() {
    var seed = 20240607;
    double rand() {
      seed = (seed + 0x6d2b79f5) & 0xFFFFFFFF;
      var t = ((seed ^ (seed >>> 15)) * (1 | seed)) & 0xFFFFFFFF;
      t = ((t + ((t ^ (t >>> 7)) * (61 | t))) ^ t) & 0xFFFFFFFF;
      return ((t ^ (t >>> 14)) & 0xFFFFFFFF) / 4294967296;
    }

    return List.generate(600, (_) => _Spot(
          top: rand(),
          left: rand(),
          size: 14 + (rand() * 26).floor().toDouble(),
          rotDeg: (rand() * 60 - 30).floorToDouble(),
          opacity: 0.035 + rand() * 0.03,
          iconIndex: (rand() * _icons.length).floor(),
        ));
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: ClipRect(
          child: LayoutBuilder(
            builder: (context, c) {
              return Stack(
                children: [
                  for (final s in _spots)
                    Positioned(
                      left: s.left * c.maxWidth,
                      top: s.top * c.maxHeight,
                      child: Transform.rotate(
                        angle: s.rotDeg * 3.14159265 / 180,
                        child: Icon(
                          _icons[s.iconIndex],
                          size: s.size,
                          color: AppColors.brandDark.withValues(alpha: s.opacity),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Spot {
  const _Spot({
    required this.top,
    required this.left,
    required this.size,
    required this.rotDeg,
    required this.opacity,
    required this.iconIndex,
  });
  final double top;
  final double left;
  final double size;
  final double rotDeg;
  final double opacity;
  final int iconIndex;
}
