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
