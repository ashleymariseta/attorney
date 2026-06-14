import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Mobile Bookings — collapses the web's weekly grid into a vertical list
/// grouped by day, with the same status pills and tap-to-detail.
class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  late Future<List<Consultation>> _load;
  DateTime _weekStart = _startOfWeek(DateTime.now());

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  static DateTime _startOfWeek(DateTime d) {
    final day = (d.weekday - 1) % 7; // Monday=0
    final s = DateTime(d.year, d.month, d.day).subtract(Duration(days: day));
    return s;
  }

  Future<List<Consultation>> _fetch() =>
      ref.read(endpointsProvider).listConsultations();

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  void _shiftWeek(int days) {
    setState(() {
      _weekStart = _weekStart.add(Duration(days: days));
    });
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    final weekEnd = _weekStart.add(const Duration(days: 6));
    final label =
        '${DateFormat('MMM d').format(_weekStart)} – ${DateFormat('MMM d, y').format(weekEnd)}';

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.menu),
          onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
        ),
        title: const Text('Bookings'),
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(bottom: BorderSide(color: AppColors.line)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(fontSize: 13, color: AppColors.muted),
                  ),
                ),
                IconButton(
                  onPressed: () => _shiftWeek(-7),
                  icon: const Icon(LucideIcons.chevronLeft),
                  tooltip: 'Previous week',
                ),
                TextButton(
                  onPressed: () => setState(() => _weekStart = _startOfWeek(DateTime.now())),
                  child: const Text('Today'),
                ),
                IconButton(
                  onPressed: () => _shiftWeek(7),
                  icon: const Icon(LucideIcons.chevronRight),
                  tooltip: 'Next week',
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              child: FutureBuilder<List<Consultation>>(
                future: _load,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
                    return ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        for (var i = 0; i < 5; i++) ...[
                          Skeleton(height: 60, width: double.infinity),
                          const SizedBox(height: 10),
                        ],
                      ],
                    );
                  }
                  if (snap.hasError) {
                    return ListView(
                      padding: const EdgeInsets.all(16),
                      children: [ErrorBanner(message: snap.error.toString())],
                    );
                  }
                  final all = snap.data ?? const <Consultation>[];
                  return _WeekList(
                    weekStart: _weekStart,
                    all: all,
                    isLawyer: isLawyer,
                    onTap: _openDetail,
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openDetail(Consultation c) async {
    final me = ref.read(authProvider).me;
    final isLawyer = me?.isLawyer ?? false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _BookingDetailSheet(
        consultation: c,
        isLawyer: isLawyer,
        onAction: (action) async {
          try {
            final ep = ref.read(endpointsProvider);
            if (action == 'confirm') await ep.confirmConsultation(c.id);
            if (action == 'cancel') await ep.cancelConsultation(c.id);
            if (action == 'complete') await ep.completeConsultation(c.id);
            if (mounted) {
              Navigator.of(context).pop();
              await _refresh();
            }
          } on ApiException catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context)
                  .showSnackBar(SnackBar(content: Text(e.message)));
            }
          }
        },
      ),
    );
  }
}

/// Teams-style weekly time grid. Mirrors frontend/app/(app)/bookings/page.tsx:
/// 7 day columns + a time gutter, hours 07:00–20:00, consultations
/// positioned absolutely by start time and length. Horizontally scrolls on
/// narrow screens so each column stays tap-friendly.
class _WeekList extends StatelessWidget {
  const _WeekList({
    required this.weekStart,
    required this.all,
    required this.isLawyer,
    required this.onTap,
  });
  final DateTime weekStart;
  final List<Consultation> all;
  final bool isLawyer;
  final void Function(Consultation c) onTap;

  static const _startHour = 7;
  static const _endHour = 20;
  static const _hourPx = 56.0;
  static const _gutterPx = 48.0;
  static const _minColPx = 110.0;

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final days = List<DateTime>.generate(7, (i) => weekStart.add(Duration(days: i)));
    final hours = List<int>.generate(_endHour - _startHour, (i) => _startHour + i);

    return LayoutBuilder(
      builder: (context, c) {
        // Fit columns to the screen when there's enough width; otherwise
        // fall back to a fixed min-width and let it scroll horizontally.
        final availableForCols = c.maxWidth - _gutterPx;
        final colPx = availableForCols / 7 >= _minColPx ? availableForCols / 7 : _minColPx;
        final gridWidth = _gutterPx + colPx * 7;
        final gridHeight = _hourPx * hours.length;

        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: gridWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Sticky-look day header strip (brand-dark like web)
                Container(
                  color: AppColors.brandDark,
                  child: Row(
                    children: [
                      SizedBox(width: _gutterPx),
                      for (final d in days)
                        Expanded(
                          child: _DayHeaderCell(
                            date: d,
                            isToday: _sameDay(d, today),
                          ),
                        ),
                    ],
                  ),
                ),
                // The grid body — scroll vertically.
                Expanded(
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    child: SizedBox(
                      height: gridHeight,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Time gutter
                          SizedBox(
                            width: _gutterPx,
                            child: Stack(
                              children: [
                                for (final h in hours)
                                  Positioned(
                                    top: (h - _startHour) * _hourPx - 6,
                                    right: 4,
                                    child: Text(
                                      '${h.toString().padLeft(2, '0')}:00',
                                      style: const TextStyle(fontSize: 10, color: AppColors.muted),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          // 7 day columns
                          for (final d in days)
                            Expanded(
                              child: _DayColumn(
                                date: d,
                                consultations: all
                                    .where((c) {
                                      final dt = DateTime.tryParse(c.scheduledTime);
                                      return dt != null && _sameDay(dt.toLocal(), d);
                                    })
                                    .toList(),
                                hours: hours,
                                hourPx: _hourPx,
                                startHour: _startHour,
                                isLawyer: isLawyer,
                                onTap: onTap,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DayHeaderCell extends StatelessWidget {
  const _DayHeaderCell({required this.date, required this.isToday});
  final DateTime date;
  final bool isToday;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: Color(0x14FFFFFF))),
      ),
      child: Column(
        children: [
          Text(
            DateFormat('EEE').format(date).toUpperCase(),
            style: TextStyle(
              fontSize: 10,
              letterSpacing: 0.5,
              color: Colors.white.withValues(alpha: 0.6),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: isToday ? Colors.white : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: Text(
              '${date.day}',
              style: TextStyle(
                color: isToday ? AppColors.brandDark : Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DayColumn extends StatelessWidget {
  const _DayColumn({
    required this.date,
    required this.consultations,
    required this.hours,
    required this.hourPx,
    required this.startHour,
    required this.isLawyer,
    required this.onTap,
  });
  final DateTime date;
  final List<Consultation> consultations;
  final List<int> hours;
  final double hourPx;
  final int startHour;
  final bool isLawyer;
  final void Function(Consultation c) onTap;

  ({Color bg, Color border, Color fg, TextDecoration deco}) _toneFor(String status) {
    final s = status.toLowerCase();
    if (s == 'awaiting_payment') {
      return (bg: const Color(0xFFFEF3C7), border: const Color(0xFFFBBF24), fg: const Color(0xFF92400E), deco: TextDecoration.none);
    }
    if (s == 'pending') {
      return (bg: const Color(0xFFFDE68A), border: const Color(0xFFD97706), fg: const Color(0xFF78350F), deco: TextDecoration.none);
    }
    if (s == 'confirmed') {
      return (bg: AppColors.brand, border: AppColors.brandDark, fg: Colors.white, deco: TextDecoration.none);
    }
    if (s == 'completed') {
      return (bg: const Color(0xFFE2E8F0), border: const Color(0xFF94A3B8), fg: const Color(0xFF334155), deco: TextDecoration.none);
    }
    if (s == 'cancelled') {
      return (bg: AppColors.line, border: AppColors.line, fg: AppColors.muted, deco: TextDecoration.lineThrough);
    }
    return (bg: AppColors.surface, border: AppColors.line, fg: AppColors.ink, deco: TextDecoration.none);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: AppColors.line)),
      ),
      child: Stack(
        children: [
          // Hour grid lines
          for (final h in hours)
            Positioned(
              top: (h - startHour) * hourPx,
              left: 0,
              right: 0,
              child: Container(
                height: hourPx,
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: Color(0x33C7CDD3))),
                ),
              ),
            ),
          // Consultation chips
          for (final c in consultations) ...[
            () {
              final dt = DateTime.tryParse(c.scheduledTime)?.toLocal();
              if (dt == null) return const SizedBox.shrink();
              final top = (dt.hour - startHour + dt.minute / 60) * hourPx;
              final height = (c.durationMinutes / 60 * hourPx).clamp(28.0, double.infinity);
              final tone = _toneFor(c.status);
              final timeStr = DateFormat('HH:mm').format(dt);
              return Positioned(
                top: top,
                left: 2,
                right: 2,
                height: height,
                child: GestureDetector(
                  onTap: () => onTap(c),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                    decoration: BoxDecoration(
                      color: tone.bg,
                      border: Border.all(color: tone.border),
                      borderRadius: BorderRadius.circular(6),
                      boxShadow: const [
                        BoxShadow(color: Color(0x14000000), blurRadius: 3, offset: Offset(0, 1)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          c.matterTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: tone.fg,
                            decoration: tone.deco,
                            height: 1.1,
                          ),
                        ),
                        if (height > 36)
                          Text(
                            '$timeStr · ${c.modeDisplay}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10,
                              color: tone.fg.withValues(alpha: 0.85),
                              decoration: tone.deco,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            }(),
          ],
        ],
      ),
    );
  }
}

class _BookingDetailSheet extends StatelessWidget {
  const _BookingDetailSheet({
    required this.consultation,
    required this.isLawyer,
    required this.onAction,
  });
  final Consultation consultation;
  final bool isLawyer;
  final Future<void> Function(String action) onAction;

  @override
  Widget build(BuildContext context) {
    final c = consultation;
    final dt = DateTime.tryParse(c.scheduledTime);
    final when = dt != null
        ? DateFormat('EEE, MMM d · HH:mm').format(dt.toLocal())
        : c.scheduledTime;
    final canEdit = c.status != 'cancelled' && c.status != 'completed';

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          c.matterTitle,
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.ink),
                        ),
                      ),
                      StatusPill(status: c.status, label: c.statusDisplay),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(when, style: const TextStyle(color: AppColors.muted)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
              child: Column(
                children: [
                  _Row(k: 'With', v: (isLawyer ? c.client?.fullName : c.lawyer?.fullName) ?? '—'),
                  _Row(k: 'Method', v: c.modeDisplay),
                  _Row(k: 'Duration', v: '${c.durationMinutes} min'),
                  _Row(k: 'Practice areas', v: c.practiceAreas.isEmpty ? '—' : c.practiceAreas.join(', ')),
                  _Row(k: 'Price', v: c.price != null ? '\$${c.price}' : 'TBD'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (isLawyer) ...[
                    if (c.status == 'pending')
                      FilledButton(
                        onPressed: () => onAction('confirm'),
                        child: const Text('Confirm booking'),
                      ),
                    if (c.status == 'awaiting_payment')
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          "Awaiting client's proof of payment.",
                          style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                        ),
                      ),
                    if (c.status == 'confirmed') ...[
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => onAction('complete'),
                        child: const Text('Mark completed'),
                      ),
                    ],
                    if (canEdit) ...[
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => onAction('cancel'),
                        child: const Text('Cancel'),
                      ),
                    ],
                  ] else ...[
                    if (c.status == 'awaiting_payment')
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          'Upload your proof of payment in the matter room to submit this booking.',
                          style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                        ),
                      ),
                    if (c.status == 'pending')
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.canvas,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          'Waiting for the lawyer to confirm.',
                          style: TextStyle(fontSize: 12, color: AppColors.muted),
                        ),
                      ),
                    if (c.status == 'confirmed')
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.brandLight,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          'Confirmed — see you then!',
                          style: TextStyle(fontSize: 12, color: AppColors.brandDark),
                        ),
                      ),
                    if (canEdit) ...[
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => onAction('cancel'),
                        child: const Text('Cancel booking'),
                      ),
                    ],
                  ],
                  if (c.channelId != null) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                        context.push(Routes.matter(c.matter));
                      },
                      icon: const Icon(LucideIcons.folder, size: 16),
                      label: const Text('Open matter room'),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.k, required this.v});
  final String k;
  final String v;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(k, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
          ),
          Expanded(
            child: Text(
              v,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13, color: AppColors.ink, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
