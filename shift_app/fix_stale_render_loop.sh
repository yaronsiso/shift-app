#!/usr/bin/env bash
# SHIFT — סשן 13: תיקון #1 (בצד האפליקציה) לבאג "מעגל התקיעה".
#
# מה זה עושה: מחליף לגמרי את הקובץ render_service.dart כך ש-
# findPendingRender() יתעלם מהדמיה שנשארה pending/processing יותר מ-5
# דקות מרגע היצירה שלה, במקום להמשיך "לרדוף" אחריה לנצח בכל פתיחת
# אפליקציה. ראו הסבר מלא בהערת התיעוד בתוך הקוד למטה.
#
# איך מריצים: להדביק את התוכן הזה לקובץ .sh חדש ב-VS Code (בתוך
# ה-Codespace), לשמור (Ctrl+S פעם אחת), ואז בטרמינל להריץ עם נתיב מלא:
#   bash /workspaces/shift-app/shift_app/fix_stale_render_loop.sh
set -e
cd /workspaces/shift-app/shift_app

cat > lib/features/render/data/render_service.dart << 'SHIFTEOF'
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

  /// **סשן 13 — תיקון "מעגל התקיעה":** גיל מרבי (מרגע היצירה) שבו עדיין
  /// לגיטימי להמשיך "לרדוף" אוטומטית אחרי הדמיה שנשארה pending/processing.
  /// ההדמיה עצמה אמורה תמיד להסתיים תוך כ-30 שניות (ראו claude/07); גם
  /// עם רשת איטית מאוד, 5 דקות נדיבות בהרבה. אם הדמיה נשארת מעבר לזה —
  /// כמעט תמיד סימן שהעיבוד ברקע בשרת (`EdgeRuntime.waitUntil` ב-
  /// generate-render) מת/נקטע בלי לדווח (למשל: פריסה מחדש של הפונקציה
  /// באמצע, או חריגה ממגבלת זמן ריצה של הרקע) — השורה נשארת "תקועה"
  /// לנצח, כי שום דבר לא הגיע לרגע שמסמן אותה כ-failed/succeeded.
  ///
  /// **הבאג שזה פותר:** בלי הגבלת הגיל הזו, `findPendingRender()` ממשיך
  /// למצוא את אותה שורה מתה בכל פתיחת אפליקציה, ו-`HomeScreen` מפנה
  /// אוטומטית למסך המעקב שוב ושוב — מעגל אינסופי שאי אפשר לצאת ממנו
  /// בלי להיכנס ידנית ל-Supabase ולתקן את השורה ידנית (ראו claude/00,
  /// סשן 13). עכשיו, מעבר לגיל הזה, פשוט מתעלמים מההדמיה הישנה מבחינת
  /// חידוש אוטומטי — היא עדיין תופיע בגלריה בעצמה אם בכל זאת תסתיים
  /// בהצלחה מאוחר יותר (`listMyRenders` לא מוגבל בגיל).
  static const _maxAutoResumeAge = Duration(minutes: 5);

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
  /// לאבד אותה. מחזיר null אם אין כזו **או אם היחידה שנמצאה ישנה מדי**
  /// (ראו `_maxAutoResumeAge` למעלה — סשן 13).
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
        .select('id, status, after_image_path, error_message, created_at')
        .eq('user_id', uid)
        .order('created_at', ascending: false)
        .limit(5);
    for (final r in (rows as List)) {
      final row = r as Map<String, dynamic>;
      final status = row['status'] as String?;
      if (status != 'pending' && status != 'processing') continue;

      final createdAtRaw = row['created_at'] as String?;
      if (createdAtRaw != null) {
        final createdAt = DateTime.tryParse(createdAtRaw);
        if (createdAt != null) {
          final age = DateTime.now().toUtc().difference(createdAt.toUtc());
          if (age > _maxAutoResumeAge) {
            // ישנה מדי — כנראה מתה בשרת בלי לדווח. לא ממשיכים "לרדוף"
            // אחריה כדי לא להיכנס למעגל תקיעה (ראו claude/00, סשן 13).
            continue;
          }
        }
      }
      return RenderStatusResult.fromRow(row);
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

echo "✅ render_service.dart עודכן. עכשיו תריץ: flutter analyze"
