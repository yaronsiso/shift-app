/// סוג חדר. החלפת [עיצוב פנים] / [עיצוב חוץ] הגסים שב-PRD המקורי —
/// ראו מסקנה 4 ב-claude/07: פרומפט שאומר "living room" על תמונת חדר שינה
/// יוצר קונפליקט שמגדיל דרמטית את הסטייה מהמבנה המקורי.
class RoomType {
  /// קוד יציב (living, bedroom, mamad, kids, kitchen, bathroom,
  /// office, balcony, facade, yard).
  final String code;

  /// השם המוצג למשתמש בעברית.
  final String labelHe;

  /// השם שנכנס לפרומפט באנגלית.
  final String labelEn;

  /// חוץ (חזית, חצר) מקבל תבנית פרומפט אחרת מפנים.
  final bool isExterior;

  const RoomType({
    required this.code,
    required this.labelHe,
    required this.labelEn,
    required this.isExterior,
  });

  /// ממ"ד — דורש טיפול מיוחד: נעילת אלמנטי הבטיחות.
  /// ראו מסקנה 5 ב-claude/07.
  bool get isMamad => code == 'mamad';
}
