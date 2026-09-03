#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

cat > 'lib/features/dictionary/data/material_item.dart' << 'SHIFTEOF'
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
SHIFTEOF

cat > 'lib/features/dictionary/data/room_type.dart' << 'SHIFTEOF'
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
SHIFTEOF

cat > 'lib/features/dictionary/data/protected_element.dart' << 'SHIFTEOF'
/// אלמנט שאסור למודל לשנות או למחוק.
///
/// מסקנה 2 ב-claude/07 היא הבסיס למחלקה הזו: כוונון פרמטרים פותר את בעיית
/// ה*המצאה* (הוספת חלון שלא היה), אבל **רק מיסוך פותר את בעיית המחיקה**.
/// יחידת סינון האוויר של הממ"ד נמחקה בכל ההרצות ובכל ההגדרות שנבדקו.
///
/// לכן זרימת העיבוד היא:
/// תמונה → סימון אזורים מוגנים → יצירה → הרכבה מחדש.
class ProtectedElement {
  /// טווח התחולה בעברית כפי שהוגדר במילון: "כל החדרים" או שם חדר ספציפי.
  final String roomScopeHe;

  /// שם האלמנט בעברית (להצגה למשתמש במסך המיסוך).
  final String labelHe;

  /// שם האלמנט באנגלית (לשימוש מול מודל הזיהוי/מיסוך).
  final String labelEn;

  /// הסיבה להגנה — חלק מהן רגולטוריות (ממ"ד) ואסור לעקוף אותן.
  final String reason;

  const ProtectedElement({
    required this.roomScopeHe,
    required this.labelHe,
    required this.labelEn,
    required this.reason,
  });

  /// האם ההגנה חלה על כל סוגי החדרים.
  bool get isGlobal => roomScopeHe == 'כל החדרים';
}
SHIFTEOF

cat > 'lib/features/dictionary/data/note_modifier.dart' << 'SHIFTEOF'
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
}
SHIFTEOF

cat > 'lib/features/dictionary/data/note_resolver.dart' << 'SHIFTEOF'
import 'material_item.dart';
import 'note_modifier.dart';

/// אחראי להפוך הערת טקסט חופשי בשפת הלקוח לאילוץ מנוסח באנגלית.
///
/// **למה זה קיים:** האפליקציה כולה בעברית (וגם ערבית ורוסית), אבל מודל
/// ה-AI מקבל אך ורק אנגלית. זו לא מגבלה שאפשר לעקוף — זו נקודת התרגום
/// המובנית של המערכת, בדיוק כמו ש-`promptEn` של כל פריט במילון הוא
/// התרגום הקבוע מראש של הבחירה שלו.
///
/// ההבדל: `promptEn` נכתב פעם אחת מראש, וטקסט חופשי חייב להיות מתורגם
/// בזמן אמת.
///
/// **המימוש חי ב-Edge Function (שלב 5), לא באפליקציה** — מאותה סיבה
/// שמפתח ה-Replicate חי שם: כדי שלא נחשוף מפתחות בצד הלקוח.
abstract class NoteResolver {
  /// מקבל את הפריט שהלקוח בחר ואת ההערה שהקליד, ומחזיר אילוץ באנגלית
  /// שמנוסח כך שהוא **מכריע** מול תיאור הפריט המקורי ולא סותר אותו.
  Future<String> resolve({
    required MaterialItem item,
    required String noteRaw,
    required String languageCode,
  });
}

/// ההנחיה שנשלחת למודל השפה ב-Edge Function.
///
/// שים לב לניסוח: אנחנו לא מבקשים תרגום מילולי אלא **ניסוח מחדש כאילוץ**.
/// תרגום מילולי של "רק עד גובה מטר" נותן "only up to one meter" — משפט
/// תלוש שהמודל הגרפי לא יודע למה לקשר. הניסוח שאנחנו רוצים הוא
/// "applied only up to a height of 100 cm from the floor, with a clean
/// horizontal termination line" — הוראה שאומרת למודל בדיוק מה לעשות.
const String kNoteResolutionSystemPrompt = '''
You convert a renovation customer's free-text note into a single precise
English constraint for an image-generation prompt.

You will be given:
- ITEM: the English description of a material or fixture the customer chose.
- NOTE: the customer's note, written in their own language (Hebrew, Arabic,
  Russian or English).

Rules:
1. Output ONE English clause. No preamble, no explanation, no quotes.
2. Write it as a spatial instruction a renderer can follow: state where the
   material starts and stops, in what orientation, or on which surfaces.
   Convert vague wording into concrete geometry wherever the note allows.
3. Convert all measurements to centimetres and state them explicitly.
4. If the note CONTRADICTS part of the ITEM description, your clause must
   clearly override that part. Phrase it so the override is unambiguous.
5. Never invent materials, colours, fixtures or design elements the customer
   did not mention. Constrain only what the note is about.
6. If the note is unclear or is not a spatial/material instruction at all,
   output exactly: SKIP
''';

/// דוגמאות עבודה. משמשות גם כ-few-shot בקריאה למודל וגם כמקרי בדיקה.
const List<(String itemEn, String noteHe, String expectedEn)>
    kNoteResolutionExamples = [
  (
    'full-height wall cladding to the ceiling with large 120x240cm tiles in dark tones',
    'רק עד גובה מטר מהרצפה, מעל זה צבע לבן',
    'the wall cladding applied only up to a height of 100 cm from the floor, '
        'terminating in a clean horizontal line, with plain white paint on the '
        'wall surface above that line',
  ),
  (
    'large format 120x120cm porcelain floor tiles with minimal grout lines',
    'שהריצוף יעצור עשרה סנטימטר לפני סוף הקיר',
    'the floor tiling stopping 10 cm short of the wall, leaving a clean '
        'uncovered margin strip along the wall edge',
  ),
  (
    'feature wall with evenly spaced vertical oak wood slats',
    'רק על הקיר מאחורי הטלוויזיה, לא על כל הקירות',
    'the oak slat cladding applied only to the single wall behind the '
        'television, leaving all other walls unchanged',
  ),
  (
    'simple flat-profile white polymer skirting baseboard',
    'פנלים של 7 סנטימטר',
    'the skirting baseboard exactly 7 cm in height',
  ),
];

/// מימוש מקומי לפיתוח ולבדיקות בלבד — מחזיר את הטקסט כמו שהוא.
/// **אין להשתמש בו בייצור.**
class PassthroughNoteResolver implements NoteResolver {
  const PassthroughNoteResolver();

  @override
  Future<String> resolve({
    required MaterialItem item,
    required String noteRaw,
    required String languageCode,
  }) async =>
      noteRaw;
}

/// מפעיל את ה-Resolver על כל ההערות החופשיות שבבחירות, ומחזיר את אותן
/// בחירות כשההערות כבר פתורות ומוכנות לבניית פרומפט.
///
/// הערות מובנות ([HeightLimit], [StopShortOfEdge] וכו') לא עוברות כאן
/// כלל — הן כבר יודעות לנסח את עצמן באנגלית בלי שום קריאת רשת.
Future<List<NoteModifier>> resolveAll({
  required NoteResolver resolver,
  required MaterialItem item,
  required List<NoteModifier> modifiers,
  required String languageCode,
}) async {
  final out = <NoteModifier>[];
  for (final m in modifiers) {
    if (m is FreeTextNote && !m.isResolved) {
      final english = await resolver.resolve(
        item: item,
        noteRaw: m.rawText,
        languageCode: languageCode,
      );
      if (english.trim() == 'SKIP' || english.trim().isEmpty) continue;
      out.add(m.withResolution(english));
    } else {
      out.add(m);
    }
  }
  return out;
}
SHIFTEOF

cat > 'lib/features/prompt_engine/prompt_engine.dart' << 'SHIFTEOF'
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

cat > 'test/prompt_engine_test.dart' << 'SHIFTEOF'
import 'package:flutter_test/flutter_test.dart';

import 'package:shift_app/features/dictionary/data/materials_data.dart';
import 'package:shift_app/features/dictionary/data/room_types_data.dart';
import 'package:shift_app/features/dictionary/data/note_modifier.dart';
import 'package:shift_app/features/prompt_engine/prompt_engine.dart';

void main() {
  group('שלמות המילון', () {
    test('אין מזהים כפולים', () {
      final ids = kMaterials.map((m) => m.id).toList();
      expect(ids.toSet().length, ids.length);
    });

    test('לכל פריט יש פרומפט אנגלי לא ריק', () {
      for (final m in kMaterials) {
        expect(m.promptEn.trim(), isNotEmpty, reason: 'פריט ${m.id}');
      }
    });

    test('כל סוגי החדרים שמוזכרים בפריטים קיימים בטבלת סוגי החדרים', () {
      final valid = kRoomTypes.map((r) => r.code).toSet();
      for (final m in kMaterials) {
        for (final rt in m.roomTypes) {
          expect(valid.contains(rt), isTrue,
              reason: 'פריט ${m.id} מפנה לסוג חדר לא מוכר: $rt');
        }
      }
    });

    test('אין טקסט עברי בשדה הפרומפט — המודל מקבל אנגלית בלבד', () {
      final hebrew = RegExp(r'[֐-׿]');
      for (final m in kMaterials) {
        expect(hebrew.hasMatch(m.promptEn), isFalse, reason: 'פריט ${m.id}');
      }
    });
  });

  group('גזירת prompt_strength', () {
    test('בחירות משטח בלבד → 0.55', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite', 'floor_parquet_oak_natural'],
      );
      expect(job.promptStrength, PromptEngine.strengthSurface);
      expect(job.hasConstructiveChange, isFalse);
    });

    test('בחירה קונסטרוקטיבית אחת מספיקה כדי להעלות ל-0.65', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite', 'ceiling_floating_led'],
      );
      expect(job.promptStrength, PromptEngine.strengthConstructive);
      expect(job.hasConstructiveChange, isTrue);
    });
  });

  group('בניית הפרומפט', () {
    test('הפרומפט מכיל רק את מה שהמשתמש בחר', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite'],
      );
      // המשתמש לא נגע באלומיניום ופתחים — אסור שהמילה תופיע.
      expect(job.prompt.toLowerCase().contains('window'), isFalse);
      expect(job.prompt.toLowerCase().contains('door'), isFalse);
    });

    test('חדר חוץ מקבל תבנית פרומפט חיצונית', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'yard',
        itemIds: ['fence_alu_black'],
      );
      expect(job.prompt.startsWith('A high-end photorealistic exterior'), isTrue);
    });

    test('ממ"ד נועל את אלמנטי הבטיחות', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'mamad',
        itemIds: ['paint_offwhite'],
      );
      expect(job.protectedLabels, contains('MAMAD air filtration unit'));
      expect(job.protectedLabels,
          contains('MAMAD blast-resistant steel window'));
    });

    test('בחירה ריקה נכשלת מפורשות', () {
      expect(
        () => PromptEngine.buildFromIds(roomTypeCode: 'living', itemIds: []),
        throwsArgumentError,
      );
    });
  });

  group('שינויים לבקשת הלקוח', () {
    test('הגבלת גובה נכנסת כהוראת-על בסוף, לא ליד הפריט', () {
      final item = PromptEngine.itemById('bath_cladding_dark')!;
      final job = PromptEngine.build(
        roomTypeCode: 'bathroom',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              HeightLimit(100,
                  aboveTreatmentHe: 'צבע לבן',
                  aboveTreatmentEn: 'plain white paint'),
            ],
          ),
        ],
      );

      // תיאור הפריט המקורי נשאר שלם.
      expect(job.prompt.contains(item.promptEn), isTrue);
      // ההוראה המכריעה מופיעה אחריו.
      expect(job.prompt.contains('these requirements override'), isTrue);
      expect(job.prompt.contains('up to a height of 100 cm'), isTrue);
      // ומופיעה אחרי תיאור הפריט, לא לפניו.
      expect(job.prompt.indexOf('override'),
          greaterThan(job.prompt.indexOf(item.promptEn)));
    });

    test('עצירה לפני הקצה — המקרה של ריצוף שנעצר 10 ס"מ מהקיר', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final job = PromptEngine.build(
        roomTypeCode: 'living',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              StopShortOfEdge(10, edge: EdgeReference.wallEnd),
            ],
          ),
        ],
      );
      expect(job.prompt.contains('stopping 10 cm short of the end of the wall'),
          isTrue);
    });

    test('הסיכום ללקוח מוצג בעברית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final sel = MaterialSelection(
        item: item,
        modifiers: const [StopShortOfEdge(10)],
      );
      expect(sel.summaryHe(), contains('לעצור 10 ס"מ לפני הקיר'));
    });

    test('טקסט חופשי שלא עובד בשרת נכשל במקום להישלח בעברית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      expect(
        () => PromptEngine.build(
          roomTypeCode: 'living',
          selections: [
            MaterialSelection(
              item: item,
              modifiers: const [FreeTextNote('שהריצוף יעצור לפני הקיר')],
            ),
          ],
        ),
        throwsStateError,
      );
    });

    test('טקסט חופשי שעובד בשרת נכנס באנגלית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final job = PromptEngine.build(
        roomTypeCode: 'living',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              FreeTextNote(
                'שהריצוף יעצור לפני הקיר',
                resolvedEn: 'the floor tiling stopping short of the wall',
              ),
            ],
          ),
        ],
      );
      final hebrew = RegExp(r'[֐-׿]');
      expect(hebrew.hasMatch(job.prompt), isFalse,
          reason: 'אסור שעברית תגיע למודל');
    });
  });
}
SHIFTEOF

cat > 'lib/features/dictionary/data/room_types_data.dart' << 'SHIFTEOF'
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
];
SHIFTEOF

cat > 'lib/features/dictionary/data/protected_elements_data.dart' << 'SHIFTEOF'
// נוצר אוטומטית מ-build_dict_data.py — אין לערוך ידנית.
// אלמנטים שחייבים להישמר במיסוך. ראו מסקנה 2 ב-claude/07.

import 'protected_element.dart';

const List<ProtectedElement> kProtectedElements = [
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'פתחי חלונות קיימים',
    labelEn: 'existing window openings',
    reason: 'מונע המצאת חלונות חדשים ומונע טשטוש הנוף — הכשל שזוהה בשלב 3',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'דלתות כניסה ופנים',
    labelEn: 'existing doors',
    reason: 'המודל נוטה להזיז או למחוק דלתות',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'יחידת סינון אוויר',
    labelEn: 'MAMAD air filtration unit',
    reason: 'אלמנט חובה על פי תקנות. נמחק בכל ההרצות ובכל ההגדרות — רק מיסוך פותר',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'חלון הדף פלדתי',
    labelEn: 'MAMAD blast-resistant steel window',
    reason: 'אלמנט חובה על פי תקנות, לא ניתן להחלפה',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'דלת הדף פלדתית',
    labelEn: 'MAMAD blast-resistant steel door',
    reason: 'אלמנט חובה על פי תקנות, לא ניתן להחלפה',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'קירות בטון מזוין',
    labelEn: 'MAMAD reinforced concrete walls',
    reason: 'לא ניתן לפרק, ומוגבל בקידוח ובתלייה — לאמת מול פיקוד העורף',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'מזגן מיני מרכזי / מפוצל',
    labelEn: 'air conditioning unit',
    reason: 'אופציונלי — המשתמש מסמן אם ברצונו לשמר',
  ),
  ProtectedElement(
    roomScopeHe: 'סלון',
    labelHe: 'טלוויזיה תלויה',
    labelEn: 'wall-mounted television',
    reason: 'נמחקה בבדיקת הסלון. אופציונלי לסימון ע"י המשתמש',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'דוד חשמל / מערכות גלויות',
    labelEn: 'water heater and exposed systems',
    reason: 'אופציונלי — לרוב המשתמש ירצה שיישארו',
  ),
];
SHIFTEOF

echo "done"
