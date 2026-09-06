import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_screen.dart';
import '../../features/coupon/presentation/coupon_screen.dart';
import '../../features/design_studio/presentation/design_studio_screen.dart';
import '../../features/gallery/presentation/gallery_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/processing/presentation/processing_screen.dart';
import '../../features/result/presentation/result_screen.dart';
import '../../features/upload_photo/presentation/upload_photo_screen.dart';
import 'route_names.dart';

/// App-wide navigation graph.
///
/// שלב 6 (סשן 7): הראוטר מחובר סוף-סוף לכל 5 מסכי זרימת ההדמיה —
/// בית → חומרים → העלאת תמונה → עיבוד → תוצאה. כל מסך כבר יודע לנווט
/// הלאה בעצמו (context.push / context.go / context.pushReplacement,
/// לפי AppRoutes ב-route_names.dart) — הראוטר כאן רק ממפה נתיב לווידג'ט.
///
/// מסך התוצאה (5/5) מקבל את RenderResultData דרך `extra` של go_router
/// (מסך העיבוד קורא context.pushReplacement(AppRoutes.result, extra: ...))
/// וקורא אותו בעצמו מ-GoRouterState.of(context).extra בתוך
/// result_screen.dart — אין צורך להעביר אותו כאן דרך ה-builder.
///
/// מסך הבית ה-placeholder (home_placeholder_screen.dart) לא נמחק, רק
/// הפסיק להיות מיובא — נשאר בפרויקט בלי שימוש, אין בזה נזק.
///
/// **סשן 9:** נוסף `AppRoutes.gallery` (הגלריה האישית). מסך העיבוד יכול
/// גם לקבל `ProcessingResumeArgs` דרך `extra` — ראו route_names.dart.
///
/// **סשן 13 (המשך):** נוסף `AppRoutes.auth` (מסך התחברות/הרשמה/חשבון).
class AppRouter {
  AppRouter._();

  static final GoRouter router = GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.designStudio,
        name: 'design-studio',
        builder: (context, state) => const DesignStudioScreen(),
      ),
      GoRoute(
        path: AppRoutes.uploadPhoto,
        name: 'upload-photo',
        builder: (context, state) => const UploadPhotoScreen(),
      ),
      GoRoute(
        path: AppRoutes.processing,
        name: 'processing',
        builder: (context, state) => const ProcessingScreen(),
      ),
      GoRoute(
        path: AppRoutes.result,
        name: 'result',
        builder: (context, state) => const ResultScreen(),
      ),
      GoRoute(
        path: AppRoutes.coupon,
        name: 'coupon',
        builder: (context, state) => const CouponScreen(),
      ),
      GoRoute(
        path: AppRoutes.gallery,
        name: 'gallery',
        builder: (context, state) => const GalleryScreen(),
      ),
      GoRoute(
        path: AppRoutes.auth,
        name: 'auth',
        builder: (context, state) => const AuthScreen(),
      ),
    ],
  );
}
