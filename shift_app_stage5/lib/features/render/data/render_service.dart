import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../prompt_engine/prompt_engine.dart';

/// תוצאת ניסיון יצירת הדמיה.
sealed class RenderOutcome {
  const RenderOutcome();
}

class RenderSuccess extends RenderOutcome {
  final String renderId;

  /// נתיב התמונה שנוצרה ב-Storage (בתוך התיקייה של המשתמש).
  final String? afterImagePath;

  /// כתובת ישירה — רק אם ההעלאה ל-Storage נכשלה. זמנית.
  final String? fallbackUrl;

  /// כמה הדמיות חינם נותרו אחרי הפעולה.
  final int freeRemaining;

  const RenderSuccess({
    required this.renderId,
    required this.afterImagePath,
    required this.fallbackUrl,
    required this.freeRemaining,
  });
}

/// המכסה נגמרה — האפליקציה תציג Paywall.
class RenderQuotaExhausted extends RenderOutcome {
  const RenderQuotaExhausted();
}

/// כשל טכני. הקרדיט כבר הוחזר בשרת.
class RenderFailure extends RenderOutcome {
  final String code;
  final String? detail;
  const RenderFailure(this.code, [this.detail]);

  /// הודעה ידידותית להצגה למשתמש.
  String get messageHe => switch (code) {
        'unauthorized' => 'צריך להתחבר מחדש כדי ליצור הדמיה.',
        'bad_selection' => 'אחת הבחירות אינה תקפה לחדר שנבחר.',
        'replicate_error' ||
        'replicate_unreachable' ||
        'generation_failed' =>
          'שרת ההדמיות לא זמין כרגע. הקרדיט לא נוצל — אפשר לנסות שוב.',
        'image_url_failed' => 'לא הצלחנו לגשת לתמונה שהעלית. נסה להעלות שוב.',
        _ => 'משהו השתבש. הקרדיט לא נוצל — אפשר לנסות שוב.',
      };
}

/// מצב הזכאות של המשתמש — להצגת מונה הקרדיטים במסך העיצוב.
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

/// השירות שמדבר עם ה-Edge Function.
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

  /// יוצר הדמיה.
  Future<RenderOutcome> generate({
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
      if (res.status != 200 || data == null) {
        return RenderFailure(
          data?['error'] as String? ?? 'unknown',
          data?['detail'] as String?,
        );
      }

      return RenderSuccess(
        renderId: data['renderId'] as String,
        afterImagePath: data['afterImagePath'] as String?,
        fallbackUrl: data['outputUrl'] as String?,
        freeRemaining: data['freeRemaining'] as int? ?? 0,
      );
    } on FunctionException catch (e) {
      if (e.status == 402) return const RenderQuotaExhausted();
      return RenderFailure('function_error', e.details?.toString());
    } catch (e) {
      return RenderFailure('network_error', e.toString());
    }
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
