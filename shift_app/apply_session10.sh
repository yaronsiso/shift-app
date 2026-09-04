#!/usr/bin/env bash
set -euo pipefail

# SHIFT — סשן 10: תיקון קריטי (חוזר למסך בית ריק אחרי צילום תמונה) +
# הסרת הגבלת סוג החדר על חומרים + חלוקה היררכית קטגוריה/תת-קטגוריה +
# 6 סוגי חדר חדשים + הרחבת משטחי עבודה/גימורי קצוות/ברזים במטבח.
# מריצים עם: bash /workspaces/shift-app/shift_app/apply_session10.sh
# (נתיב מלא — עובד לא משנה מאיזו תיקייה הטרמינל פתוח.)

cd /workspaces/shift-app/shift_app

mkdir -p lib/features/design_studio/presentation
mkdir -p lib/features/dictionary/data
mkdir -p lib/features/home/presentation
mkdir -p lib/features/prompt_engine
mkdir -p lib/features/render_flow/data

echo '>> כותב /workspaces/shift-app/shift_app/pubspec.yaml'
cat > '/workspaces/shift-app/shift_app/pubspec.yaml' << 'SHIFTEOF'
name: shift_app
description: "SHIFT — AI home & garden design visualization app for the Israeli market."
publish_to: "none"
version: 0.1.0+1

environment:
  sdk: ">=3.4.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter

  # State management & navigation (agreed stack)
  flutter_riverpod: ^2.5.1
  go_router: ^14.2.0

  # Backend (Supabase)
  supabase_flutter: ^2.5.6

  # i18n — he/ar/ru/en with RTL support
  easy_localization: ^3.0.7

  # Typography per design spec (Heebo/Assistant via Google Fonts)
  google_fonts: ^6.2.1
  image_picker: ^1.1.2
  share_plus: ^13.3.0

  # סשן 10: שמירת התקדמות הזרימה (render_flow) לדיסק, כדי שהיא תשרוד
  # הריגת תהליך ברקע ע"י מערכת ההפעלה (למשל בזמן שהמצלמה פתוחה) —
  # ראו render_flow_notifier.dart.
  shared_preferences: ^2.3.2

  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true

  assets:
    - assets/translations/
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/dictionary/data/material_item.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/dictionary/data/material_item.dart' << 'SHIFTEOF'
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
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/dictionary/data/note_modifier.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/dictionary/data/note_modifier.dart' << 'SHIFTEOF'
import 'material_item.dart';

/// שינוי מובנה שהלקוח מבקש להחיל על פריט שבחר.
///
/// אלה המקרים הנפוצים, והם נפתרים **מקומית באפליקציה** — בלי קריאת רשת,
/// בלי עלות, ובאופן צפוי לחלוטין. הלקוח בוחר אותם מתפריט קצר במקום
/// להקליד טקסט חופשי.
///
/// כל מה שלא נופל לכאן עובר למסלול הטקסט החופשי (ראו [FreeTextNote]).
sealed class NoteModifier {
  const NoteModifier();

  /// התיאור בעברית, להצגה ללקוח בסיכום הבחירות שלו.
  String describeHe(MaterialItem item);

  /// אילוץ באנגלית שייכנס לפרומפט הסופי.
  String constraintEn(MaterialItem item);

  /// סשן 10: סריאליזציה ל-JSON, לשמירת [RenderFlowState] בדיסק (ראו
  /// render_flow_notifier.dart) — כדי שבחירות המשתמש (כולל השינויים
  /// שהוא ביקש) ישרדו הריגת תהליך ברקע ולא רק קריסה של המסך.
  Map<String, dynamic> toJson();
}

/// "רק עד גובה מסוים" — הנפוץ ביותר. חיפוי קיר עד גובה מטר, ריצוף
/// שעולה על הקיר עד חצי גובה, פנל בגובה 7 ס"מ.
class HeightLimit extends NoteModifier {
  /// הגובה בסנטימטרים מהרצפה.
  final int centimeters;

  /// מה יהיה מעל הגובה הזה (אופציונלי) — למשל "צבע לבן".
  final String? aboveTreatmentEn;
  final String? aboveTreatmentHe;

  const HeightLimit(
    this.centimeters, {
    this.aboveTreatmentEn,
    this.aboveTreatmentHe,
  });

  @override
  String describeHe(MaterialItem item) {
    final base = 'רק עד גובה $centimeters ס"מ מהרצפה';
    return aboveTreatmentHe == null ? base : '$base, מעל זה $aboveTreatmentHe';
  }

  @override
  String constraintEn(MaterialItem item) {
    final base = 'applied only up to a height of $centimeters cm from the floor, '
        'with a clean horizontal termination line at that height';
    return aboveTreatmentEn == null
        ? base
        : '$base, and $aboveTreatmentEn above that line';
  }

  @override
  Map<String, dynamic> toJson() => {
        'type': 'heightLimit',
        'centimeters': centimeters,
        'aboveTreatmentEn': aboveTreatmentEn,
        'aboveTreatmentHe': aboveTreatmentHe,
      };
}

/// "לעצור X ס"מ לפני הקצה" — בדיוק המקרה שירון תיאר: ריצוף שנעצר
/// עשרה סנטימטר לפני סוף הקיר.
class StopShortOfEdge extends NoteModifier {
  final int centimeters;

  /// מאיזה קצה עוצרים.
  final EdgeReference edge;

  const StopShortOfEdge(this.centimeters, {this.edge = EdgeReference.wall});

  @override
  String describeHe(MaterialItem item) =>
      'לעצור $centimeters ס"מ לפני ${edge.labelHe}';

  @override
  String constraintEn(MaterialItem item) =>
      'stopping $centimeters cm short of ${edge.labelEn}, '
      'leaving a clean uncovered margin along that edge';

  @override
  Map<String, dynamic> toJson() => {
        'type': 'stopShortOfEdge',
        'centimeters': centimeters,
        'edge': edge.name,
      };
}

enum EdgeReference {
  wall('הקיר', 'the wall'),
  wallEnd('סוף הקיר', 'the end of the wall'),
  doorway('הפתח', 'the doorway'),
  ceiling('התקרה', 'the ceiling');

  final String labelHe;
  final String labelEn;
  const EdgeReference(this.labelHe, this.labelEn);
}

/// "רק על חלק מהמשטח" — קיר אחד בלבד, חצי קיר, רק אזור המקלחת.
class PartialCoverage extends NoteModifier {
  final CoverageScope scope;
  const PartialCoverage(this.scope);

  @override
  String describeHe(MaterialItem item) => scope.labelHe;

  @override
  String constraintEn(MaterialItem item) =>
      'applied ${scope.labelEn} only, leaving the remaining surfaces unchanged';

  @override
  Map<String, dynamic> toJson() => {
        'type': 'partialCoverage',
        'scope': scope.name,
      };
}

enum CoverageScope {
  singleFeatureWall('רק על קיר אחד (קיר נושא עיצוב)', 'to a single feature wall'),
  lowerHalf('רק על החצי התחתון של הקיר', 'to the lower half of the wall'),
  upperHalf('רק על החצי העליון של הקיר', 'to the upper half of the wall'),
  showerAreaOnly('רק באזור המקלחת', 'to the shower area'),
  behindFurnitureOnly('רק מאחורי הריהוט', 'to the wall behind the furniture');

  final String labelHe;
  final String labelEn;
  const CoverageScope(this.labelHe, this.labelEn);
}

/// כיוון הנחה — הרלוונטי בעיקר לריצוף ולחיפויים.
class LayoutDirection extends NoteModifier {
  final DirectionOption direction;
  const LayoutDirection(this.direction);

  @override
  String describeHe(MaterialItem item) => direction.labelHe;

  @override
  String constraintEn(MaterialItem item) => 'laid ${direction.labelEn}';

  @override
  Map<String, dynamic> toJson() => {
        'type': 'layoutDirection',
        'direction': direction.name,
      };
}

enum DirectionOption {
  horizontal('הנחה אופקית', 'in a horizontal orientation'),
  vertical('הנחה אנכית', 'in a vertical orientation'),
  diagonal('הנחה אלכסונית', 'in a diagonal orientation'),
  herringbone('הנחת פישבון', 'in a herringbone pattern');

  final String labelHe;
  final String labelEn;
  const DirectionOption(this.labelHe, this.labelEn);
}

/// טקסט חופשי שהלקוח הקליד בשפה שלו.
///
/// זה המסלול שדורש עיבוד בצד השרת: הטקסט נשלח ל-Edge Function יחד עם
/// תיאור הפריט, וחוזר כאילוץ מנוסח באנגלית. ראו [NoteResolver].
class FreeTextNote extends NoteModifier {
  /// מה שהלקוח הקליד, בשפת הממשק שלו (עברית / ערבית / רוסית / אנגלית).
  final String rawText;

  /// האילוץ המנוסח באנגלית, כפי שחזר מהשרת. `null` עד לפתרון.
  final String? resolvedEn;

  const FreeTextNote(this.rawText, {this.resolvedEn});

  bool get isResolved => resolvedEn != null && resolvedEn!.trim().isNotEmpty;

  FreeTextNote withResolution(String english) =>
      FreeTextNote(rawText, resolvedEn: english);

  @override
  String describeHe(MaterialItem item) => rawText;

  @override
  String constraintEn(MaterialItem item) {
    if (!isResolved) {
      throw StateError(
        'הערת טקסט חופשי טרם עובדה בשרת: "$rawText". '
        'יש להריץ NoteResolver לפני בניית הפרומפט.',
      );
    }
    return resolvedEn!.trim();
  }

  @override
  Map<String, dynamic> toJson() => {
        'type': 'freeTextNote',
        'rawText': rawText,
        'resolvedEn': resolvedEn,
      };
}

/// סשן 10: שחזור [NoteModifier] מ-JSON ששמר [NoteModifier.toJson].
/// מחזיר `null` (בלי לזרוק חריגה) על כל קלט לא תקין/לא מוכר — שחזור
/// מצב שנכשל בשקט תמיד עדיף על קריסה, ראו render_flow_state.dart.
NoteModifier? noteModifierTryFromJson(Map<String, dynamic> json) {
  try {
    switch (json['type'] as String?) {
      case 'heightLimit':
        return HeightLimit(
          json['centimeters'] as int,
          aboveTreatmentEn: json['aboveTreatmentEn'] as String?,
          aboveTreatmentHe: json['aboveTreatmentHe'] as String?,
        );
      case 'stopShortOfEdge':
        return StopShortOfEdge(
          json['centimeters'] as int,
          edge: EdgeReference.values.byName(json['edge'] as String),
        );
      case 'partialCoverage':
        return PartialCoverage(
          CoverageScope.values.byName(json['scope'] as String),
        );
      case 'layoutDirection':
        return LayoutDirection(
          DirectionOption.values.byName(json['direction'] as String),
        );
      case 'freeTextNote':
        return FreeTextNote(
          json['rawText'] as String,
          resolvedEn: json['resolvedEn'] as String?,
        );
      default:
        return null;
    }
  } catch (_) {
    return null;
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/dictionary/data/room_types_data.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/dictionary/data/room_types_data.dart' << 'SHIFTEOF'
// נוצר אוטומטית מ-build_dict_data.py — אין לערוך ידנית.

import 'room_type.dart';

const List<RoomType> kRoomTypes = [
  RoomType(
    code: 'living',
    labelHe: 'סלון',
    labelEn: 'Living room',
    isExterior: false,
  ),
  RoomType(
    code: 'bedroom',
    labelHe: 'חדר שינה',
    labelEn: 'Bedroom',
    isExterior: false,
  ),
  RoomType(
    code: 'mamad',
    labelHe: 'ממ"ד',
    labelEn: 'MAMAD (safe room)',
    isExterior: false,
  ),
  RoomType(
    code: 'kids',
    labelHe: 'חדר ילדים',
    labelEn: 'Kids room',
    isExterior: false,
  ),
  RoomType(
    code: 'kitchen',
    labelHe: 'מטבח',
    labelEn: 'Kitchen',
    isExterior: false,
  ),
  RoomType(
    code: 'bathroom',
    labelHe: 'חדר רחצה',
    labelEn: 'Bathroom',
    isExterior: false,
  ),
  RoomType(
    code: 'office',
    labelHe: 'משרד / חדר עבודה',
    labelEn: 'Home office',
    isExterior: false,
  ),
  RoomType(
    code: 'balcony',
    labelHe: 'מרפסת',
    labelEn: 'Balcony / terrace',
    isExterior: false,
  ),
  RoomType(
    code: 'facade',
    labelHe: 'חזית הבית',
    labelEn: 'House facade',
    isExterior: true,
  ),
  RoomType(
    code: 'yard',
    labelHe: 'חצר וגינה',
    labelEn: 'Yard & garden',
    isExterior: true,
  ),
  // ---------------- חדרים נוספים (סשן 10, בקשת ירון) ----------------
  RoomType(
    code: 'dining',
    labelHe: 'פינת אוכל / חדר אוכל',
    labelEn: 'Dining area',
    isExterior: false,
  ),
  RoomType(
    code: 'hallway',
    labelHe: 'מסדרון',
    labelEn: 'Hallway',
    isExterior: false,
  ),
  RoomType(
    code: 'wc',
    labelHe: 'שירותים',
    labelEn: 'Powder room (WC)',
    isExterior: false,
  ),
  RoomType(
    code: 'closet_room',
    labelHe: 'חדר ארונות',
    labelEn: 'Walk-in closet',
    isExterior: false,
  ),
  RoomType(
    code: 'rental_unit',
    labelHe: 'יחידת דיור',
    labelEn: 'Rental unit / studio',
    isExterior: false,
  ),
  RoomType(
    code: 'whole_house',
    labelHe: 'הבית כולו',
    labelEn: 'Whole house',
    isExterior: false,
  ),
];
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/prompt_engine/prompt_engine.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/prompt_engine/prompt_engine.dart' << 'SHIFTEOF'
import '../dictionary/data/material_item.dart';
import '../dictionary/data/room_type.dart';
import '../dictionary/data/protected_element.dart';
import '../dictionary/data/note_modifier.dart';
import '../dictionary/data/materials_data.dart';
import '../dictionary/data/room_types_data.dart';
import '../dictionary/data/protected_elements_data.dart';

/// בחירה בודדת של המשתמש: פריט מהמילון, ואופציונלית שינויים שביקש עליו.
///
/// [modifiers] הם הדרישה שנקבעה בסשן 4 (סעיף 7 ב-claude/07): הזיהוי
/// האוטומטי של אזורי החדר לא תמיד תואם את כוונת הלקוח. לקוח שרוצה לרצף
/// את הרצפה אבל שהריצוף ייעצר עשרה סנטימטר לפני הקיר, או לחפות את הקיר
/// רק עד גובה מטר — צריך דרך להגיד את זה.
class MaterialSelection {
  final MaterialItem item;

  /// שינויים שהלקוח ביקש להחיל על הפריט. ריק ברוב המקרים.
  final List<NoteModifier> modifiers;

  const MaterialSelection({
    required this.item,
    this.modifiers = const [],
  });

  bool get hasModifiers => modifiers.isNotEmpty;

  /// סיכום הבחירה בעברית — להצגה ללקוח במסך הסיכום לפני יצירת ההדמיה.
  String summaryHe() {
    if (!hasModifiers) return item.labelHe;
    final mods = modifiers.map((m) => m.describeHe(item)).join(', ');
    return '${item.labelHe} — $mods';
  }

  /// סשן 10: סריאליזציה ל-JSON לשמירת [RenderFlowState] בדיסק — ראו
  /// render_flow_notifier.dart. שומרים רק את מזהה הפריט (לא את כל
  /// השדות שלו) — הוא משוחזר בזמן הטעינה מתוך [kMaterials], מקור
  /// האמת העדכני, כדי שעדכון עתידי של המילון לא ישאיר עותקים ישנים.
  Map<String, dynamic> toJson() => {
        'itemId': item.id,
        'modifiers': modifiers.map((m) => m.toJson()).toList(),
      };

  /// שחזור מ-JSON ששמר [toJson]. מחזיר `null` (בלי לזרוק חריגה) אם
  /// מזהה הפריט לא נמצא ב-[kMaterials] (למשל המילון התעדכן מאז השמירה)
  /// או אם ה-JSON פגום מכל סיבה — שחזור שנכשל בשקט תמיד עדיף על קריסה.
  static MaterialSelection? tryFromJson(Map<String, dynamic> json) {
    try {
      final itemId = json['itemId'] as String?;
      if (itemId == null) return null;
      final item = PromptEngine.itemById(itemId);
      if (item == null) return null;
      final modifiers = <NoteModifier>[];
      final modsJson = json['modifiers'];
      if (modsJson is List) {
        for (final raw in modsJson) {
          if (raw is! Map) continue;
          final mod = noteModifierTryFromJson(Map<String, dynamic>.from(raw));
          if (mod != null) modifiers.add(mod);
        }
      }
      return MaterialSelection(item: item, modifiers: modifiers);
    } catch (_) {
      return null;
    }
  }
}

/// התוצר של המנוע — כל מה שנדרש כדי לקרוא ל-Replicate.
class RenderJob {
  final String prompt;
  final String negativePrompt;
  final double promptStrength;
  final double guidanceScale;
  final int numInferenceSteps;

  /// שמות האלמנטים (באנגלית) שיש למסך ולהחזיר לתמונה אחרי היצירה.
  final List<String> protectedLabels;

  /// האם הבחירות כוללות שינוי קונסטרוקטיבי — לדיבוג ולתצוגה.
  final bool hasConstructiveChange;

  const RenderJob({
    required this.prompt,
    required this.negativePrompt,
    required this.promptStrength,
    required this.guidanceScale,
    required this.numInferenceSteps,
    required this.protectedLabels,
    required this.hasConstructiveChange,
  });

  Map<String, dynamic> toReplicateInput() => {
        'prompt': prompt,
        'negative_prompt': negativePrompt,
        'prompt_strength': promptStrength,
        'guidance_scale': guidanceScale,
        'num_inference_steps': numInferenceSteps,
      };
}

/// מנוע הפרומפטים של SHIFT.
///
/// מתרגם בחירות בעברית לפרומפט טכני מלא באנגלית, וגוזר אוטומטית את
/// הפרמטרים שננעלו בשלב 3. זהו הנכס הייחודי של האפליקציה.
///
/// כל ההגדרות המספריות נעולות לפי ממצאי claude/07 ואין לשנותן בלי
/// בדיקה חוזרת מול המודל.
class PromptEngine {
  /// ברירת המחדל של המודל היא 15 — היא הייתה הגורם המרכזי לסטיות
  /// מהמבנה המקורי. 7.5 הוא הערך שנבדק ואומת.
  static const double guidanceScale = 7.5;

  static const int numInferenceSteps = 50;

  /// שינויי משטח: ריצוף, צבע, חיפוי, ריהוט. המודל "צובע מחדש" משטח קיים.
  static const double strengthSurface = 0.55;

  /// שינויים קונסטרוקטיביים: תקרת גבס, נישה, סרגלי עץ, פרגולה.
  /// המודל נדרש להוסיף מבנה שלא היה — ערך נמוך מדכא את זה.
  static const double strengthConstructive = 0.65;

  static const String _prefixInterior =
      'A high-end photorealistic interior design render of an Israeli';
  static const String _prefixExterior =
      'A high-end photorealistic exterior architectural render of an Israeli';

  static const String _suffix =
      '8k resolution, architectural photography, highly detailed';

  /// נגטיב-בסיס.
  ///
  /// שים לב (הערה משנית ב-claude/07): כתיבת נגטיב מותאם **מוחקת** את
  /// ברירת המחדל של המודל, ולכן משרשרים במקום להחליף. יוצר המודל הכניס
  /// לברירת המחדל את `mirror, mirrored` — הוא הכיר בנטייה של המודל
  /// להוסיף אלמנטים "פותחי חלל", בדיוק כמו החלון שהומצא בבדיקות.
  static const String negativeBase =
      'changing room structure, moving walls, different window positions, '
      'distorted perspective, warped geometry, extra windows, extra doors, '
      'mirror, mirrored, '
      'blurry, low quality, watermark, text, cartoon, illustration';

  // ---------- גישה לנתונים ----------

  static final Map<String, MaterialItem> _byId = {
    for (final m in kMaterials) m.id: m,
  };

  static final Map<String, RoomType> _roomsByCode = {
    for (final r in kRoomTypes) r.code: r,
  };

  static MaterialItem? itemById(String id) => _byId[id];

  static RoomType? roomByCode(String code) => _roomsByCode[code];

  /// כל הפריטים הרלוונטיים לסוג חדר — מזין את הצ'יפים במסך 2.
  static List<MaterialItem> itemsForRoom(String roomTypeCode) =>
      kMaterials.where((m) => m.isAvailableIn(roomTypeCode)).toList();

  /// הפריטים של קטגוריה אחת בתוך סוג חדר.
  static List<MaterialItem> itemsForRoomAndCategory(
    String roomTypeCode,
    String category,
  ) =>
      kMaterials
          .where((m) => m.isAvailableIn(roomTypeCode) && m.category == category)
          .toList();

  /// שמות הקטגוריות הזמינות בסוג חדר, לפי סדר ההופעה במילון.
  static List<String> categoriesForRoom(String roomTypeCode) {
    final seen = <String>[];
    for (final m in kMaterials) {
      if (m.isAvailableIn(roomTypeCode) && !seen.contains(m.category)) {
        seen.add(m.category);
      }
    }
    return seen;
  }

  /// האלמנטים המוגנים שחלים על סוג חדר — הגלובליים ועוד הספציפיים לו.
  static List<ProtectedElement> protectedFor(String roomTypeCode) {
    final room = _roomsByCode[roomTypeCode];
    if (room == null) return const [];
    return kProtectedElements
        .where((p) => p.isGlobal || p.roomScopeHe == room.labelHe)
        .toList();
  }

  // ---------- בניית הפרומפט ----------

  /// בונה את בקשת הרינדור המלאה מבחירות המשתמש.
  ///
  /// כלל מחייב (מסקנה 3 ב-claude/07): הפרומפט נבנה **אך ורק** מבחירות
  /// המשתמש. אזכור של קטגוריה שהמשתמש לא נגע בה הוא הזמנה למודל להמציא.
  /// אם המשתמש לא בחר כלום מ"אלומיניום ופתחים" — המילה `windows` לא
  /// תופיע בפרומפט. אף פעם.
  ///
  /// **חשוב:** אם יש בבחירות [FreeTextNote] שטרם עובדה בשרת, הקריאה
  /// תיכשל. יש להריץ `resolveAll` מ-note_resolver.dart קודם.
  static RenderJob build({
    required String roomTypeCode,
    required List<MaterialSelection> selections,
  }) {
    final room = _roomsByCode[roomTypeCode];
    if (room == null) {
      throw ArgumentError('סוג חדר לא מוכר: $roomTypeCode');
    }
    if (selections.isEmpty) {
      throw ArgumentError('לא נבחר אף פריט — אין ממה לבנות פרומפט.');
    }

    final prefix = room.isExterior ? _prefixExterior : _prefixInterior;

    final segments = <String>['$prefix ${room.labelEn}'];
    final overrides = <String>[];
    var hasConstructive = false;

    for (final sel in selections) {
      if (sel.item.isConstructive) hasConstructive = true;

      // גוף הפריט נכנס כמו שהוא.
      segments.add(sel.item.promptEn);

      // השינויים נאספים בנפרד ומנוסחים כהוראות-על בסוף הפרומפט.
      //
      // הסיבה: שינוי שמוצמד לפריט יוצר סתירה בתוך אותו משפט. פריט
      // שאומר "full-height cladding to the ceiling" עם הערה "רק עד גובה
      // מטר" צמודה אליו = שתי הוראות הפוכות זו לצד זו, והמודל בוחר
      // אקראית. הוראת-על בסוף מכריעה במפורש מול התיאור המקורי.
      for (final mod in sel.modifiers) {
        overrides.add(mod.constraintEn(sel.item));
      }
    }

    if (overrides.isNotEmpty) {
      segments.add(
        'important, these requirements override the descriptions above: '
        '${overrides.join('; ')}',
      );
    }

    segments.add(_suffix);

    return RenderJob(
      prompt: segments.join(', '),
      negativePrompt: negativeBase,
      promptStrength: hasConstructive ? strengthConstructive : strengthSurface,
      guidanceScale: guidanceScale,
      numInferenceSteps: numInferenceSteps,
      protectedLabels:
          protectedFor(roomTypeCode).map((p) => p.labelEn).toList(),
      hasConstructiveChange: hasConstructive,
    );
  }

  /// עוזר נוחות לבנייה ממזהים בלבד, בלי שינויים.
  static RenderJob buildFromIds({
    required String roomTypeCode,
    required List<String> itemIds,
  }) {
    final sels = <MaterialSelection>[];
    for (final id in itemIds) {
      final item = _byId[id];
      if (item == null) throw ArgumentError('פריט לא מוכר: $id');
      sels.add(MaterialSelection(item: item));
    }
    return build(roomTypeCode: roomTypeCode, selections: sels);
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/render_flow/data/render_flow_state.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/render_flow/data/render_flow_state.dart' << 'SHIFTEOF'
import 'package:flutter/foundation.dart';

import '../../prompt_engine/prompt_engine.dart';

/// המצב החי שנצבר לאורך מסכים 1-3 (בית → חומרים → העלאת תמונה), לפני
/// שנשלחת בקשת ההדמיה בפועל דרך RenderService (שלב 5). מתאפס אחרי כל
/// הדמיה (מוצלחת או לא) כדי שהמחזור הבא יתחיל נקי.
@immutable
class RenderFlowState {
  /// קוד סוג החדר שנבחר במסך הבית (למשל 'living', 'mamad').
  final String? roomTypeCode;

  /// קודי קבוצות-העל שנבחרו במסך הבית ('color', 'furniture', 'materials',
  /// 'lighting', 'garden', 'more').
  final Set<String> selectedGroupCodes;

  /// הבחירות בפועל ממסך החומרים, לפי מזהה פריט (MaterialItem.id).
  final Map<String, MaterialSelection> selections;

  /// נתיב מקומי לתמונה שנבחרה במסך העלאת התמונה (לפני העלאה ל-Storage).
  final String? localImagePath;

  const RenderFlowState({
    this.roomTypeCode,
    this.selectedGroupCodes = const {},
    this.selections = const {},
    this.localImagePath,
  });

  bool get hasRoomAndGroups => roomTypeCode != null && selectedGroupCodes.isNotEmpty;

  bool get hasSelections => selections.isNotEmpty;

  /// true = כל התנאים להצגת כפתור ה-SHIFT מתקיימים (מסך 3).
  bool get readyForShift => hasRoomAndGroups && hasSelections && localImagePath != null;

  List<MaterialSelection> get selectionsList => selections.values.toList();

  RenderFlowState copyWith({
    String? roomTypeCode,
    Set<String>? selectedGroupCodes,
    Map<String, MaterialSelection>? selections,
    String? localImagePath,
  }) {
    return RenderFlowState(
      roomTypeCode: roomTypeCode ?? this.roomTypeCode,
      selectedGroupCodes: selectedGroupCodes ?? this.selectedGroupCodes,
      selections: selections ?? this.selections,
      localImagePath: localImagePath ?? this.localImagePath,
    );
  }

  /// סשן 10 — תיקון קריטי (חוזר למסך בית ריק אחרי צילום): סריאליזציה
  /// ל-JSON פשוט (Map/List/String/bool בלבד) שאפשר לקודד עם `jsonEncode`
  /// ולשמור ב-SharedPreferences. ראו render_flow_notifier.dart להסבר
  /// המלא על הבאג ועל התיקון.
  Map<String, dynamic> toJson() {
    return {
      'roomTypeCode': roomTypeCode,
      'selectedGroupCodes': selectedGroupCodes.toList(),
      'selections': selections.values.map((s) => s.toJson()).toList(),
      'localImagePath': localImagePath,
    };
  }

  /// שחזור ממה ש-[toJson] שמר. **סלחני מאוד בכוונה:** כל שדה חסר/פגום
  /// גורם להתעלמות שקטה ממנו (במקום זריקת חריגה) — המטרה של כל המנגנון
  /// הזה היא בדיוק למנוע איבוד מידע וקריסה, אז שגיאת שחזור לא אמורה
  /// בעצמה לגרום לתקלה. פריט ששוחזר עם מזהה שכבר לא קיים במילון (למשל
  /// אחרי עדכון גרסה) פשוט נשמט על ידי [MaterialSelection.tryFromJson].
  static RenderFlowState fromJson(Map<String, dynamic> json) {
    try {
      final selectionsJson = json['selections'];
      final selections = <String, MaterialSelection>{};
      if (selectionsJson is List) {
        for (final raw in selectionsJson) {
          if (raw is! Map) continue;
          final sel =
              MaterialSelection.tryFromJson(Map<String, dynamic>.from(raw));
          if (sel != null) selections[sel.item.id] = sel;
        }
      }
      final groupsJson = json['selectedGroupCodes'];
      return RenderFlowState(
        roomTypeCode: json['roomTypeCode'] as String?,
        selectedGroupCodes: groupsJson is List
            ? groupsJson.map((e) => e.toString()).toSet()
            : const {},
        selections: selections,
        localImagePath: json['localImagePath'] as String?,
      );
    } catch (_) {
      return const RenderFlowState();
    }
  }
}
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/render_flow/data/render_flow_notifier.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/render_flow/data/render_flow_notifier.dart' << 'SHIFTEOF'
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../prompt_engine/prompt_engine.dart';
import 'render_flow_state.dart';

/// מפתח השמירה ב-SharedPreferences. כולל מספר גרסה (`v1`) בכוונה: אם
/// אי-פעם נשנה את מבנה ה-JSON בצורה לא-תואמת-לאחור, מעלים ל-`v2` כדי
/// שמכשירים ישנים לא ינסו לפענח נתונים במבנה הישן (למרות ש-`fromJson`
/// כבר סלחני ומטפל בזה בעצמו).
const _kPrefsKey = 'shift.render_flow_state.v1';

/// מנהל את [RenderFlowState] לאורך מסכים 1-3. חי ב-`ProviderScope` הראשי
/// (לא `autoDispose`) כדי שהמצב ישרוד ניווט בין המסכים; מאופס במפורש
/// (`reset()`) אחרי שהדמיה נשלחה בהצלחה או כשחוזרים למסך הבית מחדש.
///
/// **סשן 10 — תיקון קריטי (חוזר למסך בית ריק אחרי צילום תמונה):** עד
/// עכשיו המצב הזה חי רק בזיכרון. כשהמצלמה נפתחת (image_picker), מערכת
/// ההפעלה — בעיקר אנדרואיד, אך זה קורה גם באייפון — עלולה **להרוג את
/// תהליך האפליקציה כדי לפנות זיכרון** בזמן שהמצלמה פתוחה במסך המלא;
/// זו התנהגות תקנית ומתועדת של המערכת (במיוחד במכשירים חלשים/עמוסים),
/// לא תקלה באפליקציה. כשהאפליקציה עולה מחדש, כל המצב היה נמחק — ומסך
/// העלאת התמונה (שדורש roomType+groups) היה מיד מחזיר את המשתמש למסך
/// הבית, בדיוק הבאג שירון דיווח עליו אחרי בחירת חדר שינה + מיטה +
/// צילום תמונה.
///
/// התיקון, בשלוש שכבות יחד:
/// 1. כל שינוי במצב נשמר מיד לדיסק (SharedPreferences) — [_persist].
/// 2. נטען מחדש מיד כשהאפליקציה עולה — [_loadPersisted], מופעל
///    מהבנאי, ונחשף כ-[_initialLoad] כדי שאפשר להמתין לו במקום לקרוא
///    את ה-state לפני שהטעינה הסתיימה.
/// 3. `ImagePicker().retrieveLostData()` — API ייעודי של image_picker
///    בדיוק למקרה הזה — משחזר גם תמונה שצולמה ממש ברגע שהתהליך נהרג,
///    לפני שהקולבק הרגיל של `pickImage` הספיק לחזור.
///
/// מסך הבית (`home_screen.dart`, ראו [consumeColdStartRecovery]) בודק
/// פעם אחת בכל עליית אפליקציה אם יש התקדמות ששוחזרה, ואם כן — מנווט את
/// המשתמש אוטומטית בחזרה למסך הנכון במקום להשאיר אותו במסך בית ריק
/// בלי שום הסבר.
class RenderFlowNotifier extends StateNotifier<RenderFlowState> {
  RenderFlowNotifier() : super(const RenderFlowState()) {
    _initialLoad = _loadPersisted();
  }

  late final Future<void> _initialLoad;
  bool _coldStartChecked = false;

  /// בחירת סוג חדר במסך הבית. מאפס את שאר הבחירות — הן תלויות בחדר
  /// (קבוצות-על זמינות, ופריטים בתוכן), אז בחירת חדר אחר מתחילה מחדש.
  void selectRoomType(String code) {
    state = RenderFlowState(roomTypeCode: code);
    _persist();
  }

  /// הפעלה/כיבוי של קבוצת-על אחת (צבע/רהיטים/חומרי בנייה/תאורה/גינה/ועוד).
  void toggleGroup(String groupCode) {
    final next = Set<String>.from(state.selectedGroupCodes);
    if (!next.remove(groupCode)) next.add(groupCode);
    state = state.copyWith(selectedGroupCodes: next);
    _persist();
  }

  /// הפעלה/כיבוי של פריט בודד במסך החומרים.
  void toggleItem(MaterialItem item) {
    final next = Map<String, MaterialSelection>.from(state.selections);
    if (next.containsKey(item.id)) {
      next.remove(item.id);
    } else {
      next[item.id] = MaterialSelection(item: item);
    }
    state = state.copyWith(selections: next);
    _persist();
  }

  bool isSelected(String itemId) => state.selections.containsKey(itemId);

  /// עדכון השינויים (הערה מיוחדת) על פריט שכבר נבחר. לא עושה כלום אם
  /// הפריט לא נבחר — קודם צריך `toggleItem`.
  void setItemModifiers(String itemId, List<NoteModifier> modifiers) {
    final existing = state.selections[itemId];
    if (existing == null) return;
    final next = Map<String, MaterialSelection>.from(state.selections);
    next[itemId] = MaterialSelection(item: existing.item, modifiers: modifiers);
    state = state.copyWith(selections: next);
    _persist();
  }

  /// שמירת התמונה שנבחרה במסך העלאת התמונה.
  void setLocalImage(String localPath) {
    state = state.copyWith(localImagePath: localPath);
    _persist();
  }

  /// איפוס מלא — אחרי שליחת הדמיה (הצלחה או כישלון), או חזרה למסך הבית.
  void reset() {
    state = const RenderFlowState();
    _persist();
  }

  /// לשימוש פעם אחת בלבד, ממסך הבית, מיד אחרי עליית האפליקציה (ראו
  /// `home_screen.dart`): אם יש התקדמות ששוחזרה מדיסק (כי התהליך נהרג
  /// ברקע) שעדיין לא טופלה, מחזירה `true` — כדי שמסך הבית ינווט את
  /// המשתמש בחזרה למקום שבו הוא הפסיק, במקום להשאיר אותו במסך ריק.
  ///
  /// בכל קריאה נוספת (כולל אם המשתמש עצמו חוזר למסך הבית באמצע התהליך,
  /// למשל כדי להתחיל מחדש ביוזמתו) מחזירה `false` — זה לא אמור לדחוף
  /// אותו בחזרה בכוח נגד רצונו. ממתינה ל-[_initialLoad] כדי שהבדיקה
  /// לעולם לא תרוץ לפני שהשחזור מהדיסק באמת הסתיים.
  Future<bool> consumeColdStartRecovery() async {
    if (_coldStartChecked) return false;
    await _initialLoad;
    if (_coldStartChecked) return false;
    _coldStartChecked = true;
    return state.hasRoomAndGroups;
  }

  Future<void> _loadPersisted() async {
    RenderFlowState recovered = const RenderFlowState();
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kPrefsKey);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          recovered = RenderFlowState.fromJson(Map<String, dynamic>.from(decoded));
        }
      }
    } catch (_) {
      // שחזור המצב עצמו אף פעם לא אמור להפיל את האפליקציה — במקרה של
      // כשל פשוט ממשיכים עם מצב ריק, בדיוק כמו לפני התיקון הזה.
    }

    try {
      final lost = await ImagePicker().retrieveLostData();
      if (!lost.isEmpty && lost.file != null) {
        recovered = recovered.copyWith(localImagePath: lost.file!.path);
      }
    } catch (_) {
      // retrieveLostData נתמך רק באנדרואיד — בפלטפורמות אחרות (או אם
      // התוסף זורק מכל סיבה) פשוט מתעלמים וממשיכים עם מה ששוחזר עד כה.
    }

    if (!mounted) return;
    state = recovered;
  }

  void _persist() {
    // fire-and-forget בכוונה: המסכים לא ממתינים לשמירה כדי להמשיך —
    // היא תמיד מתבצעת ברקע. אם היא נכשלת (למשל דיסק מלא), זה לא אמור
    // להפיל את הזרימה החיה בזיכרון, רק לפגוע בשחזור העתידי.
    SharedPreferences.getInstance().then((prefs) {
      final hasContent = state.hasRoomAndGroups ||
          state.hasSelections ||
          state.localImagePath != null;
      if (hasContent) {
        prefs.setString(_kPrefsKey, jsonEncode(state.toJson()));
      } else {
        prefs.remove(_kPrefsKey);
      }
    }).catchError((_) {});
  }
}

final renderFlowProvider =
    StateNotifierProvider<RenderFlowNotifier, RenderFlowState>(
  (ref) => RenderFlowNotifier(),
);
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/home/presentation/home_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/home/presentation/home_screen.dart' << 'SHIFTEOF'
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
            icon: const Icon(Icons.photo_library_outlined),
            tooltip: 'gallery_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.gallery),
          ),
          IconButton(
            icon: const Icon(Icons.confirmation_number_outlined),
            tooltip: 'coupon_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.coupon),
          ),
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
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
SHIFTEOF

echo '>> כותב /workspaces/shift-app/shift_app/lib/features/design_studio/presentation/design_studio_screen.dart'
cat > '/workspaces/shift-app/shift_app/lib/features/design_studio/presentation/design_studio_screen.dart' << 'SHIFTEOF'
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
/// כטאבים; לכל טאב — רשימת פריטים מהמילון, מקובצת לפי **קטגוריה ← תת-
/// קטגוריה** (סשן 10 — ראו למטה), לא רשת שטוחה אחת מעורבבת. לכל
/// פריט **נבחר** אפשר להוסיף הערה חופשית (`FreeTextNote`) — מתועדת כמו
/// שהיא, ומעובדת לאילוץ באנגלית בשרת רק בזמן היצירה עצמה
/// (note_resolver.ts, שלב 5). **אין כאן צילום תמונה** — זה עבר במפורש
/// למסך נפרד לפי בקשת ירון (ראו home_screen.dart).
///
/// **סשן 10 — שני שינויים לפי משוב ירון:**
/// 1. הפריטים הזמינים בכל קבוצת-על **כבר לא מסוננים לפי סוג החדר** —
///    `MaterialItem.isAvailableIn` תמיד מחזירה `true` כעת (ראו
///    material_item.dart). "לא צריך להיות מתוייג כלום... הכל צריך
///    להיות פתוח לו... בכל חדר וחדר לא להגביל אנשים."
/// 2. הרשת השטוחה הוחלפה בחלוקה היררכית קטגוריה ← תת-קטגוריה, עם
///    כותרת לכל רמה — למשל בתוך "רהיטים": "מיטות", "מראות", "יחידת
///    טלוויזיה" וכו' כל אחת בנפרד, ולא כל הרהיטים מעורבבים ברשת אחת.
class DesignStudioScreen extends ConsumerStatefulWidget {
  const DesignStudioScreen({super.key});

  @override
  ConsumerState<DesignStudioScreen> createState() =>
      _DesignStudioScreenState();
}

class _DesignStudioScreenState extends ConsumerState<DesignStudioScreen> {
  String? _activeGroupCode;

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
        if (context.mounted) context.go(AppRoutes.home);
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    final groups = kCategoryGroups
        .where((g) => flow.selectedGroupCodes.contains(g.code))
        .toList();
    if (groups.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go(AppRoutes.home);
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    if (_activeGroupCode == null ||
        !groups.any((g) => g.code == _activeGroupCode)) {
      _activeGroupCode = groups.first.code;
    }
    final activeGroup =
        groups.firstWhere((g) => g.code == _activeGroupCode);

    final items =
        CategoryGroups.itemsForRoomAndGroup(roomType, activeGroup.code);
    final sections = _groupByCategoryAndSubcategory(items);

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
                    onSelected: (_) =>
                        setState(() => _activeGroupCode = g.code),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: sections.isEmpty
                  ? Center(
                      child: Text(
                        'design_studio_screen.no_items'.tr(),
                        style: TextStyle(color: context.palette.inkFaint),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      itemCount: sections.length,
                      itemBuilder: (context, i) {
                        final section = sections[i];
                        return _CategorySection(
                          section: section,
                          locale: locale,
                          notifier: notifier,
                          isSelected: notifier.isSelected,
                          hasNoteFor: (id) =>
                              flow.selections[id]?.hasModifiers ?? false,
                          onNoteTap: (item) =>
                              _editNote(context, ref, item, locale),
                        );
                      },
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

  /// **סשן 10:** מקבץ את הפריטים הזמינים לפי `category` ואז לפי
  /// `subcategory` בתוכה, בסדר ההופעה המקורי במילון (לא ממוין מחדש) —
  /// כך שהסדר הקיים והמכוון של המילון (claude/08) נשמר, רק מוצג
  /// בצורה היררכית ברורה במקום רשת שטוחה אחת מעורבבת. `Map` הרגיל של
  /// Dart שומר על סדר הכנסה, אז מספיק לעבור על `items` פעם אחת.
  List<_CategoryBlock> _groupByCategoryAndSubcategory(
    List<MaterialItem> items,
  ) {
    final byCategory = <String, Map<String, List<MaterialItem>>>{};
    for (final item in items) {
      final bySub = byCategory.putIfAbsent(item.category, () => {});
      bySub.putIfAbsent(item.subcategory, () => []).add(item);
    }
    return byCategory.entries
        .map(
          (catEntry) => _CategoryBlock(
            category: catEntry.key,
            subcategories: catEntry.value.entries
                .map(
                  (subEntry) => _SubcategoryBlock(
                    subcategory: subEntry.key,
                    items: subEntry.value,
                  ),
                )
                .toList(),
          ),
        )
        .toList();
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

/// קטגוריה מפורטת אחת (למשל "ריהוט") וכל תתי-הקטגוריות שבתוכה, בהקשר
/// קבוצת-העל הפעילה (סשן 10).
class _CategoryBlock {
  final String category;
  final List<_SubcategoryBlock> subcategories;
  const _CategoryBlock({required this.category, required this.subcategories});
}

/// תת-קטגוריה אחת (למשל "מיטות") וכל הפריטים שבתוכה.
class _SubcategoryBlock {
  final String subcategory;
  final List<MaterialItem> items;
  const _SubcategoryBlock({required this.subcategory, required this.items});
}

/// כותרת קטגוריה + כל תתי-הקטגוריות שלה, כל אחת עם כותרת-משנה ורשת
/// פריטים משלה. לא גוללת בעצמה — היא חלק מ-`ListView` חיצוני אחד.
class _CategorySection extends StatelessWidget {
  final _CategoryBlock section;
  final String locale;
  final RenderFlowNotifier notifier;
  final bool Function(String itemId) isSelected;
  final bool Function(String itemId) hasNoteFor;
  final void Function(MaterialItem item) onNoteTap;

  const _CategorySection({
    required this.section,
    required this.locale,
    required this.notifier,
    required this.isSelected,
    required this.hasNoteFor,
    required this.onNoteTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Text(
          section.category,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        for (final sub in section.subcategories) ...[
          const SizedBox(height: 10),
          Text(
            sub.subcategory,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.92,
            ),
            itemCount: sub.items.length,
            itemBuilder: (context, i) {
              final item = sub.items[i];
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
        ],
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
SHIFTEOF

echo '>> מוסיף 14 פריטי מטבח חדשים (משטחי עבודה/גימורי קצוות/ברזים) ל-materials_data.dart'
python3 - << 'PYEOF'
import pathlib
path = pathlib.Path("/workspaces/shift-app/shift_app/lib/features/dictionary/data/materials_data.dart")
text = path.read_text(encoding='utf-8')

extra = r'''
  // ---------------- מטבח — הרחבת משטחי עבודה, גימורי קצוות וברזים (סשן 10) ----------------
  // בקשת ירון (סשן 10): "יש במטבח ברזים כלים סנטרים פינישים גמרים של הפינות
  // בדרך כלל זה בשיש יש כל מיני סוגים צריך לתת ללקוח את כל מגוון האפשרויות".
  MaterialItem(
    id: 'counter_calacatta_white',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח שיש קלאקטה לבן',
    labelEn: 'Calacatta white marble',
    promptEn: 'white Calacatta marble countertop with dramatic gray veining',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_black_marble',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח שיש שחור עורקים לבנים',
    labelEn: 'Black marble, white veining',
    promptEn: 'black marble countertop with bold dramatic white veining',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_terrazzo',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח טרצו מנומר',
    labelEn: 'Terrazzo countertop',
    promptEn: 'terrazzo countertop with scattered white and gray stone chip aggregate pattern',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_butcher_block',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח עץ בוצ\'ר בלוק',
    labelEn: 'Wood butcher block countertop',
    promptEn: 'solid wood butcher block countertop with a warm oiled finish and visible grain pattern',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_stainless_steel',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח נירוסטה מקצועי',
    labelEn: 'Professional stainless steel countertop',
    promptEn: 'seamless brushed stainless steel countertop, professional kitchen appearance',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_corian_white',
    category: 'מטבח',
    subcategory: 'משטחי עבודה',
    labelHe: 'משטח קוריאן לבן חלק',
    labelEn: 'White solid-surface (Corian) countertop',
    promptEn: 'seamless matte white solid-surface countertop with an integrated look and no visible joints',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_edge_straight',
    category: 'מטבח',
    subcategory: 'גימור קצוות ופינות',
    labelHe: 'גימור קצה ישר פשוט',
    labelEn: 'Straight eased edge',
    promptEn: 'simple straight eased-edge countertop profile with a slightly softened corner',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_edge_bullnose',
    category: 'מטבח',
    subcategory: 'גימור קצוות ופינות',
    labelHe: 'גימור קצה מעוגל (בולנוז)',
    labelEn: 'Bullnose rounded edge',
    promptEn: 'fully rounded bullnose countertop edge profile',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_edge_waterfall',
    category: 'מטבח',
    subcategory: 'גימור קצוות ופינות',
    labelHe: 'גימור פינה מפל מים (ווטרפול)',
    labelEn: 'Mitered waterfall edge',
    promptEn: 'mitered waterfall countertop edge where the stone continues seamlessly down the side to the floor',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'counter_edge_beveled',
    category: 'מטבח',
    subcategory: 'גימור קצוות ופינות',
    labelHe: 'גימור קצה משופע',
    labelEn: 'Beveled edge',
    promptEn: 'beveled angled countertop edge profile with a crisp chamfered line',
    roomTypes: ['kitchen'],
    isConstructive: true,
  ),
  MaterialItem(
    id: 'kitchen_faucet_matte_white',
    category: 'מטבח',
    subcategory: 'ברזים',
    labelHe: 'ברז מטבח לבן מט',
    labelEn: 'Matte white kitchen faucet',
    promptEn: 'tall gooseneck kitchen faucet in matte white finish',
    roomTypes: ['kitchen'],
    isConstructive: false,
  ),
  MaterialItem(
    id: 'kitchen_faucet_chrome_pulldown',
    category: 'מטבח',
    subcategory: 'ברזים',
    labelHe: 'ברז מטבח כרום עם ראש נשלף',
    labelEn: 'Chrome pull-down kitchen faucet',
    promptEn: 'polished chrome kitchen faucet with a pull-down spray head',
    roomTypes: ['kitchen'],
    isConstructive: false,
  ),
  MaterialItem(
    id: 'kitchen_faucet_bridge_vintage',
    category: 'מטבח',
    subcategory: 'ברזים',
    labelHe: 'ברז מטבח גשר וינטג\'',
    labelEn: 'Vintage bridge kitchen faucet',
    promptEn: 'traditional bridge-style kitchen faucet with two separate handles and an arched spout, aged brass finish',
    roomTypes: ['kitchen'],
    isConstructive: false,
  ),
  MaterialItem(
    id: 'kitchen_faucet_copper',
    category: 'מטבח',
    subcategory: 'ברזים',
    labelHe: 'ברז מטבח נחושת',
    labelEn: 'Copper kitchen faucet',
    promptEn: 'tall gooseneck kitchen faucet in a warm copper finish',
    roomTypes: ['kitchen'],
    isConstructive: false,
  ),
'''

marker = '\n];\n'
if not text.rstrip().endswith('];'):
    raise SystemExit('materials_data.dart לא מסתיים ב-]; כצפוי — לא נוגעים בקובץ, לבדוק ידנית')
if "'counter_calacatta_white'" in text:
    print('   (כבר קיים — מדלג, לא כותב פעמיים)')
else:
    idx = text.rfind('];')
    text = text[:idx] + extra + text[idx:]
    text = text.replace('470 פריטים.', '484 פריטים.')
    path.write_text(text, encoding='utf-8')
    print('   נכתב בהצלחה — 484 פריטים בסה"כ')
PYEOF

echo
echo '✅ כל הקבצים נכתבו/עודכנו בהצלחה (סשן 10).'
echo 'שלבים הבאים:'
echo '  1) flutter pub get   (חובה — נוסף תלות חדשה: shared_preferences)'
echo '  2) flutter analyze   (לוודא 0 שגיאות)'
echo '  3) git add -A && git commit -m "סשן 10: תיקון קראש תמונה + הסרת הגבלת חדר + תתי-קטגוריה + חדרים וקטגוריות חדשות" && git push'
echo '  4) לבנות APK חדש ולבדוק בפועל במכשיר אמיתי:'
echo '     - לבחור חדר שינה + מיטה, לצלם תמונה, ולוודא שאין חזרה למסך בית ריק'
echo '     - לבדוק שבכל סוג חדר מופיעות כל הקטגוריות (למשל מטבח בסלון)'
echo '     - לבדוק שברהיטים יש כותרות תת-קטגוריה (מיטות, מראות, יחידת טלוויזיה...)'
echo '     - לבדוק שמופיעים 6 סוגי החדר החדשים ברשימה: פינת/חדר אוכל, מסדרון, שירותים, חדר ארונות, יחידת דיור, הבית כולו'
echo '  אין צורך בפריסת Edge Function הפעם — הסשן הזה נוגע רק בקוד ה-Flutter.'
