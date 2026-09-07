#!/bin/bash
# SHIFT — סשן 15 (המשך 3): שלב 1 בשינוי הקטגוריות — מיון לפי
# רלוונטיות לחדר + מסך ביניים של תתי-קטגוריות, בלי להסתיר כלום.
# גם כולל תיקון צביעת האייקונים (החליף בטעות דילג בפעם הקודמת).
#
# שלושת קבצי ה-Dart למטה נכתבים כאן במלואם (לא טלאי חלקי) — כי
# הפעם יש לי את התוכן המדויק והעדכני שלהם (מתוך shift_app_export.zip
# שקיבלתי), אז החלפה מלאה בטוחה יותר מניחוש רגקס.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/apply_category_redesign.sh

set -e
cd /workspaces/shift-app/shift_app

mkdir -p "$(dirname "lib/features/dictionary/data/category_group.dart")"
cat > lib/features/dictionary/data/category_group.dart << 'SHIFT_EOF_MARKER'
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
</content>
SHIFT_EOF_MARKER
echo "נכתב: lib/features/dictionary/data/category_group.dart"

mkdir -p "$(dirname "lib/features/design_studio/presentation/design_studio_screen.dart")"
cat > lib/features/design_studio/presentation/design_studio_screen.dart << 'SHIFT_EOF_MARKER'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../dictionary/data/category_group.dart';
import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../dictionary/data/room_types_data.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render_flow/data/render_flow_notifier.dart';

/// מסך 2/5 — "בחירת חומרים". רק קבוצות-העל שנבחרו במסך הבית מופיעות
/// כטאבים.
///
/// **סשן 15 (המשך 3) — נוספה רמת ביניים של תתי-קטגוריות (בקשת ירון,
/// אחרי שסידרנו את הבאגים מהבדיקה על המכשיר: "נעבור קטגוריה קטגוריה
/// ונשנה את כל הצורה של זה"):** במקום להציג ישר את כל תתי-הקטגוריות
/// של הקבוצה הפעילה מוערמות זו מתחת לזו על מסך אחד גולל, כל טאב (קבוצת-
/// על, למשל "רהיטים") פותח קודם **רשימת תתי-קטגוריות** (למשל "מיטות",
/// "שידות", "ספות"...) — ורק לחיצה על תת-קטגוריה ספציפית פותחת את
/// רשימת הפריטים בתוכה. תתי-הקטגוריות **הרלוונטיות לסוג החדר שנבחר
/// מוצגות ראשונות**, ואחריהן כל השאר — שום דבר לא מוסתר, רק מסודר לפי
/// רלוונטיות (ראו `CategoryGroups.subcategoriesForRoomAndGroup` ב-
/// category_group.dart). זה בדיוק המנגנון שירון תיאר: "לחדר שינה
/// שהקטגוריות שנפתחות ראשונות על ריהוט אמורות להיות מיטות... ואחרי זה
/// כל שאר הדברים".
///
/// לכל פריט **נבחר** אפשר להוסיף הערה חופשית (`FreeTextNote`) — מתועדת
/// כמו שהיא, ומעובדת לאילוץ באנגלית בשרת רק בזמן היצירה עצמה
/// (note_resolver.ts, שלב 5). **אין כאן צילום תמונה** — זה עבר במפורש
/// למסך נפרד לפי בקשת ירון (ראו home_screen.dart).
///
/// **סשן 10 (עדיין בתוקף):** הפריטים הזמינים בכל קבוצת-על **לא מסוננים
/// לפי סוג החדר** — `MaterialItem.isAvailableIn` תמיד מחזירה `true`
/// (ראו material_item.dart). זה לא השתנה בסשן 15 — סוג החדר משפיע רק
/// על **סדר ההצגה**, לא על מה שמוצג.
class DesignStudioScreen extends ConsumerStatefulWidget {
  const DesignStudioScreen({super.key});

  @override
  ConsumerState<DesignStudioScreen> createState() =>
      _DesignStudioScreenState();
}

class _DesignStudioScreenState extends ConsumerState<DesignStudioScreen> {
  String? _activeGroupCode;

  /// "category|subcategory" של תת-הקטגוריה הפתוחה כרגע, או null אם
  /// עדיין מציגים את רשימת תתי-הקטגוריות של הקבוצה הפעילה (סשן 15).
  String? _activeSubcategoryKey;

  @override
  Widget build(BuildContext context) {
    final flow = ref.watch(renderFlowProvider);
    final notifier = ref.read(renderFlowProvider.notifier);
    final marquee = ref.watch(marqueeMessagesProvider);
    final locale = context.locale.languageCode;

    final roomType = flow.roomTypeCode;
    if (roomType == null || flow.selectedGroupCodes.isEmpty) {
      // הגעה למסך הזה בלי לעבור קודם דרך מסך הבית (למשל רענון ידני) —
      // אין ממה לבנות את הטאבים, חוזרים למסך הבית.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // תיקון סשן 13: לא לנווט הביתה אם המסך הזה כבר לא זה שבחזית —
        // למשל אם הוא שוכב שקט בתחתית המחסנית מתחת למסך העיבוד, ו-
        // renderFlowProvider אופס כי ההגשה כבר הצליחה (ראו processing_screen
        // _run()). בלי הבדיקה הזו, האיפוס גורם למסך הזה להיבנות מחדש עם
        // flow ריק ולקפוץ הביתה — וה-context.go() מוחק את כל המחסנית,
        // כולל את מסך העיבוד שבאמת עדיין עוקב אחרי ההדמיה. זה שורש הבאג
        // "קפיצה למסך הבית" שדווח לאורך הפרויקט.
        if (context.mounted &&
            (ModalRoute.of(context)?.isCurrent ?? true)) {
          context.go(AppRoutes.home);
        }
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    final groups = kCategoryGroups
        .where((g) => flow.selectedGroupCodes.contains(g.code))
        .toList();
    if (groups.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // תיקון סשן 13: לא לנווט הביתה אם המסך הזה כבר לא זה שבחזית —
        // ראו ההסבר המלא למעלה.
        if (context.mounted &&
            (ModalRoute.of(context)?.isCurrent ?? true)) {
          context.go(AppRoutes.home);
        }
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    if (_activeGroupCode == null ||
        !groups.any((g) => g.code == _activeGroupCode)) {
      _activeGroupCode = groups.first.code;
      _activeSubcategoryKey = null;
    }
    final activeGroup =
        groups.firstWhere((g) => g.code == _activeGroupCode);

    final subcategories =
        CategoryGroups.subcategoriesForRoomAndGroup(roomType, activeGroup.code);
    SubcategorySummary? activeSubcategory;
    if (_activeSubcategoryKey != null) {
      for (final s in subcategories) {
        if ('${s.category}|${s.subcategory}' == _activeSubcategoryKey) {
          activeSubcategory = s;
          break;
        }
      }
      // תת-הקטגוריה שהייתה פתוחה כבר לא קיימת בקבוצה הזו (למשל אחרי
      // מעבר טאב) — חוזרים לרשימת תתי-הקטגוריות במקום למסך ריק.
      if (activeSubcategory == null) _activeSubcategoryKey = null;
    }

    return Scaffold(
      appBar: AppBar(title: Text('design_studio_screen.app_title'.tr())),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) => MarqueeBar(
                messages: messages.map((m) => m.message).toList(),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'design_studio_screen.title'.tr(),
                    style:
                        Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                            ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _subtitle(roomType, groups, locale),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 40,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                scrollDirection: Axis.horizontal,
                itemCount: groups.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final g = groups[i];
                  final selected = g.code == activeGroup.code;
                  return ChoiceChip(
                    label: Text(locale == 'he' ? g.labelHe : g.labelEn),
                    selected: selected,
                    onSelected: (_) => setState(() {
                      _activeGroupCode = g.code;
                      _activeSubcategoryKey = null;
                    }),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: activeSubcategory != null
                  ? _SubcategoryItemsView(
                      subcategory: activeSubcategory,
                      locale: locale,
                      notifier: notifier,
                      isSelected: notifier.isSelected,
                      hasNoteFor: (id) =>
                          flow.selections[id]?.hasModifiers ?? false,
                      onNoteTap: (item) =>
                          _editNote(context, ref, item, locale),
                      onBack: () =>
                          setState(() => _activeSubcategoryKey = null),
                    )
                  : subcategories.isEmpty
                      ? Center(
                          child: Text(
                            'design_studio_screen.no_items'.tr(),
                            style: TextStyle(color: context.palette.inkFaint),
                          ),
                        )
                      : _SubcategoryListView(
                          subcategories: subcategories,
                          locale: locale,
                          isSelected: notifier.isSelected,
                          onTap: (s) => setState(() =>
                              _activeSubcategoryKey =
                                  '${s.category}|${s.subcategory}'),
                        ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: flow.hasSelections
                      ? () => context.push(AppRoutes.uploadPhoto)
                      : null,
                  child: Text('design_studio_screen.continue_button'.tr()),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _subtitle(
    String roomType,
    List<CategoryGroup> groups,
    String locale,
  ) {
    final room = kRoomTypes.firstWhere((r) => r.code == roomType);
    final roomLabel = locale == 'he' ? room.labelHe : room.labelEn;
    final groupLabels =
        groups.map((g) => locale == 'he' ? g.labelHe : g.labelEn).join(', ');
    return '$roomLabel · $groupLabels';
  }

  Future<void> _editNote(
    BuildContext context,
    WidgetRef ref,
    MaterialItem item,
    String locale,
  ) async {
    final notifier = ref.read(renderFlowProvider.notifier);
    final current = ref.read(renderFlowProvider).selections[item.id];
    String? existingText;
    if (current != null) {
      for (final mod in current.modifiers) {
        if (mod is FreeTextNote) {
          existingText = mod.rawText;
          break;
        }
      }
    }
    final controller = TextEditingController(text: existingText ?? '');

    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                locale == 'he' ? item.labelHe : item.labelEn,
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 4),
              Text(
                'design_studio_screen.note_hint'.tr(),
                style: TextStyle(
                  color: ctx.palette.inkSoft,
                  fontSize: 12.5,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'design_studio_screen.note_field_hint'.tr(),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    final text = controller.text.trim();
                    notifier.setItemModifiers(
                      item.id,
                      text.isEmpty ? const [] : [FreeTextNote(text)],
                    );
                    Navigator.of(ctx).pop();
                  },
                  child: Text('design_studio_screen.note_save'.tr()),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// **סשן 15 (המשך 3).** רשימת "כרטיסי" תתי-קטגוריה של הקבוצה הפעילה —
/// המסך שנפתח כשבוחרים למשל "רהיטים". תתי-קטגוריות רלוונטיות לחדר
/// שנבחר (`SubcategorySummary.relevant`) מגיעות כבר ממוינות ראשונות
/// מ-`CategoryGroups.subcategoriesForRoomAndGroup` — כאן רק מציגים,
/// כולל תג "מומלץ לחדר שלך" על אלה הרלוונטיות.
class _SubcategoryListView extends StatelessWidget {
  final List<SubcategorySummary> subcategories;
  final String locale;
  final bool Function(String itemId) isSelected;
  final void Function(SubcategorySummary subcategory) onTap;

  const _SubcategoryListView({
    required this.subcategories,
    required this.locale,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.35,
      ),
      itemCount: subcategories.length,
      itemBuilder: (context, i) {
        final s = subcategories[i];
        final selectedCount =
            s.items.where((item) => isSelected(item.id)).length;
        return _SubcategoryCard(
          subcategory: s,
          locale: locale,
          selectedCount: selectedCount,
          onTap: () => onTap(s),
        );
      },
    );
  }
}

class _SubcategoryCard extends StatelessWidget {
  final SubcategorySummary subcategory;
  final String locale;
  final int selectedCount;
  final VoidCallback onTap;

  const _SubcategoryCard({
    required this.subcategory,
    required this.locale,
    required this.selectedCount,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final palette = context.palette;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selectedCount > 0 ? primary : palette.line,
            width: selectedCount > 0 ? 2 : 1,
          ),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            if (subcategory.relevant)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: palette.accentSoft,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: palette.accentSoftLine),
                ),
                child: Text(
                  'design_studio_screen.recommended_badge'.tr(),
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: primary,
                  ),
                ),
              )
            else
              const SizedBox(height: 19),
            const Spacer(),
            Text(
              subcategory.subcategory,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  'design_studio_screen.subcategory_item_count'
                      .tr(args: ['${subcategory.items.length}']),
                  style: TextStyle(
                    fontSize: 12,
                    color: palette.inkFaint,
                  ),
                ),
                if (selectedCount > 0) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.check_circle, size: 14, color: primary),
                  const SizedBox(width: 2),
                  Text(
                    '$selectedCount',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: primary,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// **סשן 15 (המשך 3).** רשימת הפריטים בתוך תת-קטגוריה אחת שנבחרה —
/// כותרת + חץ חזרה לרשימת תתי-הקטגוריות, ואז רשת הפריטים (אותו כרטיס
/// פריט כמו קודם, `_MaterialCard`, בלי שינוי בלוגיקת הבחירה/ההערות).
class _SubcategoryItemsView extends StatelessWidget {
  final SubcategorySummary subcategory;
  final String locale;
  final RenderFlowNotifier notifier;
  final bool Function(String itemId) isSelected;
  final bool Function(String itemId) hasNoteFor;
  final void Function(MaterialItem item) onNoteTap;
  final VoidCallback onBack;

  const _SubcategoryItemsView({
    required this.subcategory,
    required this.locale,
    required this.notifier,
    required this.isSelected,
    required this.hasNoteFor,
    required this.onNoteTap,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    final isRtl = locale == 'he' || locale == 'ar';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 20, 8),
          child: Row(
            children: [
              IconButton(
                icon: Icon(isRtl ? Icons.arrow_forward : Icons.arrow_back),
                tooltip: 'design_studio_screen.back_to_categories'.tr(),
                onPressed: onBack,
              ),
              Expanded(
                child: Text(
                  subcategory.subcategory,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.92,
            ),
            itemCount: subcategory.items.length,
            itemBuilder: (context, i) {
              final item = subcategory.items[i];
              final selected = isSelected(item.id);
              final hasNote = selected && hasNoteFor(item.id);
              return _MaterialCard(
                item: item,
                selected: selected,
                hasNote: hasNote,
                locale: locale,
                onTap: () => notifier.toggleItem(item),
                onNoteTap: selected ? () => onNoteTap(item) : null,
              );
            },
          ),
        ),
      ],
    );
  }
}

class _MaterialCard extends StatelessWidget {
  final MaterialItem item;
  final bool selected;
  final bool hasNote;
  final String locale;
  final VoidCallback onTap;
  final VoidCallback? onNoteTap;

  const _MaterialCard({
    required this.item,
    required this.selected,
    required this.hasNote,
    required this.locale,
    required this.onTap,
    required this.onNoteTap,
  });

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final palette = context.palette;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? primary : palette.line,
            width: selected ? 2 : 1,
          ),
        ),
        padding: const EdgeInsets.all(10),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: selected ? palette.accentSoft : palette.surface2,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: selected
                        ? Icon(Icons.check_circle, color: primary, size: 22)
                        : null,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  locale == 'he' ? item.labelHe : item.labelEn,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ),
            if (onNoteTap != null)
              Positioned(
                top: 0,
                right: locale == 'he' ? null : 0,
                left: locale == 'he' ? 0 : null,
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: onNoteTap,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardTheme.color,
                      shape: BoxShape.circle,
                      border: Border.all(color: palette.line),
                    ),
                    child: Icon(
                      hasNote ? Icons.edit_note : Icons.note_add_outlined,
                      size: 16,
                      color: hasNote ? primary : palette.inkFaint,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
</content>
SHIFT_EOF_MARKER
echo "נכתב: lib/features/design_studio/presentation/design_studio_screen.dart"

mkdir -p "$(dirname "lib/features/home/presentation/home_screen.dart")"
cat > lib/features/home/presentation/home_screen.dart << 'SHIFT_EOF_MARKER'
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
///
/// **סשן 10:** נוסף בדיוק אותו רעיון עבור מסכים 1-3 (לפני שההדמיה
/// בכלל נשלחה): אם `RenderFlowNotifier` שיחזר מהדיסק התקדמות שנשארה
/// תקועה (למשל כי המצלמה הרגה את התהליך אחרי בחירת חדר + חומרים —
/// ראו render_flow_notifier.dart), המשתמש מנווט אוטומטית בחזרה למסך
/// הנכון במקום להישאר במסך בית שנראה ריק וגורם לו לחשוב שהכל אבד.
///
/// **סשן 13 (המשך):** נוסף אייקון "החשבון שלי" בסרגל העליון, שמוביל
/// למסך ההתחברות/הרשמה (`AppRoutes.auth`) — ראו auth_screen.dart.
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
        return;
      }
    } catch (_) {
      // לא קריטי — אם הבדיקה נכשלת (למשל רשת), המשתמש פשוט לא יופנה
      // אוטומטית הפעם. ההדמיה עדיין בטוחה בשרת, ותופיע בגלריה שלו כשהיא
      // תסתיים, ותנוסה שוב הבדיקה הזו בפעם הבאה שהוא פותח את מסך הבית.
    }
    // אין הדמיה תקועה בשרת — עכשיו בודקים אם יש התקדמות מקומית (מסכים
    // 1-3, לפני השליחה) ששוחזרה מדיסק ועדיין לא טופלה (סשן 10).
    await _checkRecoveredFlow();
  }

  /// ראו התיעוד המלא ב-`RenderFlowNotifier.consumeColdStartRecovery`.
  Future<void> _checkRecoveredFlow() async {
    final notifier = ref.read(renderFlowProvider.notifier);
    final shouldResume = await notifier.consumeColdStartRecovery();
    if (!shouldResume || !mounted) return;

    final flow = ref.read(renderFlowProvider);
    if (flow.hasSelections) {
      // כבר יש חדר + קבוצות + לפחות פריט אחד נבחר — ממשיכים למסך העלאת
      // התמונה (גם אם כבר יש תמונה שוחזרה, המשתמש עדיין צריך ללחוץ
      // SHIFT בעצמו; לא שולחים הדמיה אוטומטית בלי אישורו).
      context.push(AppRoutes.uploadPhoto);
    } else {
      // יש חדר + קבוצות אבל עוד לא נבחרו פריטים — ממשיכים למסך החומרים.
      context.push(AppRoutes.designStudio);
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
            icon: Icon(
              Icons.photo_library_outlined,
              color: Theme.of(context).colorScheme.primary,
            ),
            tooltip: 'gallery_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.gallery),
          ),
          IconButton(
            icon: Icon(
              Icons.confirmation_number_outlined,
              color: Theme.of(context).colorScheme.primary,
            ),
            tooltip: 'coupon_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.coupon),
          ),
          IconButton(
            icon: Icon(
              Icons.person_outline,
              color: Theme.of(context).colorScheme.primary,
            ),
            tooltip: 'auth_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.auth),
          ),
          PopupMenuButton<Locale>(
            icon: Icon(
              Icons.language,
              color: Theme.of(context).colorScheme.primary,
            ),
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
SHIFT_EOF_MARKER
echo "נכתב: lib/features/home/presentation/home_screen.dart"

echo "✅✅ שלושת קבצי ה-Dart נכתבו במלואם"

cat > /tmp/_shift_patch_translations_subcat.py << 'PYEOF'
import json, io

NEW_KEYS = {
    "he": {
        "recommended_badge": "מומלץ לחדר שלך",
        "subcategory_item_count": "{} פריטים",
        "back_to_categories": "חזרה לקטגוריות",
    },
    "en": {
        "recommended_badge": "Recommended for your room",
        "subcategory_item_count": "{} items",
        "back_to_categories": "Back to categories",
    },
    "ar": {
        "recommended_badge": "موصى به لغرفتك",
        "subcategory_item_count": "{} عناصر",
        "back_to_categories": "العودة إلى الفئات",
    },
    "ru": {
        "recommended_badge": "Рекомендовано для вашей комнаты",
        "subcategory_item_count": "{} шт.",
        "back_to_categories": "Назад к категориям",
    },
}

for locale, keys in NEW_KEYS.items():
    path = f"assets/translations/{locale}.json"
    with io.open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    ds = data.setdefault("design_studio_screen", {})
    added = []
    for k, v in keys.items():
        if k not in ds:
            ds[k] = v
            added.append(k)
    if added:
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"תקין: {path} — נוספו מפתחות: {', '.join(added)}.")
    else:
        print(f"הערה: {path} כבר מכיל את כל המפתחות החדשים, לא נוגע בו.")

print("✅✅ תרגומים עודכנו")
PYEOF

python3 /tmp/_shift_patch_translations_subcat.py

echo ""
echo "=== סיימנו. השלבים הבאים: ==="
echo "1. git add -A && git commit -m 'session 15: room-relevance sorting + subcategory drill-down'"
echo "2. flutter analyze"
echo "3. flutter build apk --debug"
