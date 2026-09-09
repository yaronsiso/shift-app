#!/usr/bin/env bash
set -euo pipefail

echo '=== מוסיף 8 קטגוריות חדשות (מטבח, חדר רחצה, ועוד) כצ׳יפים במסך הבית ==='

mkdir -p "$(dirname '/workspaces/shift-app/shift_app/lib/features/dictionary/data/category_group.dart')"
cat > '/workspaces/shift-app/shift_app/lib/features/dictionary/data/category_group.dart' << 'SHIFTEOF2'
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

/// קבוצת-על שמוצגת כצ'יפ במסך הבית ("צבע", "רהיטים", "תקרות", "ריצוף"...)
/// — שכבת ארגון **מעל** הקטגוריות המפורטות הקיימות של המילון (484 פריטים).
/// ראו claude/22 להסבר המקורי על המיפוי, ו-claude/31 (סשן 11) לפירוט
/// הפיצול של קבוצת "חומרי בנייה" הישנה לקבוצות הקטנות והממוקדות למטה.
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

/// המיפוי בפועל.
///
/// **סשן 11 (בקשת ירון, לאחר בדיקה בפועל):** קבוצת "חומרי בנייה" הישנה
/// ריכזה בתוכה כ-150 פריטים תחת 8 קטגוריות שונות ולא-קשורות (ריצוף, גבס
/// ותקרות, חיפויי קירות, אלומיניום ופתחים, מדרגות, גדרות, טפטים...) —
/// מי שרצה למשל ריצוף היה צריך לגלול לאורך כל שאר הקטגוריות כדי להגיע
/// אליו. הקבוצה פוצלה לחלוטין: כל קטגוריה מפורטת מקבלת עכשיו צ'יפ-על
/// משלה בפני עצמה (תקרות / חיפויי קירות / חיפוי אבן / שליכט חיצוני /
/// ריצוף / פרקטים / גימורים / אלומיניום / תריסים / דלתות / מדרגות
/// ומעקות / גדרות ושערים / טפטים), כדי שכל אחת תהיה נגישה ישירות בלי
/// גלילה מיותרת. "מראות" פוצלה באותו האופן מתוך "רהיטים". במילון עצמו
/// (`materials_data.dart`) גם שונו שדות ה-`category`/`subcategory` בפועל
/// כדי שהחלוקה החדשה תהיה אמיתית ולא רק קוסמטית בשכבת הקבוצות.
///
/// **לוגיקת "צבע":** "צבע" הוא לא קטגוריה עצמאית במילון — הוא תת-קטגוריה
/// בתוך "חיפויי קירות" (צבע קיר פנימי, 10 פריטים) בלבד כעת (גווני השליכט
/// החיצוני עברו לקטגוריית "שליכט חיצוני" העצמאית שלהם, ולא כפולים כאן).
///
/// **סשן 16 (תיקון קריטי — ירון גילה בבדיקה בפועל):** "מטבח" ו"חדר רחצה"
/// (וכן מטבח-חוץ-ואירוח / שטיחים / סגנון / אקססוריז דקורטיביים / יודאיקה
/// / קמין) היו קיימים במילון עם עשרות ואף מאות פריטים (מטבח לבדו — 289
/// אחרי הרחבת סשן 16) אבל **מעולם לא היה להם צ'יפ-על משלהם** — הפונקציות
/// `moreCategoriesForRoom`/`moreItemsForRoom` למטה תוכננו לכסות את זה
/// ("ועוד") אבל אף מסך בפועל לא קרא להן, כך שכל התוכן הזה היה בלתי-נגיש
/// לגמרי במסכי הבית/סטודיו העיצוב. התיקון: כל קטגוריה מפורטת מקבלת עכשיו
/// צ'יפ-על משלה, בדיוק כמו כל שאר הקטגוריות למעלה — אין יותר "ועוד".
/// `moreCategoriesForRoom`/`moreItemsForRoom` נשארות כרשת ביטחון לעתיד
/// (קטגוריה חדשה שתתווסף למילון בלי שמישהו יזכור להוסיף לה צ'יפ כאן).
const List<CategoryGroup> kCategoryGroups = [
  CategoryGroup(
    code: 'color',
    labelHe: 'צבע',
    labelEn: 'Color',
    selectors: [
      CategorySelector('חיפויי קירות', subcategoryIn: ['צבע']),
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
    code: 'ceilings',
    labelHe: 'תקרות',
    labelEn: 'Ceilings',
    selectors: [
      CategorySelector('תקרות'),
    ],
  ),
  CategoryGroup(
    code: 'wall_cladding',
    labelHe: 'חיפויי קירות',
    labelEn: 'Wall cladding',
    selectors: [
      CategorySelector('חיפויי קירות', subcategoryNotIn: ['צבע']),
    ],
  ),
  CategoryGroup(
    code: 'stone_cladding',
    labelHe: 'חיפוי אבן',
    labelEn: 'Stone cladding',
    selectors: [
      CategorySelector('חיפוי אבן'),
    ],
  ),
  CategoryGroup(
    code: 'exterior_plaster',
    labelHe: 'שליכט חיצוני',
    labelEn: 'Exterior plaster',
    selectors: [
      CategorySelector('שליכט חיצוני'),
    ],
  ),
  CategoryGroup(
    code: 'flooring',
    labelHe: 'ריצוף',
    labelEn: 'Flooring',
    selectors: [
      CategorySelector('ריצוף'),
    ],
  ),
  CategoryGroup(
    code: 'parquet',
    labelHe: 'פרקטים',
    labelEn: 'Parquet',
    selectors: [
      CategorySelector('פרקטים'),
    ],
  ),
  CategoryGroup(
    code: 'finishes',
    labelHe: 'גימורים',
    labelEn: 'Finishes',
    selectors: [
      CategorySelector('גימורים'),
    ],
  ),
  CategoryGroup(
    code: 'mirrors',
    labelHe: 'מראות',
    labelEn: 'Mirrors',
    selectors: [
      CategorySelector('מראות'),
    ],
  ),
  CategoryGroup(
    code: 'aluminum',
    labelHe: 'אלומיניום',
    labelEn: 'Aluminum',
    selectors: [
      CategorySelector('אלומיניום'),
    ],
  ),
  CategoryGroup(
    code: 'shutters',
    labelHe: 'תריסים',
    labelEn: 'Shutters',
    selectors: [
      CategorySelector('תריסים'),
    ],
  ),
  CategoryGroup(
    code: 'doors',
    labelHe: 'דלתות',
    labelEn: 'Doors',
    selectors: [
      CategorySelector('דלתות'),
    ],
  ),
  CategoryGroup(
    code: 'stairs_railings',
    labelHe: 'מדרגות ומעקות',
    labelEn: 'Stairs & railings',
    selectors: [
      CategorySelector('מדרגות ומעקות'),
    ],
  ),
  CategoryGroup(
    code: 'fences_gates',
    labelHe: 'גדרות ושערים',
    labelEn: 'Fences & gates',
    selectors: [
      CategorySelector('גדרות ושערים'),
    ],
  ),
  CategoryGroup(
    code: 'wallpaper',
    labelHe: 'טפטים',
    labelEn: 'Wallpaper',
    selectors: [
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
  // ---------------- סשן 16 — צ'יפים חדשים ל"ועוד" הישן ----------------
  // ראו התיעוד המלא למעלה: הקטגוריות האלה היו קיימות במילון (חלקן
  // בעשרות/מאות פריטים) אבל בלי צ'יפ-על, ולכן בלתי-נגישות בפועל.
  CategoryGroup(
    code: 'kitchen_materials',
    labelHe: 'מטבח',
    labelEn: 'Kitchen',
    selectors: [
      CategorySelector('מטבח'),
    ],
  ),
  CategoryGroup(
    code: 'bathroom_materials',
    labelHe: 'חדר רחצה',
    labelEn: 'Bathroom',
    selectors: [
      CategorySelector('חדר רחצה'),
    ],
  ),
  CategoryGroup(
    code: 'outdoor_kitchen',
    labelHe: 'מטבח חוץ ואירוח',
    labelEn: 'Outdoor kitchen & hosting',
    selectors: [
      CategorySelector('מטבח חוץ ואירוח'),
    ],
  ),
  CategoryGroup(
    code: 'rugs',
    labelHe: 'שטיחים',
    labelEn: 'Rugs',
    selectors: [
      CategorySelector('שטיחים'),
    ],
  ),
  CategoryGroup(
    code: 'style',
    labelHe: 'סגנון',
    labelEn: 'Style',
    selectors: [
      CategorySelector('סגנון'),
    ],
  ),
  CategoryGroup(
    code: 'decor_accessories',
    labelHe: 'אקססוריז דקורטיביים',
    labelEn: 'Decorative accessories',
    selectors: [
      CategorySelector('אקססוריז דקורטיביים'),
    ],
  ),
  CategoryGroup(
    code: 'judaica',
    labelHe: 'יודאיקה',
    labelEn: 'Judaica',
    selectors: [
      CategorySelector('יודאיקה'),
    ],
  ),
  CategoryGroup(
    code: 'fireplace',
    labelHe: 'קמין',
    labelEn: 'Fireplace',
    selectors: [
      CategorySelector('קמין'),
    ],
  ),
];

/// סיכום תת-קטגוריה אחת בתוך קבוצת-על נתונה, לצורך מסך הביניים של בחירת
/// תת-קטגוריה (סשן 15, המשך 3 — "לך תראה איך זה מסודר... נעבור קטגוריה
/// קטגוריה"). [relevant] = יש בתת-הקטגוריה הזו לפחות פריט אחד המתויג
/// לסוג החדר שנבחר (`MaterialItem.roomTypes`) — לא הסתרה, רק סימון
/// לצורך מיון (תתי-קטגוריות רלוונטיות מוצגות ראשונות).
class SubcategorySummary {
  final String category;
  final String subcategory;
  final List<MaterialItem> items;
  final bool relevant;

  const SubcategorySummary({
    required this.category,
    required this.subcategory,
    required this.items,
    required this.relevant,
  });
}

/// עוזרי גישה — כל הלוגיקה שמסך הבית וסטודיו העיצוב צריכים כדי לעבוד עם
/// קבוצות-העל. **סשן 16:** מאז שכל הקטגוריות המפורטות קיבלו צ'יפ-על משלהן
/// (כולל מטבח/חדר רחצה/שטיחים/סגנון/יודאיקה/קמין/מטבח-חוץ-ואירוח שהיו
/// חסרות עד עכשיו), `moreCategoriesForRoom`/`moreItemsForRoom` בפועל
/// יחזירו רשימה ריקה בשימוש רגיל — הן נשארות כרשת ביטחון בלבד למקרה
/// שתתווסף בעתיד קטגוריה חדשה למילון בלי שמישהו יזכור להוסיף לה צ'יפ.
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

  /// **סשן 15 (המשך 3) — מיון לפי רלוונטיות לחדר, בלי הסתרה.** ציטוט
  /// ירון: "לא נסתיר, רק נציג את הרלוונטי לחדר קודם, אחר כך כל השאר".
  /// זהה ל-[itemsForRoomAndGroup] אבל ממוין: פריטים שמתויגים לסוג החדר
  /// הזה (`item.roomTypes.contains(roomTypeCode)`) מופיעים קודם, ואז כל
  /// השאר — בסדר יציב (הסדר היחסי המקורי בתוך כל קבוצה נשמר).
  static List<MaterialItem> itemsForRoomAndGroupSorted(
    String roomTypeCode,
    String groupCode,
  ) {
    final items = itemsForRoomAndGroup(roomTypeCode, groupCode);
    final relevant = <MaterialItem>[];
    final rest = <MaterialItem>[];
    for (final item in items) {
      if (item.roomTypes.contains(roomTypeCode)) {
        relevant.add(item);
      } else {
        rest.add(item);
      }
    }
    return [...relevant, ...rest];
  }

  /// **סשן 15 (המשך 3).** תתי-הקטגוריות בתוך קבוצה נתונה, כ"כרטיסים"
  /// למסך הביניים (ראו design_studio_screen.dart) — למשל בתוך "רהיטים":
  /// מיטות, שידות, ספות וכו', כל אחת עם דגל [SubcategorySummary.relevant].
  /// תתי-הקטגוריות הרלוונטיות לחדר שנבחר מופיעות ראשונות, השאר אחריהן —
  /// שום תת-קטגוריה לא מוסתרת. הסדר בתוך כל קבוצה (רלוונטי/לא) הוא סדר
  /// ההופעה המקורי במילון.
  static List<SubcategorySummary> subcategoriesForRoomAndGroup(
    String roomTypeCode,
    String groupCode,
  ) {
    final items = itemsForRoomAndGroup(roomTypeCode, groupCode);
    final order = <String>[]; // "category|subcategory", בסדר הופעה
    final byKey = <String, List<MaterialItem>>{};
    for (final item in items) {
      final key = '${item.category}|${item.subcategory}';
      if (!byKey.containsKey(key)) order.add(key);
      byKey.putIfAbsent(key, () => []).add(item);
    }

    final summaries = order.map((key) {
      final list = byKey[key]!;
      final relevant = list.any((i) => i.roomTypes.contains(roomTypeCode));
      return SubcategorySummary(
        category: list.first.category,
        subcategory: list.first.subcategory,
        items: list,
        relevant: relevant,
      );
    }).toList();

    final relevantOnes = summaries.where((s) => s.relevant).toList();
    final restOnes = summaries.where((s) => !s.relevant).toList();
    return [...relevantOnes, ...restOnes];
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
SHIFTEOF2
echo 'נכתב: /workspaces/shift-app/shift_app/lib/features/dictionary/data/category_group.dart'
