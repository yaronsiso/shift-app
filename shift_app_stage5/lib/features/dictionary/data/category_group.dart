import 'material_item.dart';
import 'materials_data.dart';

/// בורר אחד בתוך קבוצת-על: קטגוריה מהמילון (חובה) ותת-קטגוריה לסינון
/// (אופציונלי). `subcategoryIn` מצמצם לתת-קטגוריות ספציפיות בלבד;
/// `subcategoryNotIn` לוקח את כל הקטגוריה חוץ מתת-הקטגוריות שהוחרגו.
/// אי אפשר להגדיר את שניהם יחד על אותו בורר.
class CategorySelector {
  final String category;
  final List<String>? subcategoryIn;
  final List<String>? subcategoryNotIn;

  const CategorySelector(
    this.category, {
    this.subcategoryIn,
    this.subcategoryNotIn,
  }) : assert(
          subcategoryIn == null || subcategoryNotIn == null,
          'אפשר להגדיר subcategoryIn או subcategoryNotIn על אותו בורר, לא את שניהם',
        );

  bool matches(MaterialItem item) {
    if (item.category != category) return false;
    if (subcategoryIn != null) {
      return subcategoryIn!.contains(item.subcategory);
    }
    if (subcategoryNotIn != null) {
      return !subcategoryNotIn!.contains(item.subcategory);
    }
    return true;
  }
}

/// קבוצת-על שמוצגת כצ'יפ במסך הבית ("צבע", "רהיטים", "חומרי בנייה",
/// "תאורה", "גינה") — שכבת ארגון חדשה **מעל** הקטגוריות המפורטות
/// הקיימות של המילון (470 פריטים, ~20 קטגוריות) — לא קטגוריות חדשות
/// במילון עצמו. ראו claude/22 להסבר המלא על המיפוי.
class CategoryGroup {
  final String code;
  final String labelHe;
  final String labelEn;
  final List<CategorySelector> selectors;

  const CategoryGroup({
    required this.code,
    required this.labelHe,
    required this.labelEn,
    required this.selectors,
  });

  bool matches(MaterialItem item) => selectors.any((s) => s.matches(item));
}

/// המיפוי בפועל. **לוגיקת "צבע" חשובה במיוחד:** "צבע" הוא לא קטגוריה
/// עצמאית במילון — הוא תת-קטגוריה בתוך "חיפויי קירות" (צבע קיר פנימי,
/// 10 פריטים) ו"חיפוי חזית" (שליכט, כולל שני הגוונים הצבעוניים שנוספו
/// בסשן 5, 5 פריטים) — לכן קבוצת "צבע" שולפת רק את תתי-הקטגוריות האלה,
/// והקבוצה "חומרי בנייה" שולפת את אותן שתי קטגוריות **בלי** תת-הקטגוריה
/// הזו (subcategoryNotIn), כדי שאף פריט לא יופיע פעמיים בשני מקומות.
const List<CategoryGroup> kCategoryGroups = [
  CategoryGroup(
    code: 'color',
    labelHe: 'צבע',
    labelEn: 'Color',
    selectors: [
      CategorySelector('חיפויי קירות', subcategoryIn: ['צבע']),
      CategorySelector('חיפוי חזית', subcategoryIn: ['שליכט']),
    ],
  ),
  CategoryGroup(
    code: 'furniture',
    labelHe: 'רהיטים',
    labelEn: 'Furniture',
    selectors: [
      CategorySelector('ריהוט'),
    ],
  ),
  CategoryGroup(
    code: 'materials',
    labelHe: 'חומרי בנייה',
    labelEn: 'Building materials',
    selectors: [
      CategorySelector('ריצוף'),
      CategorySelector('חיפויי קירות', subcategoryNotIn: ['צבע']),
      CategorySelector('חיפוי חזית', subcategoryNotIn: ['שליכט']),
      CategorySelector('אלומיניום ופתחים'),
      CategorySelector('גבס ותקרות'),
      CategorySelector('מדרגות ומעקות'),
      CategorySelector('גדרות ושערים'),
      CategorySelector('טפטים'),
    ],
  ),
  CategoryGroup(
    code: 'lighting',
    labelHe: 'תאורה',
    labelEn: 'Lighting',
    selectors: [
      CategorySelector('תאורה'),
    ],
  ),
  CategoryGroup(
    code: 'garden',
    labelHe: 'גינה',
    labelEn: 'Garden',
    selectors: [
      CategorySelector('פיתוח חצר'),
      CategorySelector('צמחייה'),
      CategorySelector('הצללה'),
    ],
  ),
];

/// עוזרי גישה — כל הלוגיקה שמסך הבית וסטודיו העיצוב צריכים כדי לעבוד עם
/// קבוצות-העל, כולל "ועוד" (הקטגוריות המפורטות שלא שויכו לאף קבוצה קבועה
/// — למשל מטבח/חדר רחצה/שטיחים/סגנון/יודאיקה/קמין/מטבח-חוץ-ואירוח —
/// כי הן ספציפיות מדי לחדר או נישתיות מכדי להצדיק צ'יפ-על קבוע משלהן).
class CategoryGroups {
  CategoryGroups._();

  /// כל הפריטים הרלוונטיים לסוג חדר וקבוצת-על נתונים (לפי `code`).
  static List<MaterialItem> itemsForRoomAndGroup(
    String roomTypeCode,
    String groupCode,
  ) {
    CategoryGroup? group;
    for (final g in kCategoryGroups) {
      if (g.code == groupCode) {
        group = g;
        break;
      }
    }
    if (group == null) return const [];
    final g = group;
    return kMaterials
        .where((m) => m.isAvailableIn(roomTypeCode) && g.matches(m))
        .toList();
  }

  /// קבוצות-העל שיש להן לפחות פריט אחד רלוונטי לסוג החדר הזה — אלה
  /// שיוצגו כצ'יפים במסך הבית (בנוסף ל"ועוד" הקבוע, שמוצג רק אם יש
  /// לו תוכן — ראו [moreCategoriesForRoom]).
  static List<CategoryGroup> groupsForRoom(String roomTypeCode) {
    return kCategoryGroups
        .where(
          (g) => kMaterials.any(
            (m) => m.isAvailableIn(roomTypeCode) && g.matches(m),
          ),
        )
        .toList();
  }

  /// שמות הקטגוריות המפורטות (`category`) שלא שויכו לאף קבוצת-על קבועה,
  /// לפי סדר ההופעה במילון — אלה שמופיעות תחת "ועוד".
  static List<String> moreCategoriesForRoom(String roomTypeCode) {
    final claimed = <String>{
      for (final g in kCategoryGroups)
        for (final s in g.selectors) s.category,
    };
    final seen = <String>[];
    for (final m in kMaterials) {
      if (m.isAvailableIn(roomTypeCode) &&
          !claimed.contains(m.category) &&
          !seen.contains(m.category)) {
        seen.add(m.category);
      }
    }
    return seen;
  }

  /// הפריטים תחת "ועוד" לסוג חדר, מקובצים לפי הקטגוריה המפורטת שלהם —
  /// למשל `{"מטבח": [...8 פריטים...], "שטיחים": [...7...]}` לחדר מטבח.
  static Map<String, List<MaterialItem>> moreItemsForRoom(String roomTypeCode) {
    final categories = moreCategoriesForRoom(roomTypeCode);
    return {
      for (final cat in categories)
        cat: kMaterials
            .where((m) => m.isAvailableIn(roomTypeCode) && m.category == cat)
            .toList(),
    };
  }
}
