import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/models.dart';
import '../../router.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../auth/lawyer_verification_screen.dart';

/// Mobile-first chrome that wraps every auth-gated route. Provides:
///  * an AppBar with the matter title fallback + notification bell action
///  * a Drawer with the full nav (used for secondary destinations)
///  * a BottomNavigationBar with the top 5 destinations (role-aware)
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authProvider).me;
    // Anon visitors browsing public routes (e.g. /lawyers from the landing
    // page) get no shell chrome — the screen handles its own AppBar.
    if (me == null) return child;
    // Lawyers must submit their practising credentials before using the app —
    // a blocking gate, same as the web VerificationGateModal.
    if (me.lawyerNeedsVerification) return const LawyerVerificationScreen();
    final isLawyer = me.isLawyer;
    final isClient = me.isClient;

    final tabs = <_Tab>[
      _Tab(label: 'Home', icon: LucideIcons.home, route: Routes.dashboard),
      if (isClient)
        _Tab(label: 'My team', icon: LucideIcons.graduationCap, route: Routes.myLawyers),
      if (isLawyer)
        _Tab(label: 'Clients', icon: LucideIcons.users2, route: Routes.clients),
      _Tab(label: 'Bookings', icon: LucideIcons.calendar, route: Routes.bookings),
      _Tab(label: 'Matters', icon: LucideIcons.folder, route: Routes.matters),
      _Tab(label: 'Transactions', icon: LucideIcons.wallet, route: Routes.transactions),
    ].take(5).toList();

    final currentIndex = tabs.indexWhere((t) => location == t.route || location.startsWith('${t.route}/'));

    // Bottom nav hides on the matter detail route (/matters/123) — the
    // matter screen acts as a focused room with its own back arrow.
    final isMatterRoom = RegExp(r'^/matters/\d').hasMatch(location);

    return Scaffold(
      key: ref.watch(appShellScaffoldKeyProvider),
      backgroundColor: AppColors.canvas,
      drawer: _AppDrawer(me: me, location: location),
      body: child,
      bottomNavigationBar: isMatterRoom
          ? null
          : BottomNavigationBar(
              currentIndex: currentIndex < 0 ? 0 : currentIndex,
              onTap: (i) => context.go(tabs[i].route),
              items: [
                for (final t in tabs)
                  BottomNavigationBarItem(icon: Icon(t.icon), label: t.label),
              ],
            ),
    );
  }
}

class _Tab {
  _Tab({required this.label, required this.icon, required this.route});
  final String label;
  final IconData icon;
  final String route;
}

class _AppDrawer extends ConsumerStatefulWidget {
  const _AppDrawer({required this.me, required this.location});
  final dynamic me;
  final String location;

  @override
  ConsumerState<_AppDrawer> createState() => _AppDrawerState();
}

class _AppDrawerState extends ConsumerState<_AppDrawer> {
  final _searchCtrl = TextEditingController();
  String _query = '';
  Future<List<Matter>>? _mattersFuture;

  @override
  void initState() {
    super.initState();
    // Lazy-load matters when the drawer first mounts. The widget remounts
    // each time the drawer opens, so this acts as a per-open refresh.
    _mattersFuture = ref.read(endpointsProvider).listMatters();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    final isLawyer = me?.isLawyer ?? false;
    final isAdmin = me?.role == 'admin';
    void go(String r) {
      Navigator.of(context).pop();
      context.go(r);
    }
    // Matters use push() so the back arrow returns to the screen the user
    // was on when they opened the drawer (web parity).
    void pushMatter(int id) {
      Navigator.of(context).pop();
      context.push(Routes.matter(id));
    }

    return Drawer(
      backgroundColor: AppColors.surface,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Brand + user — fixed header.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Attorney',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    me?.fullName ?? '',
                    style: const TextStyle(fontSize: 13, color: AppColors.ink),
                  ),
                  Text(
                    me?.email ?? '',
                    style: const TextStyle(fontSize: 11, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            // Drawer holds only Settings + the searchable matters list —
            // every other destination lives in the bottom nav.
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _DrawerTile(
                    icon: LucideIcons.settings,
                    label: isLawyer ? 'Settings & Rate' : 'Settings & KYC',
                    onTap: () => go(Routes.settings),
                  ),
                  if (isAdmin)
                    _DrawerTile(icon: LucideIcons.key, label: 'LLM usage (admin)', onTap: () => go(Routes.adminLlmUsage)),
                  _MattersSection(
                    future: _mattersFuture,
                    query: _query,
                    searchCtrl: _searchCtrl,
                    onQueryChanged: (v) => setState(() => _query = v),
                    onClearQuery: () => setState(() {
                      _searchCtrl.clear();
                      _query = '';
                    }),
                    onTapMatter: (m) => pushMatter(m.id),
                    onTapAll: () => go(Routes.matters),
                  ),
                ],
              ),
            ),

            // Log out — pinned footer.
            const Divider(height: 1),
            _DrawerTile(
              icon: LucideIcons.logOut,
              label: 'Log out',
              onTap: () async {
                Navigator.of(context).pop();
                await ref.read(authProvider.notifier).logout();
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _MattersSection extends StatelessWidget {
  const _MattersSection({
    required this.future,
    required this.query,
    required this.searchCtrl,
    required this.onQueryChanged,
    required this.onClearQuery,
    required this.onTapMatter,
    required this.onTapAll,
  });
  final Future<List<Matter>>? future;
  final String query;
  final TextEditingController searchCtrl;
  final ValueChanged<String> onQueryChanged;
  final VoidCallback onClearQuery;
  final ValueChanged<Matter> onTapMatter;
  final VoidCallback onTapAll;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Matter>>(
      future: future,
      builder: (context, snap) {
        final matters = snap.data ?? const <Matter>[];
        final q = query.trim().toLowerCase();
        final visible = q.isEmpty
            ? matters
            : matters.where((m) => m.title.toLowerCase().contains(q)).toList();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  const Text(
                    'MATTERS',
                    style: TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w700, letterSpacing: 0.6),
                  ),
                  if (matters.length > 3) ...[
                    const SizedBox(width: 6),
                    Text('${matters.length}', style: const TextStyle(fontSize: 10, color: AppColors.muted)),
                  ],
                  const Spacer(),
                  InkWell(
                    onTap: onTapAll,
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Text('See all', style: TextStyle(fontSize: 11, color: AppColors.brand, fontWeight: FontWeight.w600)),
                    ),
                  ),
                ],
              ),
            ),
            if (matters.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: query.isEmpty ? AppColors.line : AppColors.brand),
                    borderRadius: BorderRadius.circular(8),
                    color: AppColors.surface,
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Row(
                    children: [
                      const Icon(LucideIcons.search, size: 14, color: AppColors.muted),
                      const SizedBox(width: 6),
                      Expanded(
                        child: TextField(
                          controller: searchCtrl,
                          onChanged: onQueryChanged,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: InputBorder.none,
                            hintText: 'Search matters…',
                            hintStyle: TextStyle(fontSize: 12, color: AppColors.muted),
                          ),
                          style: const TextStyle(fontSize: 12, color: AppColors.ink),
                        ),
                      ),
                      if (query.isNotEmpty)
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
                          iconSize: 14,
                          icon: const Icon(LucideIcons.x, color: AppColors.muted),
                          onPressed: onClearQuery,
                        ),
                    ],
                  ),
                ),
              ),
            if (snap.connectionState == ConnectionState.waiting)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text('Loading…', style: TextStyle(fontSize: 12, color: AppColors.muted)),
              )
            else if (matters.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text('No matters yet.', style: TextStyle(fontSize: 12, color: AppColors.muted)),
              )
            else if (visible.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Column(
                  children: [
                    const Icon(LucideIcons.search, size: 14, color: AppColors.muted),
                    const SizedBox(height: 4),
                    Text('No matches for "$query"', style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                  ],
                ),
              )
            else
              for (final m in visible.take(15))
                ListTile(
                  dense: true,
                  visualDensity: VisualDensity.compact,
                  leading: const Text('#', style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w700)),
                  title: Text(
                    m.title,
                    style: const TextStyle(fontSize: 13, color: AppColors.ink),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () => onTapMatter(m),
                ),
          ],
        );
      },
    );
  }
}

class _DrawerTile extends StatelessWidget {
  const _DrawerTile({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 18, color: AppColors.ink),
      title: Text(label, style: const TextStyle(fontSize: 14, color: AppColors.ink)),
      onTap: onTap,
    );
  }
}
