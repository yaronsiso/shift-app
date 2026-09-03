import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// שלושת ערכי שביעות-הרצון האפשריים בכרטיס אבן-הדרך, בדיוק כמו שהוגדרו
/// במיגרציה 0005 (`claude/20`) ובממשק ("טוב מאוד" / "בסדר" / "לא משהו").
enum MilestoneSatisfaction { veryGood, ok, notGreat }

extension MilestoneSatisfactionValue on MilestoneSatisfaction {
  /// הערך שנשמר במסד הנתונים — חייב להתאים בדיוק ל-check constraint
  /// של `feedback_milestones.satisfaction` במיגרציה 0005.
  String get dbValue => switch (this) {
        MilestoneSatisfaction.veryGood => 'very_good',
        MilestoneSatisfaction.ok => 'ok',
        MilestoneSatisfaction.notGreat => 'not_great',
      };
}

/// מקור הדירוג — לתיעוד בלבד (איפה בממשק המשתמש שלח את הדירוג).
enum ReviewSource { menu, resultScreen }

extension ReviewSourceValue on ReviewSource {
  String get dbValue => switch (this) {
        ReviewSource.menu => 'menu',
        ReviewSource.resultScreen => 'result_screen',
      };
}

/// עוטף את שלוש הפונקציות שמיגרציה 0005 חשפה (`claude/20`) — מנגנון
/// המשוב כולו אדמין-בלבד בצד השרת (RLS בלי policies על הטבלאות עצמן),
/// כך שהאפליקציה תמיד עוברת דרך ה-RPC-ים האלה, אף פעם לא קוראת/כותבת
/// ישירות לטבלאות `feedback_milestones` / `app_reviews`.
class FeedbackRepository {
  final SupabaseClient _client;
  const FeedbackRepository(this._client);

  /// הסף הראשון (2/10/20) שהמשתמש חצה ועדיין לא ענה עליו, או null אם
  /// אין כזה. לקרוא אחרי כל הדמיה מוצלחת (מסך התוצאה).
  Future<int?> pendingMilestone() async {
    final res = await _client.rpc('pending_milestone');
    if (res == null) return null;
    return res as int;
  }

  /// שליחת התשובה על כרטיס אבן-הדרך. בטוח לקריאה כפולה על אותו סף —
  /// השרת פשוט מתעלם (unique constraint), לא זורק שגיאה.
  Future<void> submitMilestoneFeedback({
    required int milestone,
    required MilestoneSatisfaction satisfaction,
    required bool missingElements,
    String? missingElementsText,
  }) async {
    await _client.rpc('submit_milestone_feedback', params: {
      'p_milestone': milestone,
      'p_satisfaction': satisfaction.dbValue,
      'p_missing_elements': missingElements,
      'p_missing_elements_text':
          (missingElements && (missingElementsText?.trim().isNotEmpty ?? false))
              ? missingElementsText!.trim()
              : null,
    });
  }

  /// שליחת דירוג כוכבים + טקסט חופשי אופציונלי, מהתפריט או ממסך התוצאה.
  /// אפשר לשלוח כמה פעמים שרוצים — אין הגבלה כמו באבני-הדרך.
  Future<void> submitReview({
    required int stars,
    String? reviewText,
    required ReviewSource source,
  }) async {
    assert(stars >= 1 && stars <= 5, 'דירוג חייב להיות בין 1 ל-5');
    await _client.rpc('submit_app_review', params: {
      'p_stars': stars,
      'p_review_text':
          (reviewText?.trim().isNotEmpty ?? false) ? reviewText!.trim() : null,
      'p_source': source.dbValue,
    });
  }
}

final feedbackRepositoryProvider = Provider<FeedbackRepository>((ref) {
  return FeedbackRepository(ref.watch(supabaseClientProvider));
});
