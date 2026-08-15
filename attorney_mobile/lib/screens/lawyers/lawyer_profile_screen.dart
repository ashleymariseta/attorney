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

/// Public profile for a single lawyer. Mirrors
/// frontend/app/lawyers/[id]/page.tsx — header card + practice block +
/// reviews + booking CTA (with "add to team" for clients).
class LawyerProfileScreen extends ConsumerStatefulWidget {
  const LawyerProfileScreen({super.key, required this.lawyerId});
  final int lawyerId;

  @override
  ConsumerState<LawyerProfileScreen> createState() => _LawyerProfileScreenState();
}

class _LawyerProfileScreenState extends ConsumerState<LawyerProfileScreen> {
  late Future<_ProfileData> _load;
  bool _addingTeam = false;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  Future<_ProfileData> _fetch() async {
    final ep = ref.read(endpointsProvider);
    final lawyer = await ep.getLawyer(widget.lawyerId);
    List<Map<String, dynamic>> reviews = const [];
    try {
      reviews = await ep.listLawyerReviews(widget.lawyerId);
    } catch (_) {
      // reviews are optional — keep going if endpoint fails.
    }
    return _ProfileData(lawyer: lawyer, reviews: reviews);
  }

  Future<void> _addToTeam(Lawyer lawyer) async {
    setState(() => _addingTeam = true);
    try {
      await ref.read(endpointsProvider).addRetainer(lawyer.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${lawyer.fullName} added to your legal team.')),
      );
      // refresh on_retainer flag
      final fresh = await _fetch();
      if (mounted) setState(() => _load = Future.value(fresh));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _addingTeam = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).me;
    final isAuthed = ref.watch(authProvider).status == AuthStatus.authed;
    final isClient = me?.isClient ?? false;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go(Routes.lawyersPublic),
        ),
        title: const Text('Lawyer'),
      ),
      body: FutureBuilder<_ProfileData>(
        future: _load,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Skeleton(height: 140, width: double.infinity),
                const SizedBox(height: 16),
                Skeleton(height: 80, width: double.infinity),
                const SizedBox(height: 12),
                Skeleton(height: 80, width: double.infinity),
              ],
            );
          }
          if (snap.hasError) {
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ErrorBanner(message: snap.error.toString()),
                const SizedBox(height: 12),
                Center(
                  child: OutlinedButton.icon(
                    icon: const Icon(LucideIcons.chevronLeft, size: 14),
                    label: const Text('Back to directory'),
                    onPressed: () => context.go(Routes.lawyersPublic),
                  ),
                ),
              ],
            );
          }
          final data = snap.data!;
          final lawyer = data.lawyer;
          final p = lawyer.profile;
          final initials = lawyer.fullName.isEmpty
              ? '?'
              : lawyer.fullName
                  .trim()
                  .split(RegExp(r'\s+'))
                  .take(2)
                  .map((p) => p.isEmpty ? '' : p[0])
                  .join();
          final ratingLabel = lawyer.avgRating != null
              ? '${lawyer.avgRating!.toStringAsFixed(1)} · ${lawyer.reviewCount} review${lawyer.reviewCount == 1 ? '' : 's'}'
              : 'No reviews yet';

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Header card
              Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [AppColors.brandLight, AppColors.surface],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(20),
                ),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Stack(
                          clipBehavior: Clip.none,
                          children: [
                            CircleAvatar(
                              radius: 36,
                              backgroundColor: AppColors.brandDark,
                              foregroundImage: (lawyer.avatarUrl != null &&
                                      lawyer.avatarUrl!.isNotEmpty)
                                  ? NetworkImage(lawyer.avatarUrl!)
                                  : null,
                              child: Text(
                                initials.toUpperCase(),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 22,
                                ),
                              ),
                            ),
                            if (lawyer.isVerified)
                              const Positioned(
                                bottom: -2,
                                right: -2,
                                child: CircleAvatar(
                                  radius: 11,
                                  backgroundColor: Colors.white,
                                  child: Icon(LucideIcons.badgeCheck, size: 18, color: AppColors.brand),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                lawyer.fullName,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.ink,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${p?.yearsExperience ?? 0} years of practice',
                                style: const TextStyle(fontSize: 12, color: AppColors.muted),
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
                                Text(flagForCountry(lawyer.country),
                                    style: const TextStyle(fontSize: 14)),
                                const SizedBox(width: 4),
                                Text(
                                  countryNames[lawyer.country] ?? lawyer.country,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (lawyer.hourlyRate != null && lawyer.hourlyRate!.isNotEmpty)
                      Text(
                        '\$${lawyer.hourlyRate}/hr',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.brandDark,
                        ),
                      )
                    else
                      const Text(
                        'Fees discussed at consultation',
                        style: TextStyle(fontSize: 11, color: AppColors.muted),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Book CTA card
              Container(
                decoration: BoxDecoration(
                  color: AppColors.cardTint,
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(16),
                ),
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'READY TO START?',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.muted,
                        letterSpacing: 0.6,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Tell ${lawyer.firstName} what you need help with. They’ll confirm and meet you in your secure matter room.',
                      style: const TextStyle(fontSize: 12, color: AppColors.ink),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: () {
                        if (isAuthed) {
                          context.go(Routes.book(lawyer.id));
                        } else {
                          context.go(Routes.login);
                        }
                      },
                      icon: const Icon(LucideIcons.calendar, size: 16),
                      label: const Text('Book consultation'),
                    ),
                    if (isClient) ...[
                      const SizedBox(height: 8),
                      if (lawyer.onRetainer)
                        Container(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: const Color(0xFFECFDF5),
                            border: Border.all(color: const Color(0xFFA7F3D0)),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Text(
                            '✓ On your legal team',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF047857),
                              fontSize: 13,
                            ),
                          ),
                        )
                      else
                        OutlinedButton.icon(
                          onPressed: _addingTeam ? null : () => _addToTeam(lawyer),
                          icon: const Icon(LucideIcons.userPlus, size: 16),
                          label: Text(_addingTeam ? 'Adding…' : 'Add to my legal team'),
                        ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // About
              if ((p?.bio ?? '').isNotEmpty) ...[
                _Card(
                  title: 'About',
                  child: Text(
                    p!.bio,
                    style: const TextStyle(fontSize: 13, color: AppColors.ink, height: 1.4),
                  ),
                ),
                const SizedBox(height: 12),
              ],

              // Practice
              if (p != null)
                _Card(
                  title: 'Practice',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Detail(
                        icon: LucideIcons.briefcase,
                        label: 'Practice areas',
                        child: p.practiceAreas.isEmpty
                            ? const Text('—', style: TextStyle(color: AppColors.muted))
                            : Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final a in p.practiceAreas) _badge(a),
                                ],
                              ),
                      ),
                      const SizedBox(height: 12),
                      _Detail(
                        icon: LucideIcons.mapPin,
                        label: 'Jurisdictions',
                        child: p.jurisdictions.isEmpty
                            ? const Text('—', style: TextStyle(color: AppColors.muted))
                            : Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final j in p.jurisdictions) _badge(j),
                                ],
                              ),
                      ),
                      const SizedBox(height: 12),
                      _Detail(
                        icon: LucideIcons.globe,
                        label: 'Languages',
                        child: Text(
                          p.languages.isEmpty ? '—' : p.languages.join(', '),
                          style: const TextStyle(fontSize: 13, color: AppColors.ink),
                        ),
                      ),
                      const SizedBox(height: 12),
                      _Detail(
                        icon: LucideIcons.graduationCap,
                        label: 'Bar number',
                        child: Text(
                          p.barNumber.isEmpty ? '—' : p.barNumber,
                          style: const TextStyle(fontSize: 13, color: AppColors.ink),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),

              // Reviews
              _Card(
                title: 'Reviews',
                child: data.reviews.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          'No reviews yet — be the first to work with them.',
                          style: TextStyle(fontSize: 12, color: AppColors.muted),
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final r in data.reviews.take(6)) _ReviewTile(review: r),
                        ],
                      ),
              ),
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }

  Widget _badge(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.canvas,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          text,
          style: const TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w600),
        ),
      );
}

class _ProfileData {
  _ProfileData({required this.lawyer, required this.reviews});
  final Lawyer lawyer;
  final List<Map<String, dynamic>> reviews;
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
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
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.icon, required this.label, required this.child});
  final IconData icon;
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 12, color: AppColors.muted),
            const SizedBox(width: 6),
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: AppColors.muted,
                letterSpacing: 0.6,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        child,
      ],
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review});
  final Map<String, dynamic> review;

  @override
  Widget build(BuildContext context) {
    final author = review['author_detail'] as Map<String, dynamic>?;
    final name = author?['full_name'] as String? ?? 'Anonymous';
    final initial = name.isEmpty ? '?' : name[0].toUpperCase();
    final rating = (review['rating'] as num?)?.toDouble() ?? 0;
    final body = review['body'] as String? ?? '';
    final createdAt = review['created_at'] as String? ?? '';
    final when = DateTime.tryParse(createdAt);
    final whenLabel = when != null ? DateFormat('d MMM y').format(when.toLocal()) : '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: AppColors.brandLight,
                child: Text(
                  initial,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandDark,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    if (whenLabel.isNotEmpty)
                      Text(whenLabel, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ],
                ),
              ),
              _StarRow(rating: rating, label: ''),
            ],
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(body, style: const TextStyle(fontSize: 12, color: AppColors.ink, height: 1.4)),
          ],
          const SizedBox(height: 4),
          const Divider(height: 12),
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
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 5; i++)
          Icon(
            LucideIcons.star,
            size: 13,
            color: i < value.round() ? AppColors.brand : AppColors.line,
          ),
        if (label.isNotEmpty) ...[
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
        ],
      ],
    );
  }
}
