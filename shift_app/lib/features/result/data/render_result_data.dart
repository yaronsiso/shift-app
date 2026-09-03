import 'package:flutter/foundation.dart';

import '../../render/data/render_service.dart';

/// עוטף את תוצאת ההדמיה שמועברת ממסך העיבוד (4/5) למסך התוצאה (5/5) דרך
/// `extra` של go_router.
///
/// **למה זה קיים בנפרד מ-`RenderSuccess`:** `RenderSuccess` (שלב 5,
/// `render_service.dart`) לא כולל את נתיב תמונת ה"לפני" — היא חיה רק
/// ב-`render_flow` עד לאיפוס. מסך העיבוד קורא ל-`RenderFlowNotifier.reset()`
/// מיד אחרי הצלחה, אז הוא שומר את הנתיב כאן *לפני* שהוא מאפס, כדי
/// שמסך התוצאה יוכל להציג סליידר לפני/אחרי.
@immutable
class RenderResultData {
  final RenderSuccess outcome;

  /// נתיב מקומי לתמונת ה"לפני" שנבחרה במסך העלאת התמונה. עלול להיות
  /// null אם משום מה לא היה זמין בזמן שהעיבוד רץ — מסך התוצאה מתמודד
  /// עם זה בחן (מציג את תמונת ה"אחרי" בלבד, בלי סליידר השוואה, ולא קורס).
  final String? beforeLocalImagePath;

  const RenderResultData({
    required this.outcome,
    required this.beforeLocalImagePath,
  });
}
