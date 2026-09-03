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
