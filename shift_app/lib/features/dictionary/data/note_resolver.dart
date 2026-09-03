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
