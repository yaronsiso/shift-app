/// פריט בודד במילון החומרים של SHIFT.
///
/// המבנה תואם את המפרט שנקבע ב-claude/03 (הנחיית סכמת המילון):
/// id · label_he · prompt_en · category · metadata.
///
/// [isConstructive] הוא הדגל שקובע את `prompt_strength` הנשלח למודל —
/// ראו מסקנה 1 ב-claude/07: שינוי משטח עובד ב-0.55, שינוי שדורש
/// מהמודל *להוסיף* מבנה שלא היה דורש 0.65.
class MaterialItem {
  /// מזהה ייחודי, יציב. משמש לשמירת בחירות ולשחזור הדמיה.
  final String id;

  /// קטגוריה ראשית להצגה בממשק (למשל: "ריצוף", "תאורה").
  final String category;

  /// תת-קטגוריה להצגה בתוך הקטגוריה (למשל: "פרקט", "תאורת פנים").
  final String subcategory;

  /// השם המוצג למשתמש בעברית.
  final String labelHe;

  /// שם באנגלית — לעזרי פיתוח ולממשק באנגלית.
  final String labelEn;

  /// הפרומפט הטכני באנגלית שנשלח למודל ה-AI.
  /// תמיד באנגלית, ללא קשר לשפת הממשק שנבחרה (ראו claude/03, i18n).
  final String promptEn;

  /// קודי סוגי החדרים שבהם הפריט רלוונטי (living, bedroom, mamad, ...).
  ///
  /// **סשן 10 — השדה הזה כבר לא אוכף שום הגבלה בפועל.** לפי בקשתו
  /// המפורשת והחוזרת של ירון ("לא צריך להיות מתוייג כלום... הכל צריך
  /// להיות פתוח לו... בכל חדר וחדר לא להגביל אנשים") — [isAvailableIn]
  /// תמיד מחזיר `true` כעת, ללא קשר לרשימה כאן. השדה נשאר במודל כתיעוד
  /// היסטורי/עתידי בלבד (מאיזה הקשר פריט "שייך" במקור), אך אינו משפיע
  /// על מה שהלקוח רואה במסך החומרים.
  final List<String> roomTypes;

  /// true = המודל נדרש להוסיף מבנה שלא קיים בתמונה (תקרת גבס, נישה,
  /// סרגלי עץ, פרגולה). false = החלפת משטח/גימור/ריהוט בלבד.
  final bool isConstructive;

  /// מפרט חופשי להצגה למשתמש (מידות, גוונים זמינים, הערות).
  final String metadata;

  const MaterialItem({
    required this.id,
    required this.category,
    required this.subcategory,
    required this.labelHe,
    required this.labelEn,
    required this.promptEn,
    required this.roomTypes,
    required this.isConstructive,
    this.metadata = '',
  });

  /// האם הפריט רלוונטי לסוג החדר הנתון.
  ///
  /// **סשן 10:** תמיד `true` — ראו התיעוד המלא ב-[roomTypes] למעלה.
  /// הפרמטר נשאר כדי לא לשנות את החתימה בכל נקודות הקריאה
  /// (category_group.dart, prompt_engine.dart) — כרגע הוא פשוט לא נבדק.
  bool isAvailableIn(String roomTypeCode) => true;
}
