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
  bool isAvailableIn(String roomTypeCode) => roomTypes.contains(roomTypeCode);
}
