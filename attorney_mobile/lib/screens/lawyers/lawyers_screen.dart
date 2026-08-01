import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/endpoints.dart';
import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common.dart';

/// Public directory of lawyers (and firms). Mirrors
/// frontend/app/lawyers/page.tsx — search + filter chips + result cards.
/// Works for both anonymous and authed users; only clients see the
/// "add to my team" affordance.
class LawyersScreen extends ConsumerStatefulWidget {
  const LawyersScreen({super.key});

  @override
  ConsumerState<LawyersScreen> createState() => _LawyersScreenState();
}

class _LawyersScreenState extends ConsumerState<LawyersScreen> {
  final _searchCtrl = TextEditingController();

  late Future<_DirectoryData> _load;

  // tabs
  int _tab = 0; // 0 = lawyers, 1 = firms

  // filters
  String _q = '';
  final Set<String> _areas = {};
  final Set<String> _jurisdictions = {};
  final Set<String> _countries = {};
  int _minYears = 0;
  int? _firmFilter;
  String _sort = 'top';
  bool _showFilters = false;

  int? _adding;

  static const _years = <(String, int)>[('Any', 0), ('3+ yrs', 3), ('5+ yrs', 5), ('10+ yrs', 10)];

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<_DirectoryData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final results = await Future.wait([
      ep.listLawyers(),
      ep.listFirms(),
    ]);
    // Existing bookings drive the "Reschedule" affordance. Best-effort — anon
    // users (and any error) just get an empty list and the normal "Book" flow.
    List<Consultation> consults = const [];
    try {
      consults = await ep.listConsultations();
    } catch (_) {}
    return _DirectoryData(
      lawyers: results[0] as List<Lawyer>,
      firms: results[1] as List<Map<String, dynamic>>,
      consultations: consults,
    );
  }

  static const _deadStatuses = {'cancelled', 'completed', 'declined', 'expired'};

  Consultation? _activeBookingWith(int lawyerId, List<Consultation> all) {
    final matches = all
        .where((c) => c.lawyer?.id == lawyerId && !_deadStatuses.contains(c.status))
        .toList()
      ..sort((a, b) => b.scheduledTime.compareTo(a.scheduledTime));
    return matches.isEmpty ? null : matches.first;
  }

  Future<void> _reschedule(Consultation c) async {
    final current = DateTime.tryParse(c.scheduledTime) ?? DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null || !mounted) return;
    final when = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    try {
      await ref.read(endpointsProvider).rescheduleConsultation(c.id, when.toIso8601String());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Consultation rescheduled — your lawyer will re-confirm.')),
      );
      await _refresh();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _refresh() async {
    final fresh = await _fetch();
    if (mounted) setState(() => _load = Future.value(fresh));
  }

  Future<void> _addToTeam(Lawyer l) async {
    setState(() => _adding = l.id);
    try {
      await ref.read(endpointsProvider).addRetainer(l.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${l.fullName} added to your legal team.')),
      );
      await _refresh();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _adding = null);
    }
  }

  int get _activeFilters =>
      _areas.length + _jurisdictions.length + _countries.length + (_minYears > 0 ? 1 : 0) + (_firmFilter != null ? 1 : 0);

  void _clearAll() {
    setState(() {
      _areas.clear();
      _jurisdictions.clear();
      _countries.clear();
      _minYears = 0;
      _firmFilter = null;
    });
  }

  List<Lawyer> _applyLawyerFilters(List<Lawyer> src) {
    final term = _q.trim().toLowerCase();
    final out = src.where((l) {
      if (term.isNotEmpty) {
        final hay = [
          l.fullName,
          ...(l.profile?.practiceAreas ?? const []),
          ...(l.profile?.jurisdictions ?? const []),
          countryNames[l.country] ?? l.country,
        ].join(' ').toLowerCase();
        if (!hay.contains(term)) return false;
      }
      if (_minYears > 0 && (l.profile?.yearsExperience ?? 0) < _minYears) return false;
      if (_areas.isNotEmpty && !(l.profile?.practiceAreas ?? const []).any(_areas.contains)) {
        return false;
      }
      if (_jurisdictions.isNotEmpty &&
          !(l.profile?.jurisdictions ?? const []).any(_jurisdictions.contains)) {
        return false;
      }
      if (_countries.isNotEmpty && !_countries.contains(l.country)) return false;
      return true;
    }).toList();
    out.sort((a, b) {
      if (_sort == 'experience') {
        return (b.profile?.yearsExperience ?? 0).compareTo(a.profile?.yearsExperience ?? 0);
      }
      final rd = (b.avgRating ?? 0).compareTo(a.avgRating ?? 0);
      if (rd != 0) return rd;
      return b.reviewCount.compareTo(a.reviewCount);
    });
    return out;
  }

  List<Map<String, dynamic>> _applyFirmFilters(List<Map<String, dynamic>> src) {
    final term = _q.trim().toLowerCase();
    return src.where((f) {
      final name = (f['name'] as String? ?? '').toLowerCase();
      if (term.isNotEmpty && !name.contains(term)) return false;
      final areas = List<String>.from(f['practice_areas'] ?? const []);
      if (_areas.isNotEmpty && !areas.any(_areas.contains)) return false;
      final juris = List<String>.from(f['jurisdictions'] ?? const []);
      if (_jurisdictions.isNotEmpty && !juris.any(_jurisdictions.contains)) return false;
      final country = f['country'] as String? ?? '';
      if (_countries.isNotEmpty && !_countries.contains(country)) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isAuthed = ref.watch(authProvider).status == AuthStatus.authed;
    final isClient = me?.isClient ?? false;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        leading: isAuthed
            ? IconButton(
                icon: const Icon(LucideIcons.menu),
                onPressed: () => ref.read(appShellScaffoldKeyProvider).currentState?.openDrawer(),
              )
            : IconButton(
                icon: const Icon(LucideIcons.chevronLeft),
                onPressed: () => context.canPop() ? context.pop() : context.go(Routes.landing),
              ),
        title: const Text('Find a lawyer'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_DirectoryData>(
          future: _load,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Skeleton(height: 56, width: double.infinity),
                  const SizedBox(height: 12),
                  for (var i = 0; i < 4; i++) ...[
                    Skeleton(height: 120, width: double.infinity),
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
            final data = snap.data!;
            final allAreas = <String>{
              for (final l in data.lawyers) ...(l.profile?.practiceAreas ?? const []),
              for (final f in data.firms) ...List<String>.from(f['practice_areas'] ?? const []),
            }.toList()..sort();
            final allJuris = <String>{
              for (final l in data.lawyers) ...(l.profile?.jurisdictions ?? const []),
              for (final f in data.firms) ...List<String>.from(f['jurisdictions'] ?? const []),
            }.toList()..sort();
            final allCountries = <String>{
              for (final l in data.lawyers)
                if (l.country.isNotEmpty) l.country,
              for (final f in data.firms)
                if ((f['country'] as String? ?? '').isNotEmpty) f['country'] as String,
            }.toList()..sort();

            final filteredLawyers = _applyLawyerFilters(data.lawyers);
            final filteredFirms = _applyFirmFilters(data.firms);

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _searchBar(),
                const SizedBox(height: 12),
                _tabsBar(filteredLawyers.length, filteredFirms.length),
                if (_showFilters) ...[
                  const SizedBox(height: 12),
                  _filterPanel(allAreas, allJuris, allCountries, data.firms),
                ],
                const SizedBox(height: 12),
                Text(
                  _tab == 0
                      ? '${filteredLawyers.length} lawyer${filteredLawyers.length == 1 ? '' : 's'}'
                      : '${filteredFirms.length} firm${filteredFirms.length == 1 ? '' : 's'}',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                if (_tab == 0) ...[
                  if (filteredLawyers.isEmpty)
                    EmptyState(
                      icon: LucideIcons.searchX,
                      title: 'No lawyers match your filters',
                      subtitle: 'Try clearing a filter or searching by a different practice area.',
                      action: _activeFilters > 0
                          ? OutlinedButton(onPressed: _clearAll, child: const Text('Clear filters'))
                          : null,
                    )
                  else
                    for (final l in filteredLawyers)
                      _LawyerCard(
                        lawyer: l,
                        isClient: isClient,
                        adding: _adding == l.id,
                        onAdd: () => _addToTeam(l),
                        existingBooking: _activeBookingWith(l.id, data.consultations),
                        onReschedule: (c) => _reschedule(c),
                        onBook: () {
                          if (isAuthed) {
                            context.go(Routes.book(l.id));
                          } else {
                            context.go(Routes.login);
                          }
                        },
                      ),
                ] else ...[
                  if (filteredFirms.isEmpty)
                    const EmptyState(
                      icon: LucideIcons.building2,
                      title: 'No firms match your filters',
                    )
                  else
                    for (final f in filteredFirms)
                      _FirmCard(
                        data: f,
                        onView: () {
                          setState(() {
                            _firmFilter = f['id'] as int;
                            _tab = 0;
                          });
                        },
                      ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _searchBar() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          const Icon(LucideIcons.search, size: 18, color: AppColors.muted),
          const SizedBox(width: 6),
          Expanded(
            child: TextField(
              controller: _searchCtrl,
              decoration: const InputDecoration(
                hintText: 'Search by name, practice area, or city…',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                isCollapsed: true,
                contentPadding: EdgeInsets.symmetric(vertical: 14),
              ),
              onChanged: (v) => setState(() => _q = v),
            ),
          ),
          TextButton.icon(
            onPressed: () => setState(() => _showFilters = !_showFilters),
            icon: const Icon(LucideIcons.slidersHorizontal, size: 16),
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Filters'),
                if (_activeFilters > 0) ...[
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: const BoxDecoration(
                      color: AppColors.brandDark,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '$_activeFilters',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            style: TextButton.styleFrom(
              foregroundColor: _showFilters ? AppColors.brandDark : AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }

  Widget _tabsBar(int lawyerCount, int firmCount) {
    Widget btn({required int i, required IconData icon, required String label, required int count}) {
      final active = _tab == i;
      return Expanded(
        child: InkWell(
          onTap: () => setState(() => _tab = i),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: active ? AppColors.brandDark : Colors.transparent,
                  width: 2,
                ),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 14, color: active ? AppColors.brandDark : AppColors.muted),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    color: active ? AppColors.brandDark : AppColors.muted,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: active ? AppColors.brandDark : AppColors.line,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      color: active ? Colors.white : AppColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        children: [
          btn(i: 0, icon: LucideIcons.graduationCap, label: 'Lawyers', count: lawyerCount),
          btn(i: 1, icon: LucideIcons.building2, label: 'Firms', count: firmCount),
        ],
      ),
    );
  }

  Widget _filterPanel(
    List<String> allAreas,
    List<String> allJuris,
    List<String> allCountries,
    List<Map<String, dynamic>> firms,
  ) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _filterGroup(
            icon: LucideIcons.briefcase,
            title: 'Practice area',
            empty: 'No areas yet.',
            children: [
              for (final a in allAreas)
                _chip(label: a, active: _areas.contains(a), onTap: () {
                  setState(() => _areas.contains(a) ? _areas.remove(a) : _areas.add(a));
                }),
            ],
          ),
          const SizedBox(height: 14),
          _filterGroup(
            icon: LucideIcons.globe,
            title: 'Country',
            empty: 'No countries yet.',
            children: [
              for (final c in allCountries)
                _chip(
                  label: '${flagForCountry(c)} ${countryNames[c] ?? c}',
                  active: _countries.contains(c),
                  onTap: () {
                    setState(() => _countries.contains(c) ? _countries.remove(c) : _countries.add(c));
                  },
                ),
            ],
          ),
          const SizedBox(height: 14),
          _filterGroup(
            icon: LucideIcons.mapPin,
            title: 'Jurisdictions',
            empty: 'No jurisdictions yet.',
            children: [
              for (final j in allJuris)
                _chip(label: j, active: _jurisdictions.contains(j), onTap: () {
                  setState(() => _jurisdictions.contains(j) ? _jurisdictions.remove(j) : _jurisdictions.add(j));
                }),
            ],
          ),
          const SizedBox(height: 14),
          _filterGroup(
            icon: LucideIcons.graduationCap,
            title: 'Experience',
            children: [
              for (final y in _years)
                _chip(label: y.$1, active: _minYears == y.$2, onTap: () {
                  setState(() => _minYears = y.$2);
                }),
            ],
          ),
          if (firms.isNotEmpty) ...[
            const SizedBox(height: 14),
            _filterGroup(
              icon: LucideIcons.building2,
              title: 'Firm',
              children: [
                for (final f in firms)
                  _chip(
                    label: f['name'] as String? ?? '',
                    active: _firmFilter == f['id'],
                    onTap: () {
                      setState(() => _firmFilter = _firmFilter == f['id'] ? null : f['id'] as int);
                    },
                  ),
              ],
            ),
          ],
          const Divider(height: 24),
          Row(
            children: [
              const Text('SORT',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.muted, letterSpacing: 0.6)),
              const SizedBox(width: 8),
              DropdownButton<String>(
                value: _sort,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(value: 'top', child: Text('Top rated')),
                  DropdownMenuItem(value: 'experience', child: Text('Most experience')),
                ],
                onChanged: (v) => setState(() => _sort = v ?? 'top'),
              ),
              const Spacer(),
              if (_activeFilters > 0)
                TextButton.icon(
                  onPressed: _clearAll,
                  icon: const Icon(LucideIcons.x, size: 14),
                  label: const Text('Clear all'),
                  style: TextButton.styleFrom(foregroundColor: AppColors.muted),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _filterGroup({
    required IconData icon,
    required String title,
    required List<Widget> children,
    String? empty,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 13, color: AppColors.muted),
            const SizedBox(width: 6),
            Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: AppColors.muted,
                letterSpacing: 0.6,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (children.isEmpty && empty != null)
          Text(empty, style: const TextStyle(fontSize: 12, color: AppColors.muted))
        else
          Wrap(spacing: 6, runSpacing: 6, children: children),
      ],
    );
  }

  Widget _chip({required String label, required bool active, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.brandDark : AppColors.surface,
          border: Border.all(color: active ? AppColors.brandDark : AppColors.line),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : AppColors.muted,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _DirectoryData {
  _DirectoryData({required this.lawyers, required this.firms, required this.consultations});
  final List<Lawyer> lawyers;
  final List<Map<String, dynamic>> firms;
  final List<Consultation> consultations;
}

class _LawyerCard extends StatelessWidget {
  const _LawyerCard({
    required this.lawyer,
    required this.isClient,
    required this.adding,
    required this.onAdd,
    required this.onBook,
    this.existingBooking,
    this.onReschedule,
  });
  final Lawyer lawyer;
  final bool isClient;
  final bool adding;
  final VoidCallback onAdd;
  final VoidCallback onBook;
  final Consultation? existingBooking;
  final void Function(Consultation)? onReschedule;

  @override
  Widget build(BuildContext context) {
    final p = lawyer.profile;
    final juris = (p?.jurisdictions ?? const <String>[]).join(', ');
    final ratingLabel = lawyer.avgRating != null
        ? '${lawyer.avgRating!.toStringAsFixed(1)} (${lawyer.reviewCount})'
        : 'No reviews yet';
    final initials = lawyer.fullName.isEmpty
        ? '?'
        : lawyer.fullName.trim().split(RegExp(r'\s+')).take(2).map((p) => p.isEmpty ? '' : p[0]).join();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      clipBehavior: Clip.hardEdge,
      child: Stack(
        children: [
          const DecoIcon(icon: LucideIcons.scale, size: 90),
          Padding(
            padding: const EdgeInsets.all(14),
            child: _LawyerCardBody(
              lawyer: lawyer,
              juris: juris,
              ratingLabel: ratingLabel,
              initials: initials,
              isClient: isClient,
              adding: adding,
              onAdd: onAdd,
              onBook: onBook,
              existingBooking: existingBooking,
              onReschedule: onReschedule,
            ),
          ),
        ],
      ),
    );
  }
}

class _LawyerCardBody extends StatelessWidget {
  const _LawyerCardBody({
    required this.lawyer,
    required this.juris,
    required this.ratingLabel,
    required this.initials,
    required this.isClient,
    required this.adding,
    required this.onAdd,
    required this.onBook,
    this.existingBooking,
    this.onReschedule,
  });
  final Lawyer lawyer;
  final String juris;
  final String ratingLabel;
  final String initials;
  final bool isClient;
  final bool adding;
  final VoidCallback onAdd;
  final VoidCallback onBook;
  final Consultation? existingBooking;
  final void Function(Consultation)? onReschedule;

  @override
  Widget build(BuildContext context) {
    final p = lawyer.profile;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
          Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: AppColors.brandLight,
                    foregroundImage: (lawyer.avatarUrl != null &&
                            lawyer.avatarUrl!.isNotEmpty)
                        ? NetworkImage(lawyer.avatarUrl!)
                        : null,
                    child: Text(
                      initials.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.brandDark,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  if (lawyer.isVerified)
                    const Positioned(
                      right: -2,
                      bottom: -2,
                      child: CircleAvatar(
                        radius: 8,
                        backgroundColor: Colors.white,
                        child: Icon(LucideIcons.badgeCheck, size: 14, color: AppColors.brand),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      lawyer.fullName,
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink, fontSize: 14),
                    ),
                    Text(
                      '${p?.yearsExperience ?? 0} yrs · ${juris.isEmpty ? '—' : juris}',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    _StarRow(rating: lawyer.avgRating, label: ratingLabel),
                  ],
                ),
              ),
              if (lawyer.country.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.cardTint,
                    border: Border.all(color: AppColors.line),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(flagForCountry(lawyer.country), style: const TextStyle(fontSize: 14)),
                      const SizedBox(width: 4),
                      Text(
                        lawyer.country,
                        style: const TextStyle(fontSize: 10, color: AppColors.ink, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          if ((p?.bio ?? '').isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              p!.bio,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: AppColors.ink),
            ),
          ],
          if ((p?.practiceAreas ?? const []).isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final a in p!.practiceAreas.take(3))
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.canvas,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(a, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => context.go(Routes.lawyerProfile(lawyer.id)),
                  child: const Text('View profile'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: (existingBooking != null && onReschedule != null)
                    ? FilledButton.icon(
                        onPressed: () => onReschedule!(existingBooking!),
                        icon: const Icon(LucideIcons.calendarClock, size: 14),
                        label: const Text('Reschedule'),
                      )
                    : FilledButton.icon(
                        onPressed: onBook,
                        icon: const Icon(LucideIcons.calendar, size: 14),
                        label: const Text('Book'),
                      ),
              ),
              if (isClient) ...[
                const SizedBox(width: 8),
                if (lawyer.onRetainer)
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFECFDF5),
                      border: Border.all(color: const Color(0xFFA7F3D0)),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Icon(LucideIcons.shieldCheck, size: 16, color: Color(0xFF047857)),
                  )
                else
                  IconButton(
                    onPressed: adding ? null : onAdd,
                    tooltip: 'Add to my legal team',
                    icon: adding
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(LucideIcons.userPlus, size: 18, color: AppColors.brandDark),
                  ),
              ],
            ],
          ),
        ],
    );
  }
}

class _FirmCard extends StatelessWidget {
  const _FirmCard({required this.data, required this.onView});
  final Map<String, dynamic> data;
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    final name = data['name'] as String? ?? '';
    final country = data['country'] as String? ?? '';
    final lawyerCount = (data['lawyer_count'] as num?)?.toInt() ?? 0;
    final juris = List<String>.from(data['jurisdictions'] ?? const []);
    final areas = List<String>.from(data['practice_areas'] ?? const []);
    final verified = data['verified'] == true;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.cardTint,
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(16),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 26,
                backgroundColor: AppColors.brandDark,
                child: Icon(LucideIcons.building2, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            name,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (verified) ...[
                          const SizedBox(width: 4),
                          const Icon(LucideIcons.badgeCheck, size: 14, color: AppColors.brand),
                        ],
                      ],
                    ),
                    Text(
                      '$lawyerCount lawyer${lawyerCount == 1 ? '' : 's'} · ${juris.isEmpty ? '—' : juris.join(', ')}',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (country.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.cardTint,
                    border: Border.all(color: AppColors.line),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${flagForCountry(country)} $country',
                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.ink),
                  ),
                ),
            ],
          ),
          if (areas.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final a in areas.take(4))
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.canvas,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(a, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton(onPressed: onView, child: const Text('View lawyers')),
          ),
        ],
      ),
    );
  }
}

class _StarRow extends StatelessWidget {
  const _StarRow({required this.rating, required this.label});
  final double? rating;
  final String label;

  @override
  Widget build(BuildContext context) {
    final value = rating ?? 0;
    return Row(
      children: [
        for (var i = 0; i < 5; i++)
          Icon(
            LucideIcons.star,
            size: 12,
            color: i < value.round() ? AppColors.brand : AppColors.line,
          ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
      ],
    );
  }
}
