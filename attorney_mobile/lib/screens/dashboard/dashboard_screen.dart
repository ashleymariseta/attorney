import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mobile dashboard. Mirrors the web's role-split layout — separate
/// content for lawyers vs clients sharing the same scaffold.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  late Future<_DashboardData> _load;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<_DashboardData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final results = await Future.wait([
      ep.listMatters(),
      ep.listConsultations(),
    ]);
    return _DashboardData(
      matters: results[0] as List<Matter>,
      consultations: results[1] as List<Consultation>,
    );
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: Text('Welcome${me?.firstName.isNotEmpty == true ? ', ${me!.firstName}' : ''}'),
        actions: const [
          _NotificationBellAction(),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_DashboardData>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Skeleton(height: 90, width: double.infinity),
                  const SizedBox(height: 12),
                  Skeleton(height: 60, width: double.infinity),
                  const SizedBox(height: 12),
                  Skeleton(height: 60, width: double.infinity),
                ],
              );
            }
            if (snap.hasError) {
              return Center(child: ErrorBanner(message: snap.error.toString()));
            }
            final data = snap.data!;
            final isLawyer = me?.isLawyer ?? false;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (isLawyer)
                  _LawyerOverview(
                    matters: data.matters,
                    consultations: data.consultations,
                    firstName: me?.firstName ?? '',
                  )
                else
                  _ClientOverview(matters: data.matters, consultations: data.consultations),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DashboardData {
  _DashboardData({required this.matters, required this.consultations});
  final List<Matter> matters;
  final List<Consultation> consultations;
}

class _ClientOverview extends StatelessWidget {
  const _ClientOverview({required this.matters, required this.consultations});
  final List<Matter> matters;
  final List<Consultation> consultations;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final upcoming = consultations
        .where((c) {
          final dt = DateTime.tryParse(c.scheduledTime);
          if (dt == null) return false;
          return dt.isAfter(now) && c.status != 'cancelled' && c.status != 'completed';
        })
        .toList()
      ..sort((a, b) => a.scheduledTime.compareTo(b.scheduledTime));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: _Stat(label: 'Open matters', value: '${matters.length}', icon: LucideIcons.folder)),
              const SizedBox(width: 12),
              Expanded(child: _Stat(label: 'Upcoming', value: '${upcoming.length}', icon: LucideIcons.calendar)),
            ],
          ),
        ),
        const SizedBox(height: 20),
        _Banner(
          title: 'Need legal help?',
          subtitle: 'Browse verified lawyers and book a consultation in minutes.',
          ctaLabel: 'Find a lawyer',
          onTap: () => context.go(Routes.lawyersPublic),
        ),
        const SizedBox(height: 20),
        const _SectionLabel('Upcoming bookings'),
        if (upcoming.isEmpty)
          const EmptyState(
            icon: LucideIcons.calendarOff,
            title: 'No upcoming bookings',
            subtitle: 'When you book a consultation it appears here.',
          )
        else
          for (final c in upcoming.take(4)) _UpcomingTile(c: c),
        const SizedBox(height: 20),
        const _SectionLabel('Recent matters'),
        for (final m in matters.take(5)) _MatterTile(m: m),
        if (matters.isEmpty)
          const EmptyState(icon: LucideIcons.folderOpen, title: 'No matters yet', subtitle: 'Open one with a lawyer to start the timeline.'),
      ],
    );
  }
}

class _LawyerOverview extends StatelessWidget {
  const _LawyerOverview({
    required this.matters,
    required this.consultations,
    required this.firstName,
  });
  final List<Matter> matters;
  final List<Consultation> consultations;
  final String firstName;

  @override
  Widget build(BuildContext context) {
    final pending = consultations.where((c) => c.status == 'pending').toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CompactBanner(name: firstName),
        const SizedBox(height: 16),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: _Stat(label: 'Active matters', value: '${matters.length}', icon: LucideIcons.briefcase)),
              const SizedBox(width: 12),
              Expanded(child: _Stat(label: 'To confirm', value: '${pending.length}', sub: 'bookings', icon: LucideIcons.calendarCheck)),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const _SectionLabel('Bookings needing confirmation'),
        if (pending.isEmpty)
          const EmptyState(
            icon: LucideIcons.calendarOff,
            title: 'No bookings to confirm',
            subtitle: 'When clients book a consultation it lands here.',
          )
        else
          for (final c in pending) _UpcomingTile(c: c, role: 'lawyer'),
        const SizedBox(height: 20),
        const _SectionLabel('Recent matters'),
        for (final m in matters.take(5)) _MatterTile(m: m),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.7),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.icon, this.sub});
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      clipBehavior: Clip.hardEdge,
      child: Stack(
        children: [
          DecoIcon(icon: icon, size: 80),
          Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 14, color: AppColors.muted),
                    const SizedBox(width: 6),
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.6),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(value, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppColors.ink, height: 1.1)),
                if (sub != null) ...[
                  const SizedBox(height: 2),
                  Text(sub!, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.title, required this.subtitle, required this.ctaLabel, required this.onTap});
  final String title;
  final String subtitle;
  final String ctaLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.brandDarker,
            AppColors.brandDark,
            AppColors.brand,
          ],
          stops: [0.0, 0.55, 1.0],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.brandDarker.withValues(alpha: 0.35),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.hardEdge,
      child: Stack(
        children: [
          // Soft top-right glow — feels like ambient light hitting the card.
          Positioned(
            right: -60,
            top: -60,
            child: Container(
              width: 220,
              height: 220,
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
            left: -40,
            bottom: -50,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppColors.brand.withValues(alpha: 0.30),
                    AppColors.brand.withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ),

          // Flowing bezier ribbons — the visual hook.
          Positioned.fill(child: CustomPaint(painter: _BezierRibbonPainter())),

          // Faint hairline border for a glassy edge.
          Positioned.fill(
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
              ),
            ),
          ),

          // Content
          Padding(
            padding: const EdgeInsets.fromLTRB(22, 22, 22, 22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Eyebrow chip — feels intentional, not decorative.
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.13),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.shieldCheck, size: 12, color: Colors.white.withValues(alpha: 0.85)),
                      const SizedBox(width: 6),
                      Text(
                        'VERIFIED LAWYERS',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.9),
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    height: 1.15,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.82),
                    fontSize: 13.5,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 18),
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.brandDark,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: onTap,
                  icon: const Icon(LucideIcons.search, size: 16),
                  label: Text(ctaLabel),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact welcome card for the lawyer dashboard — same visual treatment
/// as `_Banner` (gradient, glows, bezier ribbons) but ~half the height and
/// no CTA. Just a friendly hello.
class _CompactBanner extends StatelessWidget {
  const _CompactBanner({required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    final greet = name.isEmpty ? 'Welcome back' : 'Welcome back, $name';
    return Container(
      height: 92,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.brandDarker,
            AppColors.brandDark,
            AppColors.brand,
          ],
          stops: [0.0, 0.55, 1.0],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.brandDarker.withValues(alpha: 0.30),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      clipBehavior: Clip.hardEdge,
      child: Stack(
        children: [
          Positioned(
            right: -40,
            top: -50,
            child: Container(
              width: 160,
              height: 160,
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
          Positioned(
            left: -30,
            bottom: -40,
            child: Container(
              width: 140,
              height: 140,
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
          Positioned.fill(child: CustomPaint(painter: _BezierRibbonPainter())),
          Positioned.fill(
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
              ),
            ),
          ),
          // Right-edge scale icon — quiet brand cue
          Positioned(
            right: 18,
            top: 0,
            bottom: 0,
            child: Center(
              child: Icon(
                LucideIcons.scale,
                size: 44,
                color: Colors.white.withValues(alpha: 0.18),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 70, 0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  greet,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.1,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Welcome to your workspace.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.78),
                    fontSize: 12.5,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Three layered cubic-bezier ribbons drawn at low opacity. Creates the
/// subtle flow lines on the hero banner without resorting to a raster image.
class _BezierRibbonPainter extends CustomPainter {
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

    // Top ribbon — soft, wide
    ribbon(0.18, 0.18, 0.10, 1.4);
    // Middle ribbon — bolder accent, brand-light tint
    final accent = Paint()
      ..shader = LinearGradient(
        colors: [
          AppColors.brandLight.withValues(alpha: 0.0),
          AppColors.brandLight.withValues(alpha: 0.45),
          AppColors.brandLight.withValues(alpha: 0.0),
        ],
      ).createShader(Rect.fromLTWH(0, 0, w, h))
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    final mid = Path()
      ..moveTo(-30, h * 0.55)
      ..cubicTo(w * 0.25, h * 0.32, w * 0.75, h * 0.78, w + 30, h * 0.50);
    canvas.drawPath(mid, accent);
    // Bottom ribbon — short, near baseline
    ribbon(0.82, 0.12, 0.08, 1.0);
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

class _UpcomingTile extends StatelessWidget {
  const _UpcomingTile({required this.c, this.role = 'client'});
  final Consultation c;
  final String role;
  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(c.scheduledTime);
    final when = dt != null
        ? DateFormat('EEE d MMM · HH:mm').format(dt.toLocal())
        : c.scheduledTime;
    final who = role == 'lawyer' ? c.client?.fullName : c.lawyer?.fullName;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.matterTitle, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
                const SizedBox(height: 4),
                Text(
                  '${who ?? ''} · $when',
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusPill(status: c.status, label: c.statusDisplay),
        ],
      ),
    );
  }
}

class _MatterTile extends StatelessWidget {
  const _MatterTile({required this.m});
  final Matter m;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => context.push(Routes.matter(m.id)),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.cardTint,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text('# ${m.title}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.ink)),
            ),
            StatusPill(status: m.status),
          ],
        ),
      ),
    );
  }
}

/// Notification bell action that opens a bottom sheet with the user's
/// notifications. Kept lean so any screen with an AppBar can drop it in.
class _NotificationBellAction extends ConsumerStatefulWidget {
  const _NotificationBellAction();
  @override
  ConsumerState<_NotificationBellAction> createState() => _NotificationBellActionState();
}

class _NotificationBellActionState extends ConsumerState<_NotificationBellAction> {
  int _unread = 0;
  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final items = await ref.read(endpointsProvider).listNotifications();
      if (!mounted) return;
      setState(() => _unread = items.where((n) => n.readAt == null).length);
    } catch (_) {}
  }

  void _open() async {
    final items = await ref.read(endpointsProvider).listNotifications();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      builder: (_) => _NotificationsSheet(items: items),
    );
    await ref.read(endpointsProvider).markAllNotificationsRead();
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(icon: const Icon(LucideIcons.bell), onPressed: _open),
        if (_unread > 0)
          Positioned(
            right: 4,
            top: 4,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: const BoxDecoration(
                color: Colors.red,
                shape: BoxShape.circle,
              ),
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              alignment: Alignment.center,
              child: Text(
                _unread > 9 ? '9+' : '$_unread',
                style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700),
              ),
            ),
          ),
      ],
    );
  }
}

class _NotificationsSheet extends StatelessWidget {
  const _NotificationsSheet({required this.items});
  final List<Notif> items;
  @override
  Widget build(BuildContext context) {
    // Only show unread (not-yet-viewed) notifications — once seen, they drop
    // off the list on the next open.
    final unread = items.where((n) => n.readAt == null).toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 6),
              child: Text('Notifications', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            if (unread.isEmpty)
              const EmptyState(icon: LucideIcons.inbox, title: "You're all caught up")
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: unread.length,
                  itemBuilder: (_, i) {
                    final n = unread[i];
                    return ListTile(
                      leading: const Icon(LucideIcons.dot, size: 24, color: AppColors.brand),
                      title: Text(
                        n.title,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                      ),
                      subtitle: n.body.isEmpty
                          ? null
                          : Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
