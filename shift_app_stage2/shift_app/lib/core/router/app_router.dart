import 'package:go_router/go_router.dart';

import '../../features/home/presentation/home_placeholder_screen.dart';

/// App-wide navigation graph.
///
/// Stage-2 scope only: a single placeholder route that proves the app boots
/// and the Supabase connection is live. Real screens (upload/home, design
/// studio, result/compare, paywall, settings) are added in later stages
/// (3 and 6 of the roadmap) — routes will be added here as those are built,
/// not implemented ahead of that approval.
class AppRouter {
  AppRouter._();

  static final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        name: 'home',
        builder: (context, state) => const HomePlaceholderScreen(),
      ),
    ],
  );
}
