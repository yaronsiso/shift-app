#!/usr/bin/env bash
set -euo pipefail

# SHIFT — סשן 9: עבודה אסינכרונית (job + polling) + גלריה אישית.
# מריצים עם: bash /workspaces/shift-app/shift_app/apply_session9.sh
# (נתיב מלא — עובד לא משנה מאיזו תיקייה הטרמינל פתוח.)

cd /workspaces/shift-app/shift_app

mkdir -p lib/core/router
mkdir -p lib/features/render/data
mkdir -p lib/features/processing/presentation
mkdir -p lib/features/home/presentation
mkdir -p lib/features/gallery/presentation
mkdir -p lib/features/result/presentation
mkdir -p assets/translations
mkdir -p ../shift_app_stage5/supabase/functions/generate-render

echo '>> כותב /workspaces/shift-app/shift_app/lib/core/router/route_names.dart'
cat > '/workspaces/shift-app/shift_app/lib/core/router/route_names.dart' << 'SHIFTEOF'
/// נתיבי הניווט של זרימת ההדמיה (5 מסכים). קובץ נפרד כדי שכל מסך יוכל
/// להפנות למסך הבא בלי להמתין לעדכון app_router.dart — הראוטר עצמו
/// מחובר בחלק הבא של קוד שלב 6.
class AppRoutes {
  AppRoutes._();

  static const home = '/';
  static const designStudio = '/design-studio';
  static const uploadPhoto = '/upload-photo';
  static const processing = '/processing';
  static const result = '/result';

  /// מסך הזנת קוד קופון (סשן 7) — נגיש מתפריט מסך הבית, לא חלק מזרימת
  /// ההדמיה הליניארית של 5 המסכים למעלה.
  static const coupon = '/coupon';

  /// הגלריה האישית (סשן 9) — כל ההדמיות שהצליחו של המשתמש. נגיש גם
  /// מאייקון בסרגל העליון של מסך הבית וגם מכפתור במסך התוצאה.
  static const gallery = '/gallery';
}

/// פרמטר אופציונלי למסך העיבוד (AppRoutes.processing), מועבר דרך `extra`
/// של go_router.
///
/// **סשן 9 — מנגנון "חידוש אוטומטי":** כשמסך הבית מגלה (דרך
/// `RenderService.findPendingRender()`) שיש למשתמש הדמיה שנשארה תקועה
/// ב-status='processing' — למשל כי האפליקציה נסגרה/נהרגה ברקע בזמן
/// שהיא עדיין רצה בשרת — הוא מנווט למסך העיבוד עם `ProcessingResumeArgs`
/// שמכיל את ה-renderId הקיים. מסך העיבוד, כשהוא מקבל את זה, **לא שולח
/// בקשה חדשה** (אין קרדיט נוסף, אין תמונה חדשה) — הוא רק ממשיך לעקוב
/// אחרי אותה הדמיה בדיוק עד שהיא מוכנה, בדיוק כאילו לא יצאנו מהמסך
/// מלכתחילה. כשה-`extra` הוא null (הכניסה הרגילה, אחרי לחיצת SHIFT) —
/// המסך שולח בקשה חדשה כרגיל מ-`renderFlowProvider`.
class ProcessingResumeArgs {
  final String renderId;
  const ProcessingResumeArgs({required this.renderId});
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/core/router/app_router.dart'
cat > '/workspaces/shift-app/shift_app/lib/core/router/app_router.dart' << 'SHIFTEOF'
import 'package:go_router/go_router.dart';

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
    ],
  );
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/render/data/render_service.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/render/data/render_service.dart' << 'SHIFTEOF'
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../dictionary/data/note_modifier.dart';
import '../../prompt_engine/prompt_engine.dart';

/// תוצאה מיידית של הגשת בקשה ליצירת הדמיה (`submitRender`).
///
/// **סשן 9 — שינוי ארכיטקטוני:** בעבר `generate()` היה מחכה עד שההדמיה
/// כולה הייתה מוכנה (18-30 שניות, חיבור פתוח לכל האורך) ורק אז מחזיר
/// תוצאה. זה התברר כבעיה: מערכת ההפעלה (הן ב-MIUI/פוקו והן בסמסונג)
/// הורגת את האפליקציה ברקע בזמן ההמתנה הארוכה הזו, וגם כשהשרת הצליח
/// במלואו (אומת ב-Invocations: 200) המשתמש לא רואה שום דבר.
///
/// עכשיו `submitRender` חוזר **כמעט מיד** (השרת מתחיל לעבד ברקע ומחזיר
/// תשובה בלי לחכות ל-Replicate) עם `renderId` בלבד. את הסטטוס בודקים
/// בהמשך עם `checkStatus` — שאילתה קצרה וזולה ישירות מטבלת `renders`
/// (RLS כבר מתירה SELECT על השורות של המשתמש עצמו, מאז מיגרציה 0001),
/// לא עוד קריאה ל-Edge Function. כך גם אם האפליקציה נסגרת/נהרגת באמצע
/// ההמתנה, שום דבר לא הולך לאיבוד: התוצאה כבר מחכה בשרת (ב-Storage
/// וב-`renders.after_image_path`), ואפשר לחזור ולבדוק אותה בכל רגע —
/// דרך `checkStatus` (אם יודעים את ה-renderId), `findPendingRender`
/// (חידוש אוטומטי אחרי חזרה לאפליקציה) או `listMyRenders` (הגלריה
/// האישית).
sealed class RenderSubmitOutcome {
  const RenderSubmitOutcome();
}

/// הבקשה נקלטה בהצלחה בשרת והתחילה להתעבד ברקע.
class RenderSubmitted extends RenderSubmitOutcome {
  final String renderId;

  /// כמה הדמיות חינם נותרו אחרי שהקרדיט הזה נצרך.
  final int freeRemaining;

  const RenderSubmitted({required this.renderId, required this.freeRemaining});
}

/// המכסה נגמרה — האפליקציה תציג Paywall.
class RenderQuotaExhausted extends RenderSubmitOutcome {
  const RenderQuotaExhausted();
}

/// כשל מיידי בהגשת הבקשה עצמה (עוד לפני שנוצר renderId) — למשל בעיית
/// רשת, בחירה לא תקפה, או שגיאת שרת. הקרדיט לא נוצל.
class RenderFailure extends RenderSubmitOutcome {
  final String code;
  final String? detail;
  const RenderFailure(this.code, [this.detail]);

  /// הודעה ידידותית להצגה למשתמש.
  String get messageHe => switch (code) {
        'unauthorized' => 'צריך להתחבר מחדש כדי ליצור הדמיה.',
        'bad_selection' => 'אחת הבחירות אינה תקפה לחדר שנבחר.',
        'replicate_error' ||
        'replicate_unreachable' ||
        'generation_failed' ||
        'failed' ||
        'refunded' =>
          'שרת ההדמיות לא זמין כרגע. הקרדיט לא נוצל — אפשר לנסות שוב.',
        'image_url_failed' => 'לא הצלחנו לגשת לתמונה שהעלית. נסה להעלות שוב.',
        _ => 'משהו השתבש. הקרדיט לא נוצל — אפשר לנסות שוב.',
      };
}

/// התוצאה הסופית של הדמיה שהצליחה — משמשת את מסך התוצאה
/// (דרך `RenderResultData`). נבנית עכשיו ע"י מסך העיבוד אחרי שהתשאול
/// (`checkStatus`) מגלה `status == 'succeeded'`, לא עוד ישירות מתשובת
/// ה-Edge Function.
class RenderSuccess {
  final String renderId;

  /// נתיב התמונה שנוצרה ב-Storage (בתוך התיקייה של המשתמש).
  final String? afterImagePath;

  /// כתובת ישירה — רק אם ההעלאה ל-Storage נכשלה. זמנית.
  final String? fallbackUrl;

  /// כמה הדמיות חינם נותרו אחרי הפעולה (כפי שהתקבל בזמן ההגשה).
  final int freeRemaining;

  const RenderSuccess({
    required this.renderId,
    required this.afterImagePath,
    required this.fallbackUrl,
    required this.freeRemaining,
  });
}

/// מצב הזכאות של המשתמש — להצגת מונה הקרדיטים במסך הבית/העיצוב.
class RenderEligibility {
  final bool allowed;
  final String reason;
  final int freeRemaining;
  final String subscriptionTier;
  final bool subscriptionActive;

  const RenderEligibility({
    required this.allowed,
    required this.reason,
    required this.freeRemaining,
    required this.subscriptionTier,
    required this.subscriptionActive,
  });
}

/// תמונת מצב חד-פעמית של הדמיה — תוצאה של `checkStatus` או
/// `findPendingRender`. משקפת שורה בטבלת `renders` ברגע נתון.
class RenderStatusResult {
  final String renderId;

  /// 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'.
  final String status;
  final String? afterImagePath;
  final String? errorMessage;

  const RenderStatusResult({
    required this.renderId,
    required this.status,
    this.afterImagePath,
    this.errorMessage,
  });

  bool get isSucceeded => status == 'succeeded';
  bool get isTerminalFailure => status == 'failed' || status == 'refunded';
  bool get isStillWorking => !isSucceeded && !isTerminalFailure;

  factory RenderStatusResult.fromRow(Map<String, dynamic> row) =>
      RenderStatusResult(
        renderId: row['id'] as String,
        status: row['status'] as String? ?? 'processing',
        afterImagePath: row['after_image_path'] as String?,
        errorMessage: row['error_message'] as String?,
      );
}

/// שורה אחת בהיסטוריית ההדמיות של המשתמש — לגלריה האישית. **רק תמונת
/// התוצאה** (לא תמונת ה"לפני") — כך הוחלט מול ירון (סשן 9).
class RenderHistoryItem {
  final String id;
  final String? afterImagePath;
  final DateTime createdAt;

  const RenderHistoryItem({
    required this.id,
    required this.afterImagePath,
    required this.createdAt,
  });

  factory RenderHistoryItem.fromRow(Map<String, dynamic> row) =>
      RenderHistoryItem(
        id: row['id'] as String,
        afterImagePath: row['after_image_path'] as String?,
        createdAt: DateTime.parse(row['created_at'] as String),
      );
}

/// השירות שמדבר עם ה-Edge Function וישירות עם טבלת `renders` (לתשאול
/// סטטוס ולגלריה — לא צריך Edge Function לזה, RLS כבר מתירה).
///
/// **שים לב מה *לא* נשלח מכאן:** הפרומפט. האפליקציה שולחת את סוג החדר ואת
/// מזהי הפריטים בלבד, והשרת בונה את הפרומפט בעצמו מהמילון שלו. אחרת כל מי
/// שיפרק את האפליקציה יוכל לשלוח פרומפט חופשי ולהשתמש בחשבון ה-Replicate
/// שלנו לכל מטרה.
///
/// `PromptEngine` שבאפליקציה משמש לתצוגה מקדימה למשתמש בלבד — הגרסה שבשרת
/// היא הקובעת.
class RenderService {
  final SupabaseClient _client;
  RenderService(this._client);

  /// כמה הדמיות נותרו — בלי לצרוך כלום.
  Future<RenderEligibility> checkEligibility() async {
    final rows = await _client.rpc('render_eligibility');
    final r = (rows is List && rows.isNotEmpty) ? rows.first : rows;
    return RenderEligibility(
      allowed: r?['allowed'] as bool? ?? false,
      reason: r?['reason'] as String? ?? 'unknown',
      freeRemaining: r?['free_remaining'] as int? ?? 0,
      subscriptionTier: r?['subscription_tier'] as String? ?? 'free',
      subscriptionActive: r?['subscription_active'] as bool? ?? false,
    );
  }

  /// מעלה את תמונת המקור לתיקייה הפרטית של המשתמש ומחזיר את הנתיב.
  Future<String> uploadBeforeImage(String localFilePath) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) throw StateError('לא מחובר');
    final name = '$uid/before_${DateTime.now().millisecondsSinceEpoch}.jpg';
    await _client.storage.from('renders').upload(name, File(localFilePath));
    return name;
  }

  /// שולח בקשה ליצירת הדמיה. **חוזר כמעט מיד** עם renderId — לא מחכה
  /// שהתמונה תהיה מוכנה (ראו ההסבר המלא ב-`RenderSubmitOutcome` למעלה).
  /// יש להמשיך ולעקוב אחרי הסטטוס עם `checkStatus`.
  Future<RenderSubmitOutcome> submitRender({
    required String roomTypeCode,
    required List<MaterialSelection> selections,
    required String beforeImagePath,
    String languageCode = 'he',
  }) async {
    try {
      final res = await _client.functions.invoke(
        'generate-render',
        body: {
          'roomTypeCode': roomTypeCode,
          'beforeImagePath': beforeImagePath,
          'languageCode': languageCode,
          'selections': selections.map(_selectionToJson).toList(),
        },
      );

      final data = res.data as Map<String, dynamic>?;

      if (res.status == 402) return const RenderQuotaExhausted();
      if (res.status != 200 || data == null || data['renderId'] == null) {
        return RenderFailure(
          data?['error'] as String? ?? 'unknown',
          data?['detail'] as String?,
        );
      }

      return RenderSubmitted(
        renderId: data['renderId'] as String,
        freeRemaining: data['freeRemaining'] as int? ?? 0,
      );
    } on FunctionException catch (e) {
      if (e.status == 402) return const RenderQuotaExhausted();
      return RenderFailure('function_error', e.details?.toString());
    } catch (e) {
      return RenderFailure('network_error', e.toString());
    }
  }

  /// בדיקת סטטוס חד-פעמית של הדמיה שכבר הוגשה. שאילתה ישירה על טבלת
  /// `renders` (לא Edge Function) — קצרה וזולה, מתאימה לתשאול חוזר.
  Future<RenderStatusResult> checkStatus(String renderId) async {
    final row = await _client
        .from('renders')
        .select('id, status, after_image_path, error_message')
        .eq('id', renderId)
        .single();
    return RenderStatusResult.fromRow(row);
  }

  /// הדמיה שנשארה "תקועה" ב-pending/processing עבור המשתמש הנוכחי —
  /// למשל כי האפליקציה נסגרה/נהרגה ברקע לפני שהתשובה חזרה. נקרא במסך
  /// הבית כדי לחזור אוטומטית למסך העיבוד ולהמשיך לעקוב אחריה, במקום
  /// לאבד אותה. מחזיר null אם אין כזו.
  ///
  /// שולף את 5 ההדמיות האחרונות של המשתמש ומסנן בצד הלקוח (לא שאילתת
  /// "in" בצד השרת) — בכוונה: פשוט ואמין, בלי תלות בשם מתודה ספציפי
  /// בגרסת postgrest-dart המדויקת. עלות זניחה (נקרא פעם אחת בכל טעינת
  /// מסך הבית, 5 שורות בלבד).
  Future<RenderStatusResult?> findPendingRender() async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) return null;
    final rows = await _client
        .from('renders')
        .select('id, status, after_image_path, error_message')
        .eq('user_id', uid)
        .order('created_at', ascending: false)
        .limit(5);
    for (final r in (rows as List)) {
      final row = r as Map<String, dynamic>;
      final status = row['status'] as String?;
      if (status == 'pending' || status == 'processing') {
        return RenderStatusResult.fromRow(row);
      }
    }
    return null;
  }

  /// כל ההדמיות שהצליחו למשתמש הנוכחי, החדשה ביותר ראשונה — לגלריה
  /// האישית.
  Future<List<RenderHistoryItem>> listMyRenders({int limit = 200}) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) return const [];
    final rows = await _client
        .from('renders')
        .select('id, after_image_path, created_at')
        .eq('user_id', uid)
        .eq('status', 'succeeded')
        .not('after_image_path', 'is', null)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .map((r) => RenderHistoryItem.fromRow(r as Map<String, dynamic>))
        .toList();
  }

  /// מחיקת הדמיה מהגלריה — גם הקובץ ב-Storage וגם השורה בטבלה. RLS כבר
  /// מתירה למשתמש למחוק רק את שלו (מיגרציה 0001).
  Future<void> deleteRender(RenderHistoryItem item) async {
    if (item.afterImagePath != null) {
      try {
        await _client.storage.from('renders').remove([item.afterImagePath!]);
      } catch (_) {
        // אם מחיקת הקובץ נכשלת (למשל כבר לא קיים) — עדיין ממשיכים למחוק
        // את השורה, כדי שהתמונה לפחות תיעלם מהגלריה של המשתמש.
      }
    }
    await _client.from('renders').delete().eq('id', item.id);
  }

  /// כתובת חתומה לצפייה בתמונה שנוצרה.
  Future<String> signedUrlFor(String storagePath) => _client.storage
      .from('renders')
      .createSignedUrl(storagePath, 3600);

  // ---------- המרה ל-JSON ----------

  Map<String, dynamic> _selectionToJson(MaterialSelection sel) => {
        'itemId': sel.item.id,
        if (sel.modifiers.isNotEmpty)
          'modifiers': sel.modifiers.map(_modifierToJson).toList(),
      };

  Map<String, dynamic> _modifierToJson(NoteModifier m) => switch (m) {
        HeightLimit h => {
            'kind': 'heightLimit',
            'cm': h.centimeters,
            if (h.aboveTreatmentEn != null)
              'aboveTreatmentEn': h.aboveTreatmentEn,
          },
        StopShortOfEdge s => {
            'kind': 'stopShortOfEdge',
            'cm': s.centimeters,
            'edgeEn': s.edge.labelEn,
          },
        PartialCoverage p => {
            'kind': 'partialCoverage',
            'scopeEn': p.scope.labelEn,
          },
        LayoutDirection d => {
            'kind': 'layoutDirection',
            'directionEn': d.direction.labelEn,
          },
        // הטקסט נשלח כמו שהוא בשפת הלקוח. השרת מנסח אותו מחדש באנגלית —
        // ומתעלם מכל resolvedEn שיגיע מהלקוח.
        FreeTextNote f => {
            'kind': 'freeText',
            'rawText': f.rawText,
          },
      };
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/processing/presentation/processing_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/processing/presentation/processing_screen.dart' << 'SHIFTEOF'
import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart';
import '../../render_flow/data/render_flow_notifier.dart';
import '../../result/data/render_result_data.dart';

enum _ProcessingPhase {
  /// שולחים/מעקבים אחרי הדמיה שעדיין רצה.
  running,

  /// אין קרדיטים — נתגלה מיד עם ההגשה, לפני שנוצר renderId.
  quotaExhausted,

  /// כשל מיידי בהגשה עצמה (לפני שנוצר renderId) — בחירות/רשת/שרת.
  /// מצב הזרימה (`render_flow`) עדיין שלם, אז "נסה שוב" שולח את אותה
  /// בקשה שוב.
  submitFailure,

  /// כשל שהתגלה בתשאול (אחרי שכבר היה renderId) — הקרדיט כבר הוחזר
  /// אוטומטית בשרת. אין "נסה שוב" עם אותן בחירות: הזרימה כבר אופסה
  /// ברגע שהבקשה הוגשה (ראו ההסבר ב-_run), ובמצב "חידוש אוטומטי" היא
  /// לא הייתה קיימת מלכתחילה (האפליקציה נפתחה מחדש). המשתמש פשוט בוחר
  /// שוב מההתחלה.
  postFailure,

  /// עברו הרבה יותר מ-30 השניות הרגילות בלי תוצאה. שום דבר לא אבד —
  /// ההדמיה עדיין רצה/ממתינה בשרת — אבל מפסיקים לתשאל באגרסיביות
  /// ומאפשרים למשתמש לחזור למסך הבית ולבוא לבדוק אחר כך (גם דרך חידוש
  /// אוטומטי בפעם הבאה שהוא פותח את האפליקציה, וגם דרך הגלריה שלו ברגע
  /// שההדמיה תסתיים).
  stillWorking,
}

/// מסך 4/5 — עיבוד ההדמיה.
///
/// **סשן 9 — שינוי ארכיטקטוני מלא:** בעבר המסך היה שולח בקשה אחת ומחכה
/// לה עד הסוף (18-30 שניות, חיבור פתוח לכל האורך) — וזה מה שגרם לבאג
/// "קפיצה למסך הבית": מערכת ההפעלה (גם ב-MIUI/פוקו וגם בסמסונג, אושר
/// בבדיקה אצל שני משתמשים שונים) הורגת את האפליקציה ברקע בזמן ההמתנה,
/// והתוצאה שהשרת כבר סיים ליצור בהצלחה (מאומת ב-Invocations: 200)
/// "נופלת על הרצפה" כי אין מי שיציג אותה.
///
/// עכשיו הזרימה מפוצלת לשני שלבים: `RenderService.submitRender` שולח
/// את הבקשה וחוזר **כמעט מיד** עם renderId בלבד (השרת ממשיך לעבד ברקע
/// אחרי שהוא כבר ענה — ראו ה-Edge Function), ואז המסך **מתשאל**
/// (`checkStatus`) כל 2 שניות עד שהתוצאה מוכנה. גם אם המסך הזה עצמו
/// נסגר/נהרס באמצע (המשתמש יצא, או האפליקציה נהרגה) — שום דבר לא אבד:
/// כשהמשתמש חוזר למסך הבית, `HomeScreen` מגלה אוטומטית שיש הדמיה שעדיין
/// בעיבוד וחוזר לכאן להמשיך לעקוב אחריה (`ProcessingResumeArgs`).
/// **לכן המסך הזה כבר לא חוסם יציאה** (ה-`PopScope` שנוסף בסשן 8 הוסר
/// בכוונה) — אפשר לצאת בביטחון.
///
/// ⚠️ שים לב: RenderService.uploadBeforeImage משתמש ב-dart:io, שלא נתמך
/// ב-Flutter Web. לכן אי אפשר לבדוק את שלב ההגשה (לא את התשאול) מקצה-
/// לקצה עם `flutter run -d web-server` — צריך מכשיר או אמולטור אמיתי.
class ProcessingScreen extends ConsumerStatefulWidget {
  const ProcessingScreen({super.key});

  @override
  ConsumerState<ProcessingScreen> createState() => _ProcessingScreenState();
}

class _ProcessingScreenState extends ConsumerState<ProcessingScreen> {
  static const _pollInterval = Duration(seconds: 2);
  // ~2 דקות של תשאול פעיל (60 * 2 שניות) לפני שעוברים למצב "עדיין עובדים
  // על זה" הפסיבי — נדיב בהרבה מזמן היצירה הרגיל (18-30 שניות).
  static const _maxActivePollAttempts = 60;

  _ProcessingPhase _phase = _ProcessingPhase.running;
  RenderFailure? _failure;
  Timer? _tipTimer;
  Timer? _pollTimer;
  int _tipIndex = 0;
  int _pollAttempts = 0;

  String? _renderId;
  int _freeRemainingAtSubmit = 0;
  String? _beforeLocalImagePathForResult;
  bool _isResume = false;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _tipTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) setState(() => _tipIndex++);
    });
    // רצים אחרי הפריים הראשון כדי שניווט (context.go/push) יהיה בטוח.
    WidgetsBinding.instance.addPostFrameCallback((_) => _init());
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    _pollTimer?.cancel();
    super.dispose();
  }

  void _init() {
    if (_initialized) return;
    _initialized = true;

    final extra = GoRouterState.of(context).extra;
    if (extra is ProcessingResumeArgs) {
      // חידוש אוטומטי — כבר יש renderId קיים, רק ממשיכים לעקוב אחריו.
      // אין תמונת "לפני" מקומית זמינה (מצב הזרימה כבר אבד כשהאפליקציה
      // נסגרה) — מסך התוצאה יודע להתמודד עם זה בחן (תמונת "אחרי" בלבד).
      _isResume = true;
      _renderId = extra.renderId;
      _startPolling();
    } else {
      _run();
    }
  }

  Future<void> _run() async {
    setState(() {
      _phase = _ProcessingPhase.running;
      _failure = null;
    });

    final flow = ref.read(renderFlowProvider);
    if (!flow.readyForShift) {
      // הגעה למסך הזה בלי תמונה/בחירות תקינות — מצב לא תקין, חוזרים הביתה.
      if (mounted) context.go(AppRoutes.home);
      return;
    }
    _beforeLocalImagePathForResult = flow.localImagePath;

    final service = ref.read(renderServiceProvider);
    try {
      final beforeImagePath =
          await service.uploadBeforeImage(flow.localImagePath!);
      final outcome = await service.submitRender(
        roomTypeCode: flow.roomTypeCode!,
        selections: flow.selectionsList,
        beforeImagePath: beforeImagePath,
        languageCode: context.locale.languageCode,
      );

      if (!mounted) return;

      switch (outcome) {
        case RenderSubmitted submitted:
          _renderId = submitted.renderId;
          _freeRemainingAtSubmit = submitted.freeRemaining;
          // מאפסים את מצב הזרימה **מיד אחרי ההגשה**, לא אחרי שהתוצאה
          // מוכנה: מרגע שהבקשה נקלטה בשרת, אין עוד צורך בבחירות האלה
          // כאן — וכך אפשר להתחיל זרימת עיצוב חדשה בלי להתנגש איתן, גם
          // אם ההדמיה הזו עדיין רצה ברקע.
          ref.read(renderFlowProvider.notifier).reset();
          _startPolling();
        case RenderQuotaExhausted _:
          setState(() => _phase = _ProcessingPhase.quotaExhausted);
        case RenderFailure failure:
          setState(() {
            _phase = _ProcessingPhase.submitFailure;
            _failure = failure;
          });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _ProcessingPhase.submitFailure;
        _failure = RenderFailure('network_error', e.toString());
      });
    }
  }

  void _startPolling() {
    setState(() => _phase = _ProcessingPhase.running);
    _pollAttempts = 0;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _pollOnce());
    _pollOnce(); // בדיקה ראשונה מיידית, לא מחכים ל-tick הראשון.
  }

  Future<void> _pollOnce() async {
    final renderId = _renderId;
    if (renderId == null) return;
    _pollAttempts++;

    try {
      final status =
          await ref.read(renderServiceProvider).checkStatus(renderId);
      if (!mounted) return;

      if (status.isSucceeded) {
        _pollTimer?.cancel();
        final resultData = RenderResultData(
          outcome: RenderSuccess(
            renderId: status.renderId,
            afterImagePath: status.afterImagePath,
            fallbackUrl: null,
            freeRemaining: _freeRemainingAtSubmit,
          ),
          beforeLocalImagePath: _beforeLocalImagePathForResult,
        );
        context.pushReplacement(AppRoutes.result, extra: resultData);
        return;
      }

      if (status.isTerminalFailure) {
        _pollTimer?.cancel();
        setState(() {
          _phase = _ProcessingPhase.postFailure;
          _failure = RenderFailure(status.status, status.errorMessage);
        });
        return;
      }

      // עדיין pending/processing.
      if (_pollAttempts >= _maxActivePollAttempts) {
        _pollTimer?.cancel();
        setState(() => _phase = _ProcessingPhase.stillWorking);
      }
    } catch (_) {
      // שגיאת רשת זמנית בבדיקת סטטוס — לא מכשילים את כל התהליך, פשוט
      // מנסים שוב בבדיקה הבאה. אם זה נמשך הרבה זמן, _maxActivePollAttempts
      // עדיין יעצור את התשאול האגרסיבי.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('processing_screen.app_title'.tr()),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: switch (_phase) {
          _ProcessingPhase.running =>
            _RunningView(tipIndex: _tipIndex, isResume: _isResume),
          _ProcessingPhase.quotaExhausted => _QuotaExhaustedView(
              onBackHome: () => context.go(AppRoutes.home),
            ),
          _ProcessingPhase.submitFailure => _FailureView(
              failure: _failure,
              primaryLabel: 'processing_screen.retry_button'.tr(),
              onPrimary: _run,
              secondaryLabel: 'processing_screen.back_button'.tr(),
              onSecondary: () => context.pop(),
            ),
          _ProcessingPhase.postFailure => _FailureView(
              failure: _failure,
              primaryLabel: 'processing_screen.quota_button'.tr(),
              onPrimary: () => context.go(AppRoutes.home),
            ),
          _ProcessingPhase.stillWorking => _StillWorkingView(
              onBackHome: () => context.go(AppRoutes.home),
              onKeepWaiting: _startPolling,
            ),
        },
      ),
    );
  }
}

class _RunningView extends ConsumerWidget {
  final int tipIndex;
  final bool isResume;
  const _RunningView({required this.tipIndex, required this.isResume});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(strokeWidth: 3),
          const SizedBox(height: 24),
          Text(
            'processing_screen.title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            isResume
                ? 'processing_screen.resuming_note'.tr()
                : 'processing_screen.eta_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 6),
          Text(
            'processing_screen.leave_ok_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.palette.inkFaint,
                ),
          ),
          const SizedBox(height: 32),
          // מקום לפרסומת/הודעת מערכת (לא הפס הנייד העליון — זה במפורש לא
          // מוצג במסך העיבוד; זה כרטיס נייח שמתחלף כל כמה שניות).
          marquee.when(
            data: (messages) {
              if (messages.isEmpty) return const SizedBox.shrink();
              final text = messages[tipIndex % messages.length].message;
              return AnimatedSwitcher(
                duration: const Duration(milliseconds: 350),
                child: Container(
                  key: ValueKey(text),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: context.palette.accentSoft,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: context.palette.accentSoftLine),
                  ),
                  child: Text(
                    text,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                ),
              );
            },
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _QuotaExhaustedView extends StatelessWidget {
  final VoidCallback onBackHome;
  const _QuotaExhaustedView({required this.onBackHome});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.hourglass_bottom,
              size: 48, color: context.palette.inkFaint),
          const SizedBox(height: 16),
          Text(
            'processing_screen.quota_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.quota_body'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onBackHome,
              child: Text('processing_screen.quota_button'.tr()),
            ),
          ),
        ],
      ),
    );
  }
}

/// עדיין רצה הרבה יותר מהצפוי — לא כישלון, רק המתנה ארוכה. שום דבר לא
/// אבד: אפשר לחזור למסך הבית (ההדמיה תופיע שם אוטומטית כשתסתיים, ובגלריה
/// האישית) או להישאר ולהמשיך להמתין כאן.
class _StillWorkingView extends StatelessWidget {
  final VoidCallback onBackHome;
  final VoidCallback onKeepWaiting;
  const _StillWorkingView(
      {required this.onBackHome, required this.onKeepWaiting});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.hourglass_top, size: 48, color: context.palette.inkFaint),
          const SizedBox(height: 16),
          Text(
            'processing_screen.still_working_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.still_working_body'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onBackHome,
                  child: Text('processing_screen.quota_button'.tr()),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onKeepWaiting,
                  child:
                      Text('processing_screen.still_working_wait_button'.tr()),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  final RenderFailure? failure;
  final String primaryLabel;
  final VoidCallback onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  const _FailureView({
    required this.failure,
    required this.primaryLabel,
    required this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: AppColors.danger),
          const SizedBox(height: 16),
          Text(
            'processing_screen.error_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            failure?.messageHe ?? 'processing_screen.error_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          if (secondaryLabel != null && onSecondary != null)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onSecondary,
                    child: Text(secondaryLabel!),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: onPrimary,
                    child: Text(primaryLabel),
                  ),
                ),
              ],
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: onPrimary,
                child: Text(primaryLabel),
              ),
            ),
        ],
      ),
    );
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/home/presentation/home_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/home/presentation/home_screen.dart' << 'SHIFTEOF'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../dictionary/data/category_group.dart';
import '../../dictionary/data/room_types_data.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart' show RenderEligibility;
import '../../render_flow/data/render_flow_notifier.dart';

/// מסך 1/5 — "מה מעצבים היום?". סוג חדר + קטגוריות-על. **אין כאן צילום
/// תמונה** — זה עבר במפורש למסך נפרד (upload_photo_screen, מסך 3) לפי
/// בקשת ירון (סשן 6): "במסך הבית קודם כל קטגוריות... ולאחר שהלקוח בוחר
/// את אותם הקטגוריות צריך להופיע לו צלם תמונה".
///
/// **סשן 9:** הפך מ-`ConsumerWidget` ל-`ConsumerStatefulWidget` כדי
/// שיוכל לבדוק, פעם אחת בכל פעם שהמסך נבנה (כולל פתיחה קרה של
/// האפליקציה), אם למשתמש יש הדמיה שנשארה תקועה ב-processing (למשל כי
/// האפליקציה נסגרה/נהרגה ברקע באמצע) — ואם כן, לחזור אוטומטית למסך
/// העיבוד כדי להמשיך לעקוב אחריה במקום לאבד אותה. גם נוסף אייקון גלריה
/// בסרגל העליון, לצד אייקון הקופון.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _checkedPendingRender = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkPendingRender());
  }

  Future<void> _checkPendingRender() async {
    if (_checkedPendingRender) return;
    _checkedPendingRender = true;
    try {
      final pending =
          await ref.read(renderServiceProvider).findPendingRender();
      if (pending != null && mounted) {
        context.push(
          AppRoutes.processing,
          extra: ProcessingResumeArgs(renderId: pending.renderId),
        );
      }
    } catch (_) {
      // לא קריטי — אם הבדיקה נכשלת (למשל רשת), המשתמש פשוט לא יופנה
      // אוטומטית הפעם. ההדמיה עדיין בטוחה בשרת, ותופיע בגלריה שלו כשהיא
      // תסתיים, ותנוסה שוב הבדיקה הזו בפעם הבאה שהוא פותח את מסך הבית.
    }
  }

  @override
  Widget build(BuildContext context) {
    final flow = ref.watch(renderFlowProvider);
    final notifier = ref.read(renderFlowProvider.notifier);
    final eligibility = ref.watch(renderEligibilityProvider);
    final marquee = ref.watch(marqueeMessagesProvider);
    final locale = context.locale.languageCode;

    final roomType = flow.roomTypeCode;
    final availableGroups = roomType == null
        ? kCategoryGroups
        : CategoryGroups.groupsForRoom(roomType);

    return Scaffold(
      appBar: AppBar(
        title: Text('home_screen.app_title'.tr()),
        actions: [
          IconButton(
            icon: const Icon(Icons.photo_library_outlined),
            tooltip: 'gallery_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.gallery),
          ),
          IconButton(
            icon: const Icon(Icons.confirmation_number_outlined),
            tooltip: 'coupon_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.coupon),
          ),
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            tooltip: 'language.select'.tr(),
            onSelected: (l) => context.setLocale(l),
            itemBuilder: (context) => context.supportedLocales
                .map(
                  (l) => PopupMenuItem(
                    value: l,
                    child: Text('language.${l.languageCode}'.tr()),
                  ),
                )
                .toList(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) =>
                  MarqueeBar(messages: messages.map((m) => m.message).toList()),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'home_screen.title'.tr(),
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'home_screen.subtitle'.tr(),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                  const SizedBox(height: 16),
                  _CreditPill(eligibility: eligibility),
                  const SizedBox(height: 24),

                  Text(
                    'home_screen.room_section'.tr(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: kRoomTypes.map((r) {
                      final selected = roomType == r.code;
                      return ChoiceChip(
                        label: Text(locale == 'he' ? r.labelHe : r.labelEn),
                        selected: selected,
                        onSelected: (_) => notifier.selectRoomType(r.code),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),

                  Text(
                    'home_screen.groups_section'.tr(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                  ),
                  if (roomType == null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'home_screen.select_room_first'.tr(),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: context.palette.inkFaint,
                          ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Opacity(
                    opacity: roomType == null ? 0.45 : 1.0,
                    child: IgnorePointer(
                      ignoring: roomType == null,
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: availableGroups.map((g) {
                          final selected = flow.selectedGroupCodes.contains(g.code);
                          return FilterChip(
                            label: Text(locale == 'he' ? g.labelHe : g.labelEn),
                            selected: selected,
                            onSelected: (_) => notifier.toggleGroup(g.code),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: flow.hasRoomAndGroups
                          ? () => context.push(AppRoutes.designStudio)
                          : null,
                      child: Text('home_screen.continue_button'.tr()),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CreditPill extends StatelessWidget {
  final AsyncValue<RenderEligibility> eligibility;
  const _CreditPill({required this.eligibility});

  @override
  Widget build(BuildContext context) {
    return eligibility.when(
      data: (e) {
        final String text;
        if (e.subscriptionActive) {
          text = 'home_screen.credits_subscription'.tr(args: ['${e.freeRemaining}']);
        } else if (e.allowed) {
          text = 'home_screen.credits_free'.tr(args: ['${e.freeRemaining}']);
        } else {
          text = 'home_screen.credits_exhausted'.tr();
        }
        return _pill(context, text);
      },
      loading: () => _pill(context, '…'),
      error: (_, __) => const SizedBox.shrink(),
    );
  }

  Widget _pill(BuildContext context, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: context.palette.accentSoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: context.palette.accentSoftLine),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/gallery/presentation/gallery_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/gallery/presentation/gallery_screen.dart' << 'SHIFTEOF'
import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart';

/// הגלריה האישית (סשן 9) — כל ההדמיות שהצליחו של המשתמש הנוכחי, החדשה
/// ביותר ראשונה. נגישה גם מאייקון בסרגל העליון של מסך הבית וגם מכפתור
/// במסך התוצאה (הוחלט מול ירון: שני מקומות כניסה). שומרת **רק** את
/// תמונת התוצאה (לא את תמונת ה"לפני") — גם זו החלטה מפורשת של ירון.
///
/// שום מיגרציה חדשה לא נדרשה בשביל המסך הזה: טבלת `renders` וה-Storage
/// כבר שומרים את כל מה שצריך מאז שלב 5, וה-RLS הקיים כבר מתיר SELECT
/// ו-DELETE למשתמש על השורות/הקבצים של עצמו בלבד (מיגרציה 0001).
class GalleryScreen extends ConsumerStatefulWidget {
  const GalleryScreen({super.key});

  @override
  ConsumerState<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends ConsumerState<GalleryScreen> {
  late Future<List<RenderHistoryItem>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(renderServiceProvider).listMyRenders();
  }

  Future<void> _refresh() async {
    final next = ref.read(renderServiceProvider).listMyRenders();
    setState(() => _future = next);
    await next;
  }

  Future<void> _confirmDelete(RenderHistoryItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('gallery_screen.delete_confirm_title'.tr()),
        content: Text('gallery_screen.delete_confirm_body'.tr()),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text('gallery_screen.delete_confirm_cancel'.tr()),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              'gallery_screen.delete_confirm_yes'.tr(),
              style: const TextStyle(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await ref.read(renderServiceProvider).deleteRender(item);
      if (mounted) await _refresh();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('gallery_screen.delete_error'.tr())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(title: Text('gallery_screen.app_title'.tr())),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) =>
                  MarqueeBar(messages: messages.map((m) => m.message).toList()),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: FutureBuilder<List<RenderHistoryItem>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return _ErrorView(onRetry: _refresh);
                  }
                  final items = snapshot.data ?? const [];
                  if (items.isEmpty) {
                    return const _EmptyView();
                  }
                  return RefreshIndicator(
                    onRefresh: _refresh,
                    child: GridView.builder(
                      padding: const EdgeInsets.all(16),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: 1,
                      ),
                      itemCount: items.length,
                      itemBuilder: (context, i) => _GalleryTile(
                        item: items[i],
                        onDelete: () => _confirmDelete(items[i]),
                      ),
                    ),
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

class _GalleryTile extends ConsumerStatefulWidget {
  final RenderHistoryItem item;
  final VoidCallback onDelete;
  const _GalleryTile({required this.item, required this.onDelete});

  @override
  ConsumerState<_GalleryTile> createState() => _GalleryTileState();
}

class _GalleryTileState extends ConsumerState<_GalleryTile> {
  String? _url;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    final path = widget.item.afterImagePath;
    if (path == null) {
      setState(() => _error = true);
      return;
    }
    try {
      final url = await ref.read(renderServiceProvider).signedUrlFor(path);
      if (mounted) setState(() => _url = url);
    } catch (_) {
      if (mounted) setState(() => _error = true);
    }
  }

  void _openDetail() {
    final url = _url;
    if (url == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _GalleryDetailScreen(
          imageUrl: url,
          renderId: widget.item.id,
          onDelete: widget.onDelete,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Material(
        color: context.palette.accentSoft,
        child: InkWell(
          onTap: _url == null ? null : _openDetail,
          child: _url != null
              ? Image.network(_url!, fit: BoxFit.cover)
              : Center(
                  child: _error
                      ? Icon(Icons.broken_image_outlined,
                          color: context.palette.inkFaint)
                      : const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                ),
        ),
      ),
    );
  }
}

/// תצוגה מוגדלת של הדמיה בודדת מהגלריה — שיתוף/מחיקה. נפתחת כ-push רגיל
/// (לא דרך go_router — זו תצוגה זמנית שנפתחת רק מתוך הגלריה עצמה).
class _GalleryDetailScreen extends StatelessWidget {
  final String imageUrl;
  final String renderId;
  final VoidCallback onDelete;

  const _GalleryDetailScreen({
    required this.imageUrl,
    required this.renderId,
    required this.onDelete,
  });

  Future<void> _share(BuildContext context) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse(imageUrl));
      final response = await request.close();
      final chunks = await response.toList();
      final bytes = chunks.expand((chunk) => chunk).toList();
      final file =
          await File('${Directory.systemTemp.path}/shift_$renderId.jpg')
              .writeAsBytes(bytes);
      client.close();
      await Share.shareXFiles([XFile(file.path)], text: 'SHIFT');
    } catch (_) {
      // לא קריטי — פשוט לא ישותף הפעם.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.ios_share),
            tooltip: 'gallery_screen.share_button'.tr(),
            onPressed: () => _share(context),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'gallery_screen.delete_button'.tr(),
            onPressed: () {
              Navigator.of(context).pop();
              onDelete();
            },
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          child: Image.network(imageUrl),
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.photo_library_outlined,
                size: 48, color: context.palette.inkFaint),
            const SizedBox(height: 16),
            Text(
              'gallery_screen.empty_title'.tr(),
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              'gallery_screen.empty_body'.tr(),
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: context.palette.inkSoft),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final Future<void> Function() onRetry;
  const _ErrorView({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.danger),
            const SizedBox(height: 16),
            Text('gallery_screen.load_error'.tr()),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: onRetry,
              child: Text('gallery_screen.retry_button'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/result/presentation/result_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/result/presentation/result_screen.dart' << 'SHIFTEOF'
import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../feedback/data/feedback_repository.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../data/render_result_data.dart';

/// מסך 5/5 — התוצאה. סליידר לפני/אחרי, שמירה ב-HD, שיתוף (וואטסאפ ועוד,
/// דרך גיליון השיתוף של המערכת), כפתור "עיצוב נוסף לחדר הזה", קישור
/// לגלריה האישית (סשן 9), ואזור דירוג קבוע. אם יש אבן-דרך משוב ממתינה
/// (2/10/20 הדמיות) — כרטיס קטן ולא חוסם מוצג מעל התוכן.
///
/// ⚠️ **פישוט מכוון, לתיאום עתידי עם ירון:** "עיצוב נוסף לחדר הזה" כרגע
/// פשוט חוזר למסך הבית (מצב הזרימה כבר התאפס במסך העיבוד לפני שהגענו
/// לכאן) — לא שומר את סוג החדר/הקטגוריות שנבחרו קודם. אם רוצים שזה
/// יזכור וימלא מראש את אותו סוג חדר, זו תוספת קטנה להמשך.
///
/// ⚠️ **החלטת מימוש לשמירה/שיתוף:** הוספתי תלות חדשה אחת — `share_plus`
/// — במקום פלאגין ייעודי לשמירה לגלריה (למשל `gal`), כי כזה דורש הגדרות
/// הרשאה נוספות בקבצי iOS/Android שאי אפשר לבדוק מכאן (אין גישת רשת/build
/// בענן). שני הכפתורים ("שמירה ב-HD" ו"שיתוף בוואטסאפ") פותחים את גיליון
/// השיתוף המובנה של המכשיר — משם אפשר לבחור "שמור תמונה" או וואטסאפ
/// ישירות. זו הדרך הפשוטה והאמינה ביותר בלי פלאגין נוסף שדורש בדיקה.
///
/// **סשן 9:** נוסף כפתור "לצפייה בכל ההדמיות שלי" שמוביל לגלריה האישית
/// (`AppRoutes.gallery`) — כל ההדמיות שהצליחו של המשתמש נשמרות שם
/// אוטומטית, בלי שום פעולה נוספת נדרשת ממנו.
class ResultScreen extends ConsumerStatefulWidget {
  const ResultScreen({super.key});

  @override
  ConsumerState<ResultScreen> createState() => _ResultScreenState();
}

class _ResultScreenState extends ConsumerState<ResultScreen> {
  String? _afterImageUrl;
  bool _loadingImage = true;
  bool _imageError = false;
  bool _isSharing = false;
  int? _pendingMilestone;
  bool _milestoneDismissed = false;

  RenderResultData? _data;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // רק בפעם הראשונה — לא רוצים להריץ שוב בכל rebuild.
    if (_data == null) {
      final extra = GoRouterState.of(context).extra;
      if (extra is RenderResultData) {
        _data = extra;
        _resolveAfterImage();
        _checkMilestone();
      }
    }
  }

  Future<void> _resolveAfterImage() async {
    final data = _data;
    if (data == null) return;
    setState(() {
      _loadingImage = true;
      _imageError = false;
    });
    try {
      final path = data.outcome.afterImagePath;
      final url = path != null
          ? await ref.read(renderServiceProvider).signedUrlFor(path)
          : data.outcome.fallbackUrl;
      if (!mounted) return;
      if (url == null) {
        setState(() {
          _loadingImage = false;
          _imageError = true;
        });
        return;
      }
      setState(() {
        _afterImageUrl = url;
        _loadingImage = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingImage = false;
        _imageError = true;
      });
    }
  }

  Future<void> _checkMilestone() async {
    try {
      final milestone =
          await ref.read(feedbackRepositoryProvider).pendingMilestone();
      if (mounted && milestone != null) {
        setState(() => _pendingMilestone = milestone);
      }
    } catch (_) {
      // לא קריטי — פשוט לא נציג את הכרטיס.
    }
  }

  Future<File> _downloadToTemp(String url, String filename) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      // צוברים את כל ה-chunks מהתגובה בעצמנו — פשוט ואמין, בלי תלות
      // בעזרי Flutter שיכולים להשתנות בין גרסאות SDK.
      final chunks = await response.toList();
      final bytes = chunks.expand((chunk) => chunk).toList();
      final file = File('${Directory.systemTemp.path}/$filename');
      await file.writeAsBytes(bytes);
      return file;
    } finally {
      client.close();
    }
  }

  Future<void> _shareResult() async {
    final url = _afterImageUrl;
    if (url == null || _isSharing) return;
    setState(() => _isSharing = true);
    try {
      final renderId = _data?.outcome.renderId ?? 'shift';
      final file = await _downloadToTemp(url, 'shift_$renderId.jpg');
      if (!mounted) return;
      await Share.shareXFiles([XFile(file.path)], text: 'SHIFT');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('result_screen.share_error'.tr())),
        );
      }
    } finally {
      if (mounted) setState(() => _isSharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text('result_screen.app_title'.tr()),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: data == null
            ? _NoDataView(onBackHome: () => context.go(AppRoutes.home))
            : Column(
                children: [
                  marquee.when(
                    data: (messages) => MarqueeBar(
                      messages: messages.map((m) => m.message).toList(),
                    ),
                    loading: () => const SizedBox.shrink(),
                    error: (_, __) => const SizedBox.shrink(),
                  ),
                  if (_pendingMilestone != null && !_milestoneDismissed)
                    _MilestoneCard(
                      milestone: _pendingMilestone!,
                      onDone: () => setState(() => _milestoneDismissed = true),
                    ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(20),
                      children: [
                        Text(
                          'result_screen.title'.tr(),
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 16),
                        _buildImageArea(data),
                        const SizedBox(height: 24),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed:
                                    _afterImageUrl == null || _isSharing
                                        ? null
                                        : _shareResult,
                                icon: const Icon(Icons.download_outlined),
                                label: Text('result_screen.save_button'.tr()),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed:
                                    _afterImageUrl == null || _isSharing
                                        ? null
                                        : _shareResult,
                                icon: const Icon(Icons.ios_share),
                                label:
                                    Text('result_screen.share_button'.tr()),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.go(AppRoutes.home),
                            child: Text(
                                'result_screen.design_again_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.push(AppRoutes.gallery),
                            child: Text(
                                'result_screen.view_gallery_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 32),
                        const Divider(),
                        const SizedBox(height: 16),
                        _RatingArea(source: ReviewSource.resultScreen),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildImageArea(RenderResultData data) {
    if (_loadingImage) {
      return const AspectRatio(
        aspectRatio: 4 / 3,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_imageError || _afterImageUrl == null) {
      return AspectRatio(
        aspectRatio: 4 / 3,
        child: Container(
          decoration: BoxDecoration(
            color: context.palette.accentSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.broken_image_outlined, size: 40),
              const SizedBox(height: 8),
              Text('result_screen.image_error'.tr()),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _resolveAfterImage,
                child: Text('result_screen.retry_button'.tr()),
              ),
            ],
          ),
        ),
      );
    }

    final beforePath = data.beforeLocalImagePath;
    final beforeFile = beforePath != null ? File(beforePath) : null;
    final beforeExists = beforeFile != null && beforeFile.existsSync();

    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: beforeExists
          ? _BeforeAfterSlider(
              beforeImage: Image.file(beforeFile, fit: BoxFit.cover),
              afterImage: Image.network(_afterImageUrl!, fit: BoxFit.cover),
            )
          : AspectRatio(
              aspectRatio: 4 / 3,
              child: Image.network(_afterImageUrl!, fit: BoxFit.cover),
            ),
    );
  }
}

class _NoDataView extends StatelessWidget {
  final VoidCallback onBackHome;
  const _NoDataView({required this.onBackHome});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.image_not_supported_outlined,
                size: 48, color: context.palette.inkFaint),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: onBackHome,
              child: Text('result_screen.design_again_button'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}

/// סליידר השוואה — גוררים אופקית כדי לחשוף יותר/פחות מתמונת ה"לפני" מעל
/// תמונת ה"אחרי". תמיד נע משמאל לימין ויזואלית (כמו הפס הנייד — מוסכם
/// עם ירון שרכיבי תנועה לא חייבים לעקוב אחרי כיוון הקריאה).
class _BeforeAfterSlider extends StatefulWidget {
  final Widget beforeImage;
  final Widget afterImage;

  const _BeforeAfterSlider({
    required this.beforeImage,
    required this.afterImage,
  });

  @override
  State<_BeforeAfterSlider> createState() => _BeforeAfterSliderState();
}

class _BeforeAfterSliderState extends State<_BeforeAfterSlider> {
  double _fraction = 0.5;

  void _updateFraction(double dx, double width) {
    setState(() {
      _fraction = (dx / width).clamp(0.0, 1.0);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 4 / 3,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          return GestureDetector(
            onHorizontalDragUpdate: (details) {
              final box = context.findRenderObject() as RenderBox;
              final local = box.globalToLocal(details.globalPosition);
              _updateFraction(local.dx, width);
            },
            onTapDown: (details) {
              final box = context.findRenderObject() as RenderBox;
              final local = box.globalToLocal(details.globalPosition);
              _updateFraction(local.dx, width);
            },
            child: Stack(
              fit: StackFit.expand,
              children: [
                Positioned.fill(child: widget.afterImage),
                ClipRect(
                  clipper: _LeftClipper(fraction: _fraction),
                  child: widget.beforeImage,
                ),
                Positioned(
                  left: (width * _fraction) - 1,
                  top: 0,
                  bottom: 0,
                  child: Container(width: 2, color: Colors.white),
                ),
                Positioned(
                  left: (width * _fraction) - 16,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.swap_horiz,
                          size: 18, color: Colors.black87),
                    ),
                  ),
                ),
                Positioned(
                  right: 10,
                  top: 10,
                  child: _tag(context, 'result_screen.after_label'.tr()),
                ),
                Positioned(
                  left: 10,
                  top: 10,
                  child: _tag(context, 'result_screen.before_label'.tr()),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _tag(BuildContext context, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text,
          style: const TextStyle(color: Colors.white, fontSize: 11)),
    );
  }
}

class _LeftClipper extends CustomClipper<Rect> {
  final double fraction;
  const _LeftClipper({required this.fraction});

  @override
  Rect getClip(Size size) => Rect.fromLTWH(0, 0, size.width * fraction, size.height);

  @override
  bool shouldReclip(covariant _LeftClipper oldClipper) =>
      oldClipper.fraction != fraction;
}

/// כרטיס אבן-דרך משוב — קטן, לא חוסם, מעל התוכן. מוצג פעם אחת בלבד לכל
/// סף (2/10/20), נקבע ע"י `FeedbackRepository.pendingMilestone()`.
class _MilestoneCard extends ConsumerStatefulWidget {
  final int milestone;
  final VoidCallback onDone;

  const _MilestoneCard({required this.milestone, required this.onDone});

  @override
  ConsumerState<_MilestoneCard> createState() => _MilestoneCardState();
}

class _MilestoneCardState extends ConsumerState<_MilestoneCard> {
  MilestoneSatisfaction? _satisfaction;
  bool? _missingElements;
  final _missingController = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _missingController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final satisfaction = _satisfaction;
    if (satisfaction == null) return;
    setState(() => _sending = true);
    try {
      await ref.read(feedbackRepositoryProvider).submitMilestoneFeedback(
            milestone: widget.milestone,
            satisfaction: satisfaction,
            missingElements: _missingElements ?? false,
            missingElementsText: _missingController.text,
          );
    } catch (_) {
      // לא קריטי — לא חוסמים את המשתמש בגלל כשל בשליחת משוב.
    } finally {
      if (mounted) widget.onDone();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('result_screen.milestone_q1'.tr(),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: Text('result_screen.milestone_very_good'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.veryGood,
                  onSelected: (_) => setState(
                      () => _satisfaction = MilestoneSatisfaction.veryGood),
                ),
                ChoiceChip(
                  label: Text('result_screen.milestone_ok'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.ok,
                  onSelected: (_) =>
                      setState(() => _satisfaction = MilestoneSatisfaction.ok),
                ),
                ChoiceChip(
                  label: Text('result_screen.milestone_not_great'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.notGreat,
                  onSelected: (_) => setState(
                      () => _satisfaction = MilestoneSatisfaction.notGreat),
                ),
              ],
            ),
            if (_satisfaction != null) ...[
              const SizedBox(height: 16),
              Text('result_screen.milestone_q2'.tr(),
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: Text('result_screen.milestone_yes'.tr()),
                    selected: _missingElements == true,
                    onSelected: (_) =>
                        setState(() => _missingElements = true),
                  ),
                  ChoiceChip(
                    label: Text('result_screen.milestone_no'.tr()),
                    selected: _missingElements == false,
                    onSelected: (_) {
                      setState(() => _missingElements = false);
                      _submit();
                    },
                  ),
                ],
              ),
            ],
            if (_missingElements == true) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _missingController,
                maxLines: 2,
                decoration: InputDecoration(
                  hintText: 'result_screen.milestone_missing_hint'.tr(),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _sending ? null : _submit,
                  child: Text('result_screen.milestone_send'.tr()),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// אזור דירוג קבוע — כוכבים + טקסט חופשי אופציונלי. אפשר לשלוח כמה
/// פעמים שרוצים (בניגוד לכרטיס אבן-הדרך, שחד-פעמי לכל סף).
class _RatingArea extends ConsumerStatefulWidget {
  final ReviewSource source;
  const _RatingArea({required this.source});

  @override
  ConsumerState<_RatingArea> createState() => _RatingAreaState();
}

class _RatingAreaState extends ConsumerState<_RatingArea> {
  int _stars = 0;
  final _textController = TextEditingController();
  bool _sending = false;
  bool _sent = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_stars == 0 || _sending) return;
    setState(() => _sending = true);
    try {
      await ref.read(feedbackRepositoryProvider).submitReview(
            stars: _stars,
            reviewText: _textController.text,
            source: widget.source,
          );
      if (mounted) setState(() => _sent = true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('result_screen.share_error'.tr())),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_sent) {
      return Center(
        child: Text(
          'result_screen.rating_thanks'.tr(),
          style: TextStyle(color: context.palette.inkSoft),
        ),
      );
    }

    return Column(
      children: [
        Text('result_screen.rating_title'.tr(),
            style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(5, (i) {
            final filled = i < _stars;
            return IconButton(
              onPressed: () => setState(() => _stars = i + 1),
              icon: Icon(
                filled ? Icons.star : Icons.star_border,
                color: Theme.of(context).colorScheme.primary,
              ),
            );
          }),
        ),
        if (_stars > 0) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: TextField(
              controller: _textController,
              maxLines: 2,
              decoration: InputDecoration(
                hintText: 'result_screen.rating_hint'.tr(),
                border: const OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _sending ? null : _submit,
              child: Text('result_screen.rating_submit'.tr()),
            ),
          ),
        ],
      ],
    );
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/assets/translations/he.json'
cat > '/workspaces/shift-app/shift_app/assets/translations/he.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "מחובר בהצלחה ל-Supabase",
    "not_connected": "אין חיבור לשרת",
    "placeholder_note": "שלד פרויקט (שלב 2) — מסכי האפליקציה האמיתיים יתווספו בשלבים הבאים"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "מה מעצבים היום?",
    "subtitle": "בחר את סוג החדר ומה תרצה לשנות בו",
    "room_section": "סוג החדר",
    "groups_section": "מה תרצה לעצב?",
    "select_room_first": "קודם בוחרים סוג חדר",
    "continue_button": "המשך לבחירת חומרים",
    "credits_free": "{} הדמיות חינם נותרו",
    "credits_subscription": "מנוי פעיל — {} הדמיות נותרו החודש",
    "credits_exhausted": "המכסה נגמרה"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "בחירת חומרים",
    "no_items": "אין פריטים זמינים בקטגוריה הזו לסוג החדר שנבחר",
    "continue_button": "המשך להעלאת תמונה",
    "note_hint": "הוסף הערה חופשית לבחירה הזו (רשות)",
    "note_field_hint": "לדוגמה: רק על קיר אחד, לא בכל החדר",
    "note_save": "שמירה"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "העלה תמונה שתרצה לעצב",
    "subtitle": "כדי שנוכל להראות לך איך זה נראה אצלך",
    "shift_button": "SHIFT",
    "eta_note": "יצירת ההדמיה תיקח עד כ-30 שניות",
    "take_photo": "צלם תמונה",
    "choose_gallery": "בחר מהגלריה",
    "tap_to_pick": "גע כדי לצלם או לבחור מהגלריה",
    "uploaded_ok": "התמונה הועלתה בהצלחה",
    "file_hint": "JPG · PNG · עד 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "יוצרים את ההדמיה שלך",
    "eta_note": "לוקח בדרך כלל עד כ-30 שניות",
    "leave_ok_note": "אפשר לצאת מהמסך בלי חשש — ההדמיה תמשיך ברקע, ותופיע כאן ובגלריה שלך ברגע שתהיה מוכנה.",
    "resuming_note": "ההדמיה הקודמת שלך עדיין הייתה בעיבוד — ממשיכים לעקוב אחריה בדיוק מאיפה שהפסקנו.",
    "still_working_title": "עדיין עובדים על זה",
    "still_working_body": "זה לוקח קצת יותר זמן מהרגיל, אבל שום דבר לא אבד. אפשר לחזור למסך הבית — ההדמיה תופיע שם אוטומטית ברגע שתהיה מוכנה, וגם בגלריה שלך.",
    "still_working_wait_button": "להמשיך להמתין",
    "quota_title": "נגמרה המכסה",
    "quota_body": "אין לך כרגע הדמיות זמינות. אפשר לשדרג למנוי כדי להמשיך.",
    "quota_button": "חזרה למסך הבית",
    "error_title": "משהו השתבש",
    "retry_button": "נסה שוב",
    "back_button": "חזרה"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "ההדמיה שלך מוכנה!",
    "before_label": "לפני",
    "after_label": "אחרי",
    "save_button": "שמירה ב-HD",
    "share_button": "שיתוף בוואטסאפ",
    "design_again_button": "עיצוב נוסף לחדר הזה",
    "view_gallery_button": "לצפייה בכל ההדמיות שלי",
    "image_error": "לא הצלחנו לטעון את התמונה",
    "retry_button": "נסה שוב",
    "share_error": "לא הצלחנו לשתף את התמונה",
    "rating_title": "איך היה?",
    "rating_hint": "ספר לנו עוד (רשות)",
    "rating_submit": "שליחה",
    "rating_thanks": "תודה על המשוב!",
    "milestone_q1": "מה דעתך על האפליקציה והשימוש שלך עד כה?",
    "milestone_very_good": "טוב מאוד",
    "milestone_ok": "בסדר",
    "milestone_not_great": "לא משהו",
    "milestone_q2": "האם היו חסרים לך אלמנטים מסוימים?",
    "milestone_yes": "כן",
    "milestone_no": "לא",
    "milestone_missing_hint": "נשמח לעדכן את המערכת — מה חסר לך?",
    "milestone_send": "שליחה"
  },
  "coupon_screen": {
    "app_title": "קוד קופון",
    "title": "יש לך קוד קופון?",
    "subtitle": "הזן את הקוד שקיבלת ותראה מיד אם הוא בתוקף",
    "field_hint": "לדוגמה: DANI-GIFT-1M",
    "redeem_button": "מימוש הקוד",
    "success_granted_title": "מזל טוב!",
    "success_granted_body": "הקוד מומש בהצלחה. המנוי שלך ({}) בתוקף עד {}.",
    "success_tracked": "הקוד נרשם בהצלחה, תודה!",
    "error_not_found": "קוד קופון לא נמצא. בדוק שהקלדת נכון ונסה שוב.",
    "error_inactive": "קוד הקופון הזה כבר לא פעיל.",
    "error_expired": "תוקף הקוד הזה פג.",
    "error_limit": "הקוד הזה כבר מוצה במלואו.",
    "error_already_redeemed": "כבר מימשת את הקוד הזה בעבר.",
    "error_generic": "קרה משהו לא צפוי. אפשר לנסות שוב.",
    "tier_monthly": "חודשי",
    "tier_annual": "שנתי",
    "tier_annual_premium": "שנתי פרימיום",
    "entry_tooltip": "יש לי קוד קופון"
  },
  "gallery_screen": {
    "app_title": "הגלריה שלי",
    "entry_tooltip": "הגלריה שלי",
    "empty_title": "עדיין אין כאן כלום",
    "empty_body": "כל הדמיה שתיצור תישמר כאן אוטומטית, כדי שתוכל לחזור אליה בכל זמן.",
    "load_error": "לא הצלחנו לטעון את הגלריה",
    "retry_button": "נסה שוב",
    "share_button": "שיתוף",
    "delete_button": "מחיקה",
    "delete_confirm_title": "למחוק את התמונה?",
    "delete_confirm_body": "הפעולה לא הפיכה — התמונה תימחק לצמיתות מהגלריה שלך.",
    "delete_confirm_yes": "מחיקה",
    "delete_confirm_cancel": "ביטול",
    "delete_error": "המחיקה נכשלה, נסה שוב"
  },
  "language": {
    "select": "בחר שפה",
    "he": "עברית",
    "ar": "ערבית",
    "ru": "רוסית",
    "en": "אנגלית"
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/assets/translations/en.json'
cat > '/workspaces/shift-app/shift_app/assets/translations/en.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Connected to Supabase successfully",
    "not_connected": "No connection to the server",
    "placeholder_note": "Project scaffold (stage 2) — real app screens will be added in later stages"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "What are we designing today?",
    "subtitle": "Choose the room type and what you'd like to change",
    "room_section": "Room type",
    "groups_section": "What would you like to design?",
    "select_room_first": "Choose a room type first",
    "continue_button": "Continue to materials",
    "credits_free": "{} free renders left",
    "credits_subscription": "Active subscription — {} renders left this month",
    "credits_exhausted": "You've used your quota"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "Choose materials",
    "no_items": "No items available in this category for the selected room",
    "continue_button": "Continue to upload photo",
    "note_hint": "Add an optional note for this choice",
    "note_field_hint": "e.g. only on one wall, not the whole room",
    "note_save": "Save"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "Upload a photo to design",
    "subtitle": "So we can show you what it looks like at your place",
    "shift_button": "SHIFT",
    "eta_note": "Creating the render takes up to about 30 seconds",
    "take_photo": "Take a photo",
    "choose_gallery": "Choose from gallery",
    "tap_to_pick": "Tap to take a photo or choose from gallery",
    "uploaded_ok": "Photo uploaded successfully",
    "file_hint": "JPG · PNG · up to 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Creating your render",
    "eta_note": "Usually takes up to about 30 seconds",
    "leave_ok_note": "It's fine to leave this screen — your render keeps going in the background, and will show up here and in your gallery as soon as it's ready.",
    "resuming_note": "Your previous render was still processing — picking up right where we left off.",
    "still_working_title": "Still working on it",
    "still_working_body": "This is taking a bit longer than usual, but nothing was lost. You can go back to the home screen — your render will appear there automatically once it's ready, and in your gallery too.",
    "still_working_wait_button": "Keep waiting",
    "quota_title": "You've used your quota",
    "quota_body": "You don't have any renders available right now. You can upgrade to a subscription to continue.",
    "quota_button": "Back to home",
    "error_title": "Something went wrong",
    "retry_button": "Try again",
    "back_button": "Back"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "Your design is ready!",
    "before_label": "Before",
    "after_label": "After",
    "save_button": "Save HD",
    "share_button": "Share on WhatsApp",
    "design_again_button": "Design another for this room",
    "view_gallery_button": "View all my renders",
    "image_error": "We couldn't load the image",
    "retry_button": "Try again",
    "share_error": "We couldn't share the image",
    "rating_title": "How was it?",
    "rating_hint": "Tell us more (optional)",
    "rating_submit": "Submit",
    "rating_thanks": "Thanks for the feedback!",
    "milestone_q1": "What do you think of the app and your experience so far?",
    "milestone_very_good": "Very good",
    "milestone_ok": "OK",
    "milestone_not_great": "Not great",
    "milestone_q2": "Was anything missing?",
    "milestone_yes": "Yes",
    "milestone_no": "No",
    "milestone_missing_hint": "We'd love to know — what's missing?",
    "milestone_send": "Send"
  },
  "coupon_screen": {
    "app_title": "Coupon Code",
    "title": "Have a coupon code?",
    "subtitle": "Enter your code below to see if it's valid",
    "field_hint": "e.g. DANI-GIFT-1M",
    "redeem_button": "Redeem code",
    "success_granted_title": "Congratulations!",
    "success_granted_body": "Your code was redeemed successfully. Your {} subscription is active until {}.",
    "success_tracked": "Your code was recorded — thank you!",
    "error_not_found": "Coupon code not found. Check the spelling and try again.",
    "error_inactive": "This coupon code is no longer active.",
    "error_expired": "This coupon code has expired.",
    "error_limit": "This coupon code has already been fully used.",
    "error_already_redeemed": "You've already redeemed this code.",
    "error_generic": "Something went wrong. Please try again.",
    "tier_monthly": "Monthly",
    "tier_annual": "Annual",
    "tier_annual_premium": "Annual Premium",
    "entry_tooltip": "I have a coupon code"
  },
  "gallery_screen": {
    "app_title": "My Gallery",
    "entry_tooltip": "My gallery",
    "empty_title": "Nothing here yet",
    "empty_body": "Every render you create is saved here automatically, so you can come back to it anytime.",
    "load_error": "We couldn't load your gallery",
    "retry_button": "Try again",
    "share_button": "Share",
    "delete_button": "Delete",
    "delete_confirm_title": "Delete this image?",
    "delete_confirm_body": "This can't be undone — the image will be permanently deleted from your gallery.",
    "delete_confirm_yes": "Delete",
    "delete_confirm_cancel": "Cancel",
    "delete_error": "Delete failed, please try again"
  },
  "language": {
    "select": "Select language",
    "he": "Hebrew",
    "ar": "Arabic",
    "ru": "Russian",
    "en": "English"
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/assets/translations/ar.json'
cat > '/workspaces/shift-app/shift_app/assets/translations/ar.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "تم الاتصال بنجاح بـ Supabase",
    "not_connected": "لا يوجد اتصال بالخادم",
    "placeholder_note": "هيكل المشروع (المرحلة 2) — سيتم إضافة شاشات التطبيق الفعلية في المراحل القادمة"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "ماذا نصمم اليوم؟",
    "subtitle": "اختر نوع الغرفة وما تريد تغييره فيها",
    "room_section": "نوع الغرفة",
    "groups_section": "ماذا تريد أن تصمم؟",
    "select_room_first": "اختر نوع الغرفة أولاً",
    "continue_button": "متابعة لاختيار المواد",
    "credits_free": "{} صور مجانية متبقية",
    "credits_subscription": "اشتراك نشط — {} صور متبقية هذا الشهر",
    "credits_exhausted": "لقد استنفدت حصتك"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "اختيار المواد",
    "no_items": "لا توجد عناصر متاحة في هذه الفئة لنوع الغرفة المختار",
    "continue_button": "متابعة لرفع الصورة",
    "note_hint": "أضف ملاحظة اختيارية لهذا الاختيار",
    "note_field_hint": "مثال: فقط على جدار واحد، وليس الغرفة كلها",
    "note_save": "حفظ"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "ارفع صورة تريد تصميمها",
    "subtitle": "حتى نتمكن من إظهار كيف سيبدو الأمر عندك",
    "shift_button": "SHIFT",
    "eta_note": "إنشاء الصورة قد يستغرق حتى 30 ثانية",
    "take_photo": "التقط صورة",
    "choose_gallery": "اختر من المعرض",
    "tap_to_pick": "اضغط لالتقاط صورة أو الاختيار من المعرض",
    "uploaded_ok": "تم رفع الصورة بنجاح",
    "file_hint": "JPG · PNG · حتى 15 ميغابايت"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "جارٍ إنشاء التصميم الخاص بك",
    "eta_note": "يستغرق عادةً حتى 30 ثانية",
    "leave_ok_note": "يمكنك مغادرة هذه الشاشة بلا قلق — التصميم يستمر في الخلفية، وسيظهر هنا وفي معرضك بمجرد أن يكون جاهزاً.",
    "resuming_note": "تصميمك السابق كان لا يزال قيد المعالجة — نواصل متابعته من حيث توقفنا بالضبط.",
    "still_working_title": "لا زلنا نعمل على ذلك",
    "still_working_body": "هذا يستغرق وقتاً أطول قليلاً من المعتاد، لكن لم يُفقد شيء. يمكنك العودة للشاشة الرئيسية — سيظهر التصميم هناك تلقائياً بمجرد جاهزيته، وأيضاً في معرضك.",
    "still_working_wait_button": "الاستمرار بالانتظار",
    "quota_title": "لقد استنفدت حصتك",
    "quota_body": "لا توجد لديك صور متاحة حالياً. يمكنك الترقية إلى اشتراك للمتابعة.",
    "quota_button": "العودة للشاشة الرئيسية",
    "error_title": "حدث خطأ ما",
    "retry_button": "حاول مرة أخرى",
    "back_button": "رجوع"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "تصميمك جاهز!",
    "before_label": "قبل",
    "after_label": "بعد",
    "save_button": "حفظ بجودة HD",
    "share_button": "مشاركة عبر واتساب",
    "design_again_button": "تصميم آخر لهذه الغرفة",
    "view_gallery_button": "عرض كل تصاميمي",
    "image_error": "تعذّر تحميل الصورة",
    "retry_button": "حاول مرة أخرى",
    "share_error": "تعذّرت مشاركة الصورة",
    "rating_title": "كيف كانت التجربة؟",
    "rating_hint": "أخبرنا المزيد (اختياري)",
    "rating_submit": "إرسال",
    "rating_thanks": "شكراً على ملاحظاتك!",
    "milestone_q1": "ما رأيك في التطبيق وتجربتك حتى الآن؟",
    "milestone_very_good": "جيد جداً",
    "milestone_ok": "جيد",
    "milestone_not_great": "ليس رائعاً",
    "milestone_q2": "هل كان هناك عناصر ناقصة؟",
    "milestone_yes": "نعم",
    "milestone_no": "لا",
    "milestone_missing_hint": "يسعدنا تحديث النظام — ما الذي ينقصك؟",
    "milestone_send": "إرسال"
  },
  "coupon_screen": {
    "app_title": "رمز الكوبون",
    "title": "هل لديك رمز كوبون؟",
    "subtitle": "أدخل الرمز الذي حصلت عليه لترى إذا كان صالحاً",
    "field_hint": "مثال: DANI-GIFT-1M",
    "redeem_button": "استخدام الرمز",
    "success_granted_title": "مبروك!",
    "success_granted_body": "تم استخدام الرمز بنجاح. اشتراكك ({}) ساري حتى {}.",
    "success_tracked": "تم تسجيل الرمز بنجاح، شكراً لك!",
    "error_not_found": "رمز الكوبون غير موجود. تحقق من الإدخال وحاول مرة أخرى.",
    "error_inactive": "رمز الكوبون هذا لم يعد نشطاً.",
    "error_expired": "انتهت صلاحية هذا الرمز.",
    "error_limit": "تم استخدام هذا الرمز بالكامل بالفعل.",
    "error_already_redeemed": "لقد استخدمت هذا الرمز من قبل.",
    "error_generic": "حدث خطأ غير متوقع. حاول مرة أخرى.",
    "tier_monthly": "شهري",
    "tier_annual": "سنوي",
    "tier_annual_premium": "سنوي مميز",
    "entry_tooltip": "لدي رمز كوبون"
  },
  "gallery_screen": {
    "app_title": "معرضي",
    "entry_tooltip": "معرضي",
    "empty_title": "لا يوجد شيء هنا بعد",
    "empty_body": "كل تصميم تنشئه يُحفظ هنا تلقائياً، حتى تتمكن من العودة إليه في أي وقت.",
    "load_error": "تعذّر تحميل المعرض",
    "retry_button": "حاول مرة أخرى",
    "share_button": "مشاركة",
    "delete_button": "حذف",
    "delete_confirm_title": "حذف هذه الصورة؟",
    "delete_confirm_body": "لا يمكن التراجع عن هذا — ستُحذف الصورة نهائياً من معرضك.",
    "delete_confirm_yes": "حذف",
    "delete_confirm_cancel": "إلغاء",
    "delete_error": "فشل الحذف، حاول مرة أخرى"
  },
  "language": {
    "select": "اختر اللغة",
    "he": "العبرية",
    "ar": "العربية",
    "ru": "الروسية",
    "en": "الإنجليزية"
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/assets/translations/ru.json'
cat > '/workspaces/shift-app/shift_app/assets/translations/ru.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Успешно подключено к Supabase",
    "not_connected": "Нет подключения к серверу",
    "placeholder_note": "Каркас проекта (этап 2) — реальные экраны приложения будут добавлены на следующих этапах"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "Что оформляем сегодня?",
    "subtitle": "Выберите тип комнаты и что хотите изменить",
    "room_section": "Тип комнаты",
    "groups_section": "Что вы хотите изменить?",
    "select_room_first": "Сначала выберите тип комнаты",
    "continue_button": "Далее к выбору материалов",
    "credits_free": "Осталось бесплатных рендеров: {}",
    "credits_subscription": "Активная подписка — осталось {} в этом месяце",
    "credits_exhausted": "Лимит исчерпан"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "Выбор материалов",
    "no_items": "Нет доступных вариантов в этой категории для выбранной комнаты",
    "continue_button": "Далее к загрузке фото",
    "note_hint": "Добавьте необязательное примечание к этому выбору",
    "note_field_hint": "например: только на одной стене, не по всей комнате",
    "note_save": "Сохранить"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "Загрузите фото для дизайна",
    "subtitle": "Чтобы мы могли показать, как это будет выглядеть у вас",
    "shift_button": "SHIFT",
    "eta_note": "Создание рендера может занять до 30 секунд",
    "take_photo": "Сделать фото",
    "choose_gallery": "Выбрать из галереи",
    "tap_to_pick": "Нажмите, чтобы сделать фото или выбрать из галереи",
    "uploaded_ok": "Фото успешно загружено",
    "file_hint": "JPG · PNG · до 15МБ"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Создаём ваш рендер",
    "eta_note": "Обычно занимает до 30 секунд",
    "leave_ok_note": "Можно спокойно покинуть этот экран — рендер продолжит создаваться в фоне и появится здесь и в вашей галерее, как только будет готов.",
    "resuming_note": "Ваш предыдущий рендер всё ещё обрабатывался — продолжаем следить за ним с того же места.",
    "still_working_title": "Всё ещё работаем над этим",
    "still_working_body": "Это занимает немного больше времени, чем обычно, но ничего не потеряно. Можно вернуться на главный экран — рендер появится там автоматически, как только будет готов, а также в вашей галерее.",
    "still_working_wait_button": "Продолжить ждать",
    "quota_title": "Лимит исчерпан",
    "quota_body": "Сейчас у вас нет доступных рендеров. Вы можете оформить подписку, чтобы продолжить.",
    "quota_button": "На главный экран",
    "error_title": "Что-то пошло не так",
    "retry_button": "Попробовать снова",
    "back_button": "Назад"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "Ваш дизайн готов!",
    "before_label": "До",
    "after_label": "После",
    "save_button": "Сохранить в HD",
    "share_button": "Поделиться в WhatsApp",
    "design_again_button": "Ещё один дизайн для этой комнаты",
    "view_gallery_button": "Смотреть все мои рендеры",
    "image_error": "Не удалось загрузить изображение",
    "retry_button": "Попробовать снова",
    "share_error": "Не удалось поделиться изображением",
    "rating_title": "Как вам?",
    "rating_hint": "Расскажите подробнее (необязательно)",
    "rating_submit": "Отправить",
    "rating_thanks": "Спасибо за отзыв!",
    "milestone_q1": "Что вы думаете о приложении и своём опыте использования?",
    "milestone_very_good": "Очень хорошо",
    "milestone_ok": "Нормально",
    "milestone_not_great": "Не очень",
    "milestone_q2": "Чего-то не хватало?",
    "milestone_yes": "Да",
    "milestone_no": "Нет",
    "milestone_missing_hint": "Мы хотим улучшить систему — чего вам не хватает?",
    "milestone_send": "Отправить"
  },
  "coupon_screen": {
    "app_title": "Промокод",
    "title": "Есть промокод?",
    "subtitle": "Введите код, чтобы проверить, действителен ли он",
    "field_hint": "Например: DANI-GIFT-1M",
    "redeem_button": "Активировать код",
    "success_granted_title": "Поздравляем!",
    "success_granted_body": "Код успешно активирован. Ваша подписка ({}) действует до {}.",
    "success_tracked": "Код успешно зарегистрирован, спасибо!",
    "error_not_found": "Промокод не найден. Проверьте правильность ввода и попробуйте снова.",
    "error_inactive": "Этот промокод больше не активен.",
    "error_expired": "Срок действия этого кода истёк.",
    "error_limit": "Этот код уже полностью использован.",
    "error_already_redeemed": "Вы уже использовали этот код.",
    "error_generic": "Произошла непредвиденная ошибка. Попробуйте снова.",
    "tier_monthly": "Ежемесячная",
    "tier_annual": "Годовая",
    "tier_annual_premium": "Годовая Премиум",
    "entry_tooltip": "У меня есть промокод"
  },
  "gallery_screen": {
    "app_title": "Моя галерея",
    "entry_tooltip": "Моя галерея",
    "empty_title": "Здесь пока пусто",
    "empty_body": "Каждый созданный вами рендер сохраняется здесь автоматически, чтобы вы могли вернуться к нему в любое время.",
    "load_error": "Не удалось загрузить галерею",
    "retry_button": "Попробовать снова",
    "share_button": "Поделиться",
    "delete_button": "Удалить",
    "delete_confirm_title": "Удалить это изображение?",
    "delete_confirm_body": "Это действие необратимо — изображение будет удалено из вашей галереи навсегда.",
    "delete_confirm_yes": "Удалить",
    "delete_confirm_cancel": "Отмена",
    "delete_error": "Не удалось удалить, попробуйте снова"
  },
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app_stage5/supabase/functions/generate-render/index.ts'
cat > '/workspaces/shift-app/shift_app_stage5/supabase/functions/generate-render/index.ts' << 'SHIFTEOF'
// SHIFT — Edge Function ‏`generate-render`
//
// ‏🔑 **זו הנקודה היחידה במערכת שמחזיקה את מפתח ה-Replicate ואת ספירת
// הקרדיטים.** המפתח לעולם לא נמצא באפליקציה: כל מי שמוריד APK יכול לפרק
// אותו ולחלץ ממנו כל מחרוזת שמוטמעת בקוד.
//
// זרימה (סשן 9 — מפוצלת לשני חלקים, ראו ההסבר המלא למטה):
//   1. אימות המשתמש מול ה-JWT שנשלח.
//   2. ולידציה של הקלט (מזהי פריטים בלבד — לא פרומפט מוכן).
//   3. עיבוד הערות טקסט חופשי לאנגלית.
//   4. בניית הפרומפט **בשרת**, מהמילון של השרת.
//   5. צריכת קרדיט אטומית + רישום ההדמיה + קישור חתום לתמונת המקור.
//   6. **מחזירים תשובה ללקוח כאן, מיד** — renderId + status:"processing".
//   7. **ברקע** (אחרי שהתשובה כבר נשלחה): קריאה ל-Replicate, שמירת
//      התוצאה. בכישלון — החזר קרדיט.
//
// פריסה:  supabase functions deploy generate-render
// סודות:  supabase secrets set REPLICATE_API_TOKEN=...
//
// ============================================================================
// סשן 9 — שינוי ארכיטקטוני: מסונכרן (Prefer: wait) לאסינכרוני (רקע + תשאול)
// ============================================================================
// **הבעיה שזה פותר:** בעבר הפונקציה הזו הייתה מחזיקה את הבקשה פתוחה
// 18-30 שניות (Prefer: wait) עד שהתמונה הייתה מוכנה, ורק אז עונה ללקוח.
// זה עבד מצוין בצד השרת (מאומת שוב ושוב: HTTP 200, ~18.5 שניות ריצה,
// ראו claude/27) — אבל בצד הלקוח, מערכת ההפעלה (אומת גם ב-MIUI/פוקו וגם
// בסמסונג, אצל שני משתמשים שונים) נוטה "להרוג" את האפליקציה ברקע בזמן
// שהיא ממתינה כל כך הרבה זמן לתשובה אחת, גם כשהיא פתוחה וממתינה מול
// המשתמש. התוצאה: השרת מסיים בהצלחה גמורה, אבל אין מי שיציג אותה
// למשתמש — "קפיצה למסך הבית" בלי להראות תוצאה.
//
// **הפתרון:** הפונקציה עונה ללקוח **כמעט מיד** אחרי שהיא רק *התחילה*
// לעבד (אחרי צריכת הקרדיט ורישום השורה ב-`renders`), ומחזירה רק
// `renderId`. הקריאה בפועל ל-Replicate ושמירת התוצאה ל-Storage קורות
// **אחרי** שהתשובה כבר נשלחה, בעזרת `EdgeRuntime.waitUntil()` — פיצ'ר
// של ה-Edge Runtime של Supabase (מבוסס Deno Deploy) שמאפשר להמשיך לרוץ
// ברקע אחרי שה-HTTP response כבר נשלח ללקוח, בדיוק בשביל המקרה הזה
// ("Background Tasks", ראו תיעוד Supabase). האפליקציה מצדה מתשאלת
// (`RenderService.checkStatus`) ישירות את טבלת `renders` כל 2 שניות עד
// שהסטטוס משתנה ל-succeeded/failed — לא צריך Edge Function נוספת לזה,
// ה-RLS הקיים כבר מתיר SELECT למשתמש על השורות של עצמו.
//
// **⚠️ חשוב לבדוק בפריסה הראשונה:** `EdgeRuntime.waitUntil` אמור לעבוד
// out-of-the-box בסביבת Supabase Edge Functions (זה בדיוק הפיצ'ר
// שהתיעוד הרשמי שלהם ממליץ עליו בשביל המקרה הזה בדיוק), אבל מעולם לא
// נבדק בפרויקט הזה בפועל — זה שינוי חדש. **בדיקת העשן הראשונה אחרי
// הפריסה חייבת לכלול**: יצירת הדמיה אמיתית ווידוא (דרך Logs/Invocations
// ב-Supabase) שה-console.log-ים של שלב 7 ואילך (למטה) אכן מופיעים
// *אחרי* שהתשובה הראשונה כבר חזרה ללקוח, ושה-renders.status אכן מתקדם
// בסוף ל-succeeded עם after_image_path תקין. אם מסיבה כלשהי הרקע לא
// רץ (Supabase Edge Runtime גרסה ישנה שלא תומכת עדיין, למשל) — הרשומה
// תישאר תקועה על "processing" לנצח וזה יופיע מיד בבדיקה הזו.
//
// המנגנון הקודם (רשת ביטחון try/catch, לוגים אבחוניים ממוספרים, נעילת
// גרסת Replicate) שנבנה בסשן 8 — כולו נשאר בדיוק כמו שהיה, רק עטוף
// עכשיו בפונקציית הרקע `finishRenderInBackground` במקום ב-handler הראשי.

import { createClient } from "jsr:@supabase/supabase-js@2";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { MATERIALS_BY_ID } from "../_shared/dictionary.ts";
import { buildRenderJob, PromptBuildError } from "../_shared/prompt_engine.ts";
import type { RenderJob, SelectionInput } from "../_shared/prompt_engine.ts";
import {
  MAX_NOTE_LENGTH,
  resolveFreeTextNotes,
} from "../_shared/note_resolver.ts";

// מסופק ע"י ה-Edge Runtime של Supabase בזמן ריצה (לא חלק מ-lib.deno.d.ts
// הרגיל) — ה-declare הזה רק אומר ל-TypeScript שהוא קיים, לא יוצר כלום.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// המודל שננעל בשלב 3. ראו claude/07.
//
// סשן 8: adirik/interior-design הוא מודל קהילתי (לא רשמי) בלי גרסת "latest"
// מסומנת — קריאה דרך /v1/models/{owner}/{name}/predictions (בלי version)
// מחזירה 404. חייבים לנעול גרסה מדויקת ולקרוא ל-/v1/predictions הקלאסי.
// ברירת המחדל למטה היא מחרוזת ה-version המדויקת שמופיעה בדוגמת ה-HTTP
// הרשמית בעמוד replicate.com/adirik/interior-design (אומת ידנית ב-3.9.2026
// אחרי שהגרסה הקודמת חדלה לעבוד) — אפשר לדרוס אותה בעתיד עם הסוד
// REPLICATE_MODEL_VERSION בלי לגעת בקוד, אם Replicate יפרסמו גרסה חדשה.
const REPLICATE_MODEL = "adirik/interior-design";
const REPLICATE_VERSION = Deno.env.get("REPLICATE_MODEL_VERSION") ??
  "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  roomTypeCode: string;
  selections: SelectionInput[];
  /** נתיב תמונת המקור ב-Storage, בתוך התיקייה של המשתמש. */
  beforeImagePath: string;
  /** שפת הממשק של הלקוח — לתיעוד בלבד. */
  languageCode?: string;
}

/** ולידציה של הקלט לפני שנוגעים בכסף או ברשת. */
function validate(body: unknown): RequestBody {
  if (typeof body !== "object" || body === null) {
    throw new PromptBuildError("גוף בקשה לא תקין");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.roomTypeCode !== "string") {
    throw new PromptBuildError("roomTypeCode חסר");
  }
  if (typeof b.beforeImagePath !== "string" || !b.beforeImagePath) {
    throw new PromptBuildError("beforeImagePath חסר");
  }
  if (!Array.isArray(b.selections) || b.selections.length === 0) {
    throw new PromptBuildError("selections חסר או ריק");
  }
  if (b.selections.length > 40) {
    throw new PromptBuildError("יותר מדי בחירות");
  }

  for (const s of b.selections) {
    if (typeof s?.itemId !== "string") {
      throw new PromptBuildError("selection ללא itemId");
    }
    for (const m of s.modifiers ?? []) {
      if (
        m?.kind === "freeText" &&
        (typeof m.rawText !== "string" || m.rawText.length > MAX_NOTE_LENGTH)
      ) {
        throw new PromptBuildError(
          `הערה חורגת מ-${MAX_NOTE_LENGTH} תווים`,
        );
      }
      // resolvedEn שמגיע מהלקוח נזרק — רק השרת ממלא אותו.
      if (m?.kind === "freeText") delete m.resolvedEn;
    }
  }

  return b as unknown as RequestBody;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const replicateToken = Deno.env.get("REPLICATE_API_TOKEN");
  if (!replicateToken) {
    console.error("REPLICATE_API_TOKEN חסר בסודות הפונקציה");
    return json({ error: "server_misconfigured" }, 500);
  }

  // --- 1. אימות ---------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  // לקוח שפועל בזהות המשתמש — כך ש-RLS ו-auth.uid() חלים כרגיל.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // --- 2. ולידציה ------------------------------------------------------
  let body: RequestBody;
  try {
    body = validate(await req.json());
  } catch (e) {
    return json({ error: "bad_request", detail: String(e) }, 400);
  }

  // התמונה חייבת לשבת בתיקייה של המשתמש עצמו.
  if (!body.beforeImagePath.startsWith(`${userId}/`)) {
    return json({ error: "forbidden_image_path" }, 403);
  }

  // --- מכאן ואילך: רשת ביטחון אחת סביב כל השלבים שנוגעים בכסף ---------
  // (השלבים שנוגעים ברשת/Replicate עברו לפונקציית הרקע למטה — ראו הסבר
  // בראש הקובץ. כאן נשאר רק מה שצריך לקרות *לפני* שעונים ללקוח: עיבוד
  // הערות, בניית פרומפט, צריכת קרדיט, רישום השורה, קישור חתום.)
  let renderId: string | undefined;
  let creditConsumed = false;

  try {
    // --- 3+4. עיבוד הערות ובניית הפרומפט --------------------------------
    console.log(`[${userId}] שלב 1: מתחיל עיבוד הערות ובניית פרומפט`);
    let job: RenderJob;
    try {
      const resolved = await resolveFreeTextNotes(
        body.selections,
        MATERIALS_BY_ID,
        replicateToken,
      );
      job = buildRenderJob(body.roomTypeCode, resolved);
    } catch (e) {
      if (e instanceof PromptBuildError) {
        return json({ error: "bad_selection", detail: e.message }, 400);
      }
      throw e; // שגיאה לא צפויה — תיתפס למטה.
    }
    console.log(`[${userId}] שלב 2: פרומפט נבנה בהצלחה`);

    // --- 5. צריכת קרדיט (אטומית) -----------------------------------------
    const { data: creditRows, error: creditErr } = await supabase
      .rpc("consume_render_credit");

    if (creditErr) {
      throw new Error(`consume_render_credit failed: ${creditErr.message}`);
    }
    console.log(`[${userId}] שלב 3: קרדיט נבדק/נצרך`);

    const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    if (!credit?.allowed) {
      return json({
        error: "quota_exhausted",
        reason: credit?.reason ?? "unknown",
        freeRemaining: credit?.free_remaining ?? 0,
      }, 402); // Payment Required — האפליקציה תפתח Paywall.
    }
    creditConsumed = true;

    // --- רישום ההדמיה לפני הקריאה, כדי שתמיד יהיה למה להחזיר קרדיט -------
    const { data: renderRow, error: insErr } = await supabase
      .from("renders")
      .insert({
        user_id: userId,
        room_type: body.roomTypeCode,
        category: job.prompt.includes("exterior") ? "exterior" : "interior",
        before_image_path: body.beforeImagePath,
        style_selections: job.resolvedSelections,
        prompt: job.prompt,
        negative_prompt: job.negativePrompt,
        prompt_strength: job.promptStrength,
        status: "processing",
        credit_source: credit.reason,
      })
      .select("id")
      .single();

    if (insErr || !renderRow) {
      throw new Error(`render insert failed: ${insErr?.message}`);
    }
    renderId = renderRow.id as string;
    console.log(`[${userId}] שלב 4: רשומת renders נוצרה, id=${renderId}`);

    // --- קישור חתום וזמני לתמונת המקור, כדי ש-Replicate יוכל להוריד
    // אותה מבלי שה-bucket יהיה ציבורי. נשאר סינכרוני (לפני שעונים ללקוח)
    // כי הוא מהיר, ואם הוא נכשל עדיף לדעת על כך מיד ולא להבטיח renderId
    // שלעולם לא יסתיים.
    console.log(`[${userId}] שלב 5: יוצר קישור חתום לתמונה`);
    const { data: signed, error: signErr } = await supabase.storage
      .from("renders")
      .createSignedUrl(body.beforeImagePath, 600);

    if (signErr || !signed?.signedUrl) {
      await supabase.from("renders")
        .update({ status: "failed", error_message: String(signErr) })
        .eq("id", renderId);
      await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      return json({ error: "image_url_failed", renderId }, 500);
    }
    console.log(`[${userId}] שלב 6: קישור חתום נוצר בהצלחה`);

    // --- 6. עונים ללקוח כאן — לא מחכים ל-Replicate! -----------------------
    // הקריאה בפועל ל-Replicate ושמירת התוצאה קורות אחרי שהתשובה הזו כבר
    // בדרך ללקוח, בעזרת EdgeRuntime.waitUntil (ראו ההסבר המלא בראש
    // הקובץ). מכאן ואילך האפליקציה מתשאלת את renders.status בעצמה.
    const response = json({
      renderId,
      status: "processing",
      freeRemaining: credit.free_remaining,
      creditSource: credit.reason,
      protectedElements: job.protectedLabels,
      promptStrength: job.promptStrength,
    });

    const backgroundWork = finishRenderInBackground({
      supabase,
      userId,
      renderId,
      job,
      signedUrl: signed.signedUrl,
      replicateToken,
    });

    // הגנה: אם מסיבה כלשהי EdgeRuntime.waitUntil לא קיים בסביבת הריצה
    // (לא צפוי — זה גלובל מתועד של Supabase Edge Runtime בדיוק בשביל
    // המקרה הזה, אבל אין דרך לבדוק את זה מהענן החסום הזה לפני פריסה
    // אמיתית) — לא נופלים על שגיאה, פשוט מריצים את ה-Promise בלי לחכות
    // לו (הוא ירוץ "כמה שיספיק" לפני שה-isolate נסגר; לא מושלם, אבל
    // עדיף מקריסת כל הבקשה).
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(backgroundWork);
    } else {
      console.error(
        "EdgeRuntime.waitUntil אינו זמין בסביבת הריצה הזו — העיבוד ברקע " +
          "עלול להיקטע. יש לבדוק גרסת Supabase Edge Runtime.",
      );
      backgroundWork.catch((e) =>
        console.error("background work failed", e)
      );
    }

    return response;
  } catch (e) {
    // --- רשת הביטחון: כל שגיאה לא צפויה *לפני* שעונים ללקוח מגיעה לכאן ---
    const detail = e instanceof Error ? `${e.message}` : String(e);
    console.error("generate-render: uncaught error (before response)", detail, e);

    if (renderId) {
      try {
        await supabase.from("renders")
          .update({
            status: "failed",
            error_message: `internal: ${detail}`.slice(0, 500),
          })
          .eq("id", renderId);
      } catch (updateErr) {
        console.error("failed to mark render as failed", updateErr);
      }
    }

    if (creditConsumed && renderId) {
      try {
        await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      } catch (refundErr) {
        console.error("failed to refund credit", refundErr);
      }
    }

    return json({ error: "internal_error", detail, renderId }, 500);
  }
});

/**
 * --- 7. הקריאה בפועל ל-Replicate ושמירת התוצאה — רצה **אחרי** שהתשובה
 * הראשונה כבר נשלחה ללקוח (EdgeRuntime.waitUntil). שום דבר כאן לא חוזר
 * ל-HTTP response — אין מי שיקרא אותו יותר; כל תוצאה (הצלחה או כישלון)
 * מדווחת אך ורק דרך עדכון שורת `renders`, שהאפליקציה מתשאלת.
 *
 * זהה בלוגיקה לגמרי לקוד הסינכרוני שהיה קודם (כולל רשת הביטחון,
 * הלוגים האבחוניים הממוספרים, ונעילת גרסת Replicate מסשן 8) — רק
 * שהתוצאה נכתבת לטבלה במקום לחזור כתשובת HTTP.
 */
async function finishRenderInBackground(params: {
  supabase: SupabaseClient;
  userId: string;
  renderId: string;
  job: RenderJob;
  signedUrl: string;
  replicateToken: string;
}): Promise<void> {
  const { supabase, userId, renderId, job, signedUrl, replicateToken } = params;

  const fail = async (code: string, detail?: string) => {
    console.log(`[${userId}] נכשל בקוד ${code}: ${detail}`);
    await supabase.from("renders")
      .update({ status: "failed", error_message: (detail ?? code).slice(0, 500) })
      .eq("id", renderId);
    // החזר קרדיט — הכישלון אינו באשמת המשתמש.
    await supabase.rpc("refund_render_credit", { p_render_id: renderId });
  };

  try {
    let prediction;
    try {
      console.log(`[${userId}] שלב 7: שולח בקשה ל-Replicate (ברקע)...`);
      // ל-Replicate יש שתי דרכים ליצור prediction: (1) POST /v1/predictions
      // + שדה "version" מדויק, או (2) POST
      // /v1/models/{owner}/{name}/predictions בלי version (רק לגרסת "latest"
      // מסומנת — לא קיימת אצל adirik/interior-design, קיבלנו 404 בעבר).
      // REPLICATE_VERSION תמיד מוגדר (ברירת מחדל קבועה למעלה בקובץ), אז
      // בפועל תמיד נבחר ב-(1); ה-fallback ל-(2) נשאר כרשת ביטחון בלבד.
      const replicateUrl = REPLICATE_VERSION
        ? "https://api.replicate.com/v1/predictions"
        : `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;
      const res = await fetch(replicateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          ...(REPLICATE_VERSION ? { version: REPLICATE_VERSION } : {}),
          input: {
            image: signedUrl,
            prompt: job.prompt,
            negative_prompt: job.negativePrompt,
            prompt_strength: job.promptStrength,
            guidance_scale: job.guidanceScale,
            num_inference_steps: job.numInferenceSteps,
          },
        }),
      });

      console.log(
        `[${userId}] שלב 8: קיבל תשובה מ-Replicate, ok=${res.ok}, status=${res.status}`,
      );
      if (!res.ok) {
        return await fail("replicate_error", await res.text());
      }
      prediction = await res.json();
      console.log(
        `[${userId}] שלב 9: JSON נפרס, prediction.status=${prediction?.status}`,
      );
    } catch (e) {
      return await fail("replicate_unreachable", String(e));
    }

    if (prediction?.status === "failed" || prediction?.error) {
      return await fail("generation_failed", String(prediction?.error ?? ""));
    }

    const outputUrl = Array.isArray(prediction?.output)
      ? prediction.output[0]
      : prediction?.output;

    if (!outputUrl) {
      return await fail("no_output", "המודל לא החזיר תמונה");
    }

    // --- שמירת התוצאה --------------------------------------------------
    // מורידים את התמונה ל-Storage שלנו: הקישור של Replicate פג אחרי זמן קצר.
    let afterPath: string | null = null;
    try {
      const imgRes = await fetch(outputUrl);
      if (imgRes.ok) {
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        afterPath = `${userId}/${renderId}.png`;
        const { error: upErr } = await supabase.storage
          .from("renders")
          .upload(afterPath, bytes, {
            contentType: "image/png",
            upsert: true,
          });
        if (upErr) {
          console.error("upload failed", upErr);
          afterPath = null;
        }
      }
    } catch (e) {
      console.error("could not persist output image", e);
    }

    await supabase.from("renders").update({
      status: "succeeded",
      after_image_path: afterPath,
      replicate_prediction_id: prediction?.id ?? null,
    }).eq("id", renderId);

    console.log(`[${userId}] שלב 10: הדמיה הסתיימה בהצלחה, renderId=${renderId}`);
  } catch (e) {
    // --- רשת הביטחון: כל שגיאה לא צפויה בעיבוד הרקע -----------------------
    const detail = e instanceof Error ? `${e.message}` : String(e);
    console.error("generate-render (background): uncaught error", detail, e);
    await fail("internal_error_background", detail);
  }
}
SHIFTEOF

echo
echo '✅ כל 12 הקבצים נכתבו בהצלחה.'
echo 'שלבים הבאים:'
echo '  1) flutter analyze   (לוודא 0 שגיאות)'
echo '  2) git add -A && git commit -m "סשן 9: עבודה אסינכרונית + גלריה" && git push'
echo '  3) לפרוס מחדש את ה-Edge Function:'
echo '     cd ../shift_app_stage5 && supabase functions deploy generate-render'
echo '     (אם ה-CLI לא מחובר עדיין באותו Codespace: supabase login && supabase link --project-ref iywhxmuzvincfmezijtv קודם)'
echo '  4) לבנות APK חדש ולבדוק בפועל במכשיר אמיתי'
