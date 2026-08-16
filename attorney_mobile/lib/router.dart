import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'screens/admin/llm_usage_screen.dart';
import 'screens/ai_workflows/ai_credits_screen.dart';
import 'screens/ai_workflows/ai_researcher_screen.dart';
import 'screens/ai_workflows/templates_screen.dart';
import 'screens/ai_workflows/workflow_detail_screen.dart';
import 'screens/ai_workflows/workflows_screen.dart';
import 'screens/auth/accept_invite_screen.dart';
import 'screens/auth/forgot_password_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/auth/reset_password_screen.dart';
import 'screens/auth/verify_email_screen.dart';
import 'screens/billables/billables_screen.dart';
import 'screens/book/book_lawyer_screen.dart';
import 'screens/bookings/bookings_screen.dart';
import 'screens/matters/create_matter_screen.dart';
import 'screens/clients/clients_screen.dart';
import 'screens/dashboard/dashboard_screen.dart';
import 'screens/lawyers/lawyer_profile_screen.dart';
import 'screens/lawyers/lawyers_screen.dart';
import 'screens/matters/matter_screen.dart';
import 'screens/matters/matters_list_screen.dart';
import 'screens/my_lawyers/my_lawyers_screen.dart';
import 'screens/onboarding/onboarding_screen.dart';
import 'screens/public/landing_screen.dart';
import 'screens/public/privacy_screen.dart';
import 'screens/public/terms_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'screens/shell/app_shell.dart';
import 'screens/shell/splash_screen.dart';
import 'screens/transactions/transactions_screen.dart';
import 'state/providers.dart';

void _rlog(String m) => debugPrint('[router] $m');

/// All routes the mobile app exposes. Public routes work without auth;
/// every other route is auth-gated.
class Routes {
  static const splash = '/';
  static const onboarding = '/onboarding';
  static const landing = '/landing';
  static const login = '/login';
  static const register = '/register';
  static const forgotPassword = '/forgot-password';
  static const resetPassword = '/reset-password';
  static const verifyEmail = '/verify-email';
  static const acceptInvite = '/accept-invite';
  static const terms = '/terms';
  static const privacy = '/privacy';

  static const lawyersPublic = '/lawyers';
  static String lawyerProfile(int id) => '/lawyers/$id';

  static const dashboard = '/dashboard';
  static const myLawyers = '/my-lawyers';
  static const clients = '/clients';
  static const bookings = '/bookings';
  static const billables = '/billables';
  static const transactions = '/transactions';
  static const settings = '/settings';
  static const matters = '/matters';
  static const createMatter = '/create-matter';
  static String matter(int id) => '/matters/$id';
  static String book(int lawyerId) => '/book/$lawyerId';

  static const aiWorkflows = '/ai-workflows';
  static String workflow(int id) => '/ai-workflows/$id';
  static const aiResearcher = '/ai-workflows/ai-researcher';
  static const workflowTemplates = '/ai-workflows/templates';
  static const aiCredits = '/ai-workflows/credits';

  static const adminLlmUsage = '/admin/llm-usage';
}

/// AI Workflows is web-only for now. While false, the mobile app hides all
/// entry points and redirects any /ai-workflows* deep link to the dashboard.
/// Flip to true to re-enable on mobile.
const bool kAiWorkflowsEnabled = false;

final _publicRoutes = <String>{
  Routes.splash,
  Routes.onboarding,
  Routes.landing,
  Routes.login,
  Routes.register,
  Routes.forgotPassword,
  Routes.resetPassword,
  Routes.verifyEmail,
  Routes.acceptInvite,
  Routes.terms,
  Routes.privacy,
  Routes.lawyersPublic,
};

bool _isPublic(String path) {
  if (_publicRoutes.contains(path)) return true;
  if (path.startsWith('/lawyers/')) return true;
  return false;
}

final routerProvider = Provider<GoRouter>((ref) {
  // Build the router ONCE. Reading auth via ref.watch would rebuild the
  // router on every state change and reset navigation back to splash.
  // Instead we rely on refreshListenable to re-run `redirect`, and read
  // the live auth state inside the callback.
  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final status = ref.read(authProvider).status;
      final going = state.matchedLocation;
      _rlog('redirect from=$going status=$status');
      if (status == AuthStatus.unknown) {
        // Wait for the splash effect to finish bootstrapping.
        return going == Routes.splash ? null : Routes.splash;
      }
      // AI Workflows is hidden on mobile for now — block any deep link.
      if (!kAiWorkflowsEnabled && going.startsWith('/ai-workflows')) {
        return Routes.dashboard;
      }
      // Once auth resolves, leave the splash route regardless of branch.
      // First-time anonymous visitors see the onboarding carousel.
      if (going == Routes.splash) {
        if (status == AuthStatus.authed) return Routes.dashboard;
        return ref.read(onboardingSeenProvider) ? Routes.login : Routes.onboarding;
      }
      if (status == AuthStatus.anonymous && !_isPublic(going)) {
        return Routes.login;
      }
      if (status == AuthStatus.authed &&
          (going == Routes.login ||
              going == Routes.register ||
              going == Routes.landing ||
              going == Routes.onboarding)) {
        return Routes.dashboard;
      }
      return null;
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (_, __) => const SplashScreen()),
      GoRoute(path: Routes.onboarding, builder: (_, __) => const OnboardingScreen()),
      GoRoute(path: Routes.landing, builder: (_, __) => const LandingScreen()),
      GoRoute(path: Routes.login, builder: (_, __) => const LoginScreen()),
      GoRoute(path: Routes.register, builder: (_, __) => const RegisterScreen()),
      GoRoute(path: Routes.forgotPassword, builder: (_, __) => const ForgotPasswordScreen()),
      GoRoute(
        path: Routes.resetPassword,
        builder: (_, s) => ResetPasswordScreen(
          uid: s.uri.queryParameters['uid'] ?? '',
          token: s.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(
        path: Routes.verifyEmail,
        builder: (_, s) => VerifyEmailScreen(
          uid: s.uri.queryParameters['uid'] ?? '',
          token: s.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(
        path: Routes.acceptInvite,
        builder: (_, s) => AcceptInviteScreen(
          token: s.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(path: Routes.terms, builder: (_, __) => const TermsScreen()),
      GoRoute(path: Routes.privacy, builder: (_, __) => const PrivacyScreen()),

      // Routes wrapped in AppShell. AppShell renders chrome (bottom nav,
      // drawer) for authed users and falls through to bare content for
      // anon visitors — so /lawyers stays browsable from the landing page.
      ShellRoute(
        builder: (context, state, child) => AppShell(location: state.matchedLocation, child: child),
        routes: [
          // Public-browsable routes — anon users can hit these via the
          // landing page; authed users hit them via the bottom nav.
          GoRoute(path: Routes.lawyersPublic, builder: (_, __) => const LawyersScreen()),
          GoRoute(
            path: '/lawyers/:id',
            builder: (_, s) => LawyerProfileScreen(lawyerId: int.parse(s.pathParameters['id']!)),
          ),

          GoRoute(path: Routes.dashboard, builder: (_, __) => const DashboardScreen()),
          GoRoute(path: Routes.myLawyers, builder: (_, __) => const MyLawyersScreen()),
          GoRoute(path: Routes.clients, builder: (_, __) => const ClientsScreen()),
          GoRoute(path: Routes.bookings, builder: (_, __) => const BookingsScreen()),
          GoRoute(path: Routes.billables, builder: (_, __) => const BillablesScreen()),
          GoRoute(path: Routes.transactions, builder: (_, __) => const TransactionsScreen()),
          GoRoute(path: Routes.settings, builder: (_, __) => const SettingsScreen()),
          GoRoute(path: Routes.matters, builder: (_, __) => const MattersListScreen()),
          GoRoute(path: Routes.createMatter, builder: (_, __) => const CreateMatterScreen()),
          GoRoute(
            path: '/matters/:id',
            builder: (_, s) => MatterScreen(matterId: int.parse(s.pathParameters['id']!)),
          ),
          GoRoute(
            path: '/book/:lawyerId',
            builder: (_, s) => BookLawyerScreen(lawyerId: int.parse(s.pathParameters['lawyerId']!)),
          ),
          GoRoute(path: Routes.aiWorkflows, builder: (_, __) => const WorkflowsScreen()),
          GoRoute(path: Routes.aiResearcher, builder: (_, __) => const AiResearcherScreen()),
          GoRoute(path: Routes.workflowTemplates, builder: (_, __) => const WorkflowTemplatesScreen()),
          GoRoute(path: Routes.aiCredits, builder: (_, __) => const AiCreditsScreen()),
          GoRoute(
            path: '/ai-workflows/:id',
            builder: (_, s) => WorkflowDetailScreen(workflowId: int.parse(s.pathParameters['id']!)),
          ),
          GoRoute(path: Routes.adminLlmUsage, builder: (_, __) => const LlmUsageScreen()),
        ],
      ),
    ],
  );
});

/// Adapter so go_router refreshes when our Riverpod auth state changes.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(this._ref) {
    _sub = _ref.listen<AuthState>(authProvider, (prev, next) {
      _rlog('auth changed ${prev?.status} -> ${next.status} — notifying router');
      notifyListeners();
    });
  }
  final Ref _ref;
  late final ProviderSubscription _sub;
  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}
