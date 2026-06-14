import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/app_theme.dart';

/// Status pill that colour-codes by keyword in the status string,
/// matching the web ``statusTone`` helper.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status, this.label});
  final String status;
  final String? label;

  ({Color bg, Color fg}) _tone() {
    final s = status.toLowerCase();
    if (RegExp(r'verified|confirmed|completed|active|paid').hasMatch(s)) {
      return (bg: const Color(0xFFECFDF5), fg: const Color(0xFF047857));
    }
    if (s.contains('partial')) {
      return (bg: const Color(0xFFEFF6FF), fg: const Color(0xFF0369A1));
    }
    if (RegExp(r'pending|awaiting|review').hasMatch(s)) {
      return (bg: const Color(0xFFFEF3C7), fg: const Color(0xFF92400E));
    }
    if (RegExp(r'rejected|failed|cancelled|declined').hasMatch(s)) {
      return (bg: const Color(0xFFFEE2E2), fg: const Color(0xFFB91C1C));
    }
    return (bg: AppColors.canvas, fg: AppColors.muted);
  }

  @override
  Widget build(BuildContext context) {
    final t = _tone();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: t.bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        (label ?? status).toUpperCase(),
        style: TextStyle(
          color: t.fg,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// Country flag emoji from an ISO 3166-1 alpha-2 code. Mirrors flagFor()
/// in frontend/lib/flag.ts.
String flagForCountry(String? code) {
  if (code == null || code.length != 2) return '';
  final c = code.toUpperCase();
  if (!RegExp(r'^[A-Z]{2}$').hasMatch(c)) return '';
  const base = 0x1F1E6;
  return String.fromCharCodes([
    base + c.codeUnitAt(0) - 65,
    base + c.codeUnitAt(1) - 65,
  ]);
}

const countryNames = <String, String>{
  'ZW': 'Zimbabwe', 'ZA': 'South Africa', 'BW': 'Botswana', 'NA': 'Namibia',
  'ZM': 'Zambia', 'MW': 'Malawi', 'MZ': 'Mozambique', 'KE': 'Kenya',
  'TZ': 'Tanzania', 'UG': 'Uganda', 'RW': 'Rwanda', 'NG': 'Nigeria',
  'GH': 'Ghana', 'ET': 'Ethiopia', 'EG': 'Egypt', 'MA': 'Morocco',
  'US': 'United States', 'GB': 'United Kingdom', 'IE': 'Ireland',
  'AU': 'Australia', 'CA': 'Canada', 'IN': 'India', 'CN': 'China',
  'FR': 'France', 'DE': 'Germany', 'ES': 'Spain', 'IT': 'Italy',
  'NL': 'Netherlands', 'PT': 'Portugal', 'BR': 'Brazil', 'MX': 'Mexico',
  'AE': 'United Arab Emirates',
};

/// Skeleton block — quick shimmer-less loader.
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.height = 14, this.width, this.radius = 6});
  final double height;
  final double? width;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: width,
      decoration: BoxDecoration(
        color: AppColors.line.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// One-line banner used to surface API errors inline.
class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFEE2E2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Icon(LucideIcons.alertCircle, size: 16, color: Color(0xFFB91C1C)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// Empty-state column used by every list screen.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.action,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 36, color: AppColors.muted),
          const SizedBox(height: 12),
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
            textAlign: TextAlign.center,
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
              textAlign: TextAlign.center,
            ),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

/// Faint, rotated watermark icon for the corner of a card. Mirrors the web
/// `<DecoIcon>` helper from frontend/components/Banner.tsx — the parent
/// must be a Stack with `clipBehavior: Clip.hardEdge` (or similar) so the
/// rotated icon is cropped to the card bounds.
class DecoIcon extends StatelessWidget {
  const DecoIcon({
    super.key,
    required this.icon,
    this.size = 80,
    this.color,
    this.right = 8,
    this.rotationDeg = 12,
  });
  final IconData icon;
  final double size;
  final Color? color;
  final double right;
  final double rotationDeg;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      right: right,
      top: 0,
      bottom: 0,
      child: IgnorePointer(
        child: Center(
          child: Transform.rotate(
            angle: rotationDeg * 3.14159265 / 180,
            child: Icon(
              icon,
              size: size,
              color: color ?? AppColors.cardIconDeep.withValues(alpha: 0.16),
            ),
          ),
        ),
      ),
    );
  }
}

/// Convenience scaffolding for any screen with an AppBar + back button.
class ScreenShell extends StatelessWidget {
  const ScreenShell({super.key, required this.title, required this.child, this.actions});
  final String title;
  final Widget child;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      body: SafeArea(child: child),
    );
  }
}
