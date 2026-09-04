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
