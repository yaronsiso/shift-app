#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p \
  "assets/translations" \
  "lib" \
  "lib/core/config" \
  "lib/core/router" \
  "lib/core/theme" \
  "lib/core/widgets" \
  "lib/features/dictionary/data" \
  "lib/features/feedback/data" \
  "lib/features/home/presentation" \
  "lib/features/marquee/data" \
  "lib/features/prompt_engine" \
  "lib/features/render/data" \
  "lib/features/render_flow/data" \
  "test"

cat > 'lib/core/config/app_config.dart' << 'SHIFTEOF'
/// Global, non-secret app constants agreed in the product spec.
///
/// Anything here traces back to an explicit decision in the PRD / follow-up
/// spec documents — nothing invented. See project docs/STATUS.md for the
/// source of each value.
class AppConfig {
  AppConfig._();

  /// Brand name — also the label used on the primary action button
  /// throughout the app (per spec: the render/update button is always "SHIFT").
  static const String appName = 'SHIFT';

  /// Android application ID / iOS bundle identifier.
  static const String bundleId = 'com.shiftapp.mobile';

  /// Freemium: number of free renders a new user gets before the paywall.
  static const int freeCreditsForNewUser = 3;

  /// Supported UI locales (ISO 639-1) and their text direction.
  /// AI prompts sent to the backend are always in English regardless of
  /// the selected UI locale — see design_studio feature (stage 4/5).
  static const List<String> supportedLocaleCodes = ['he', 'ar', 'ru', 'en'];
  static const List<String> rtlLocaleCodes = ['he', 'ar'];
}
SHIFTEOF

cat > 'lib/core/config/supabase_config.dart' << 'SHIFTEOF'
/// Supabase connection configuration.
///
/// NOTE ON SECURITY: the values below are the Supabase *anon/public* key and
/// project URL. These are safe to ship inside a client app by design — they
/// are protected by Row Level Security (RLS) policies on the database side,
/// not by secrecy. See supabase/migrations/0001_init.sql for the RLS setup.
///
/// The Supabase *service_role* key (a real secret) must NEVER be placed here
/// or anywhere in this app. It is only used server-side, inside Supabase
/// Edge Functions (e.g. the future function that calls the Replicate API),
/// configured via `supabase secrets set` — never committed to the repo.
class SupabaseConfig {
  SupabaseConfig._();

  static const String url = 'https://iywhxmuzvincfmezijtv.supabase.co';
  static const String anonKey = 'sb_publishable_Px6BOsQjEiEtsHXULMt6SA_DwlJrW66';
}
SHIFTEOF

cat > 'lib/core/theme/app_colors.dart' << 'SHIFTEOF'
import 'package:flutter/material.dart';

/// טוקני צבע — עודכן בשלב 6 (סשן 6, 2.9.2026) להתאמה מדויקת למוקאפים
/// שירון אישר ("הצבעים בסדר גמור"). מחליף את פלטת ה-Dark-Slate/אזמרגד
/// הזמנית משלב 2. **שינוי מכוון:** מעכשיו יש תמיכה מלאה ב-Light וגם
/// Dark (לא רק Dark קשיח כמו בשלב 2) — ראו app_theme.dart ו-main.dart.
///
/// הערכים זהים בדיוק ל-tokens שב-mockups_stage6.html (`:root` ל-Light,
/// `@media (prefers-color-scheme: dark)` / `:root[data-theme="dark"]`
/// ל-Dark) — כדי שהאפליקציה תיראה בדיוק כמו המוקאפ שאושר.
class AppColors {
  AppColors._();

  // ---------- Light ----------
  static const Color bgLight = Color(0xFFEEEBE5);
  static const Color surfaceLight = Color(0xFFFFFFFF);
  static const Color surface2Light = Color(0xFFFAF9F6);
  static const Color inkLight = Color(0xFF201E1B);
  static const Color inkSoftLight = Color(0xFF736C63);
  static const Color inkFaintLight = Color(0xFFA49C90);
  static const Color accentLight = Color(0xFF1F5C5B);
  static const Color accentInkLight = Color(0xFFFFFFFF);
  static const Color accentSoftLight = Color(0xFFD8E6E3);
  static const Color accentSoftLineLight = Color(0xFFB9D2CE);
  static const Color goldLight = Color(0xFFA97F43);
  static const Color goldSoftLight = Color(0xFFF1E4CD);
  static const Color lineLight = Color(0xFFDCD7CD);
  static const Color lineStrongLight = Color(0xFFC7C0B3);

  // ---------- Dark ----------
  static const Color bgDark = Color(0xFF17181A);
  static const Color surfaceDark = Color(0xFF201F1D);
  static const Color surface2Dark = Color(0xFF262421);
  static const Color inkDark = Color(0xFFEDE9E2);
  static const Color inkSoftDark = Color(0xFFA79E92);
  static const Color inkFaintDark = Color(0xFF726B61);
  static const Color accentDark = Color(0xFF49ACA2);
  static const Color accentInkDark = Color(0xFF0D1918);
  static const Color accentSoftDark = Color(0xFF20302F);
  static const Color accentSoftLineDark = Color(0xFF345453);
  static const Color goldDark = Color(0xFFC9A15E);
  static const Color goldSoftDark = Color(0xFF332A1C);
  static const Color lineDark = Color(0xFF34322D);
  static const Color lineStrongDark = Color(0xFF454239);

  /// לא הופיע במוקאפ (אין שם מסך שגיאה) — נשמר מהפלטה הישנה של שלב 2,
  /// היחיד שממשיך משם, כי אדום-שגיאה הוא בחירה טכנית נייטרלית ולא חלק
  /// מהזהות הוויזואלית שהמוקאפ קבע.
  static const Color danger = Color(0xFFEF4444);
}
SHIFTEOF

cat > 'lib/core/theme/app_theme.dart' << 'SHIFTEOF'
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// טוקנים נוספים שאין להם מקבילה טבעית ב-`ColorScheme` הסטנדרטי של Flutter
/// (gold, גוונים "רכים" של accent, ink-soft/ink-faint) — נגישים מכל מסך
/// דרך `Theme.of(context).extension<AppPalette>()!`.
///
/// למה `ThemeExtension` ולא רק קבועים סטטיים: כדי שערך הצבע יתחלף אוטומטית
/// בין Light ל-Dark (וגם יעבור אנימציה חלקה בין השניים, `lerp`) בלי לכתוב
/// תנאי `Theme.of(context).brightness == Brightness.dark` בכל מסך.
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  final Color surface2;
  final Color inkSoft;
  final Color inkFaint;
  final Color accentSoft;
  final Color accentSoftLine;
  final Color gold;
  final Color goldSoft;
  final Color line;
  final Color lineStrong;

  const AppPalette({
    required this.surface2,
    required this.inkSoft,
    required this.inkFaint,
    required this.accentSoft,
    required this.accentSoftLine,
    required this.gold,
    required this.goldSoft,
    required this.line,
    required this.lineStrong,
  });

  static const light = AppPalette(
    surface2: AppColors.surface2Light,
    inkSoft: AppColors.inkSoftLight,
    inkFaint: AppColors.inkFaintLight,
    accentSoft: AppColors.accentSoftLight,
    accentSoftLine: AppColors.accentSoftLineLight,
    gold: AppColors.goldLight,
    goldSoft: AppColors.goldSoftLight,
    line: AppColors.lineLight,
    lineStrong: AppColors.lineStrongLight,
  );

  static const dark = AppPalette(
    surface2: AppColors.surface2Dark,
    inkSoft: AppColors.inkSoftDark,
    inkFaint: AppColors.inkFaintDark,
    accentSoft: AppColors.accentSoftDark,
    accentSoftLine: AppColors.accentSoftLineDark,
    gold: AppColors.goldDark,
    goldSoft: AppColors.goldSoftDark,
    line: AppColors.lineDark,
    lineStrong: AppColors.lineStrongDark,
  );

  @override
  AppPalette copyWith({
    Color? surface2,
    Color? inkSoft,
    Color? inkFaint,
    Color? accentSoft,
    Color? accentSoftLine,
    Color? gold,
    Color? goldSoft,
    Color? line,
    Color? lineStrong,
  }) {
    return AppPalette(
      surface2: surface2 ?? this.surface2,
      inkSoft: inkSoft ?? this.inkSoft,
      inkFaint: inkFaint ?? this.inkFaint,
      accentSoft: accentSoft ?? this.accentSoft,
      accentSoftLine: accentSoftLine ?? this.accentSoftLine,
      gold: gold ?? this.gold,
      goldSoft: goldSoft ?? this.goldSoft,
      line: line ?? this.line,
      lineStrong: lineStrong ?? this.lineStrong,
    );
  }

  @override
  AppPalette lerp(ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    return AppPalette(
      surface2: Color.lerp(surface2, other.surface2, t)!,
      inkSoft: Color.lerp(inkSoft, other.inkSoft, t)!,
      inkFaint: Color.lerp(inkFaint, other.inkFaint, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      accentSoftLine: Color.lerp(accentSoftLine, other.accentSoftLine, t)!,
      gold: Color.lerp(gold, other.gold, t)!,
      goldSoft: Color.lerp(goldSoft, other.goldSoft, t)!,
      line: Color.lerp(line, other.line, t)!,
      lineStrong: Color.lerp(lineStrong, other.lineStrong, t)!,
    );
  }
}

/// `ThemeData` לאפליקציה, בשתי גרסאות (Light + Dark) — עודכן בשלב 6
/// להתאמה מדויקת למוקאפים שאושרו. ראו app_colors.dart להסבר המלא על
/// ההחלפה מהפלטה הזמנית של שלב 2.
class AppTheme {
  AppTheme._();

  static const double cardBorderRadius = 16.0;

  static TextTheme _fontFamily(TextTheme base) => GoogleFonts.heeboTextTheme(base);

  static ThemeData get light {
    final base = ThemeData.light(useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bgLight,
      colorScheme: base.colorScheme.copyWith(
        surface: AppColors.surfaceLight,
        primary: AppColors.accentLight,
        secondary: AppColors.goldLight,
        onPrimary: AppColors.accentInkLight,
        onSurface: AppColors.inkLight,
        error: AppColors.danger,
      ),
      textTheme: _fontFamily(base.textTheme).apply(
        bodyColor: AppColors.inkLight,
        displayColor: AppColors.inkLight,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.bgLight,
        foregroundColor: AppColors.inkLight,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surfaceLight,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardBorderRadius),
          side: const BorderSide(color: AppColors.lineLight),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: AppColors.surface2Light,
        selectedColor: AppColors.accentLight,
        labelStyle: _fontFamily(base.textTheme).bodyMedium?.copyWith(
              color: AppColors.inkLight,
            ),
        secondaryLabelStyle: _fontFamily(base.textTheme).bodyMedium?.copyWith(
              color: AppColors.accentInkLight,
            ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(999),
          side: const BorderSide(color: AppColors.lineLight),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accentLight,
          foregroundColor: AppColors.accentInkLight,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(cardBorderRadius),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          textStyle: _fontFamily(base.textTheme).titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.lineLight),
      extensions: const [AppPalette.light],
    );
  }

  static ThemeData get dark {
    final base = ThemeData.dark(useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bgDark,
      colorScheme: base.colorScheme.copyWith(
        surface: AppColors.surfaceDark,
        primary: AppColors.accentDark,
        secondary: AppColors.goldDark,
        onPrimary: AppColors.accentInkDark,
        onSurface: AppColors.inkDark,
        error: AppColors.danger,
      ),
      textTheme: _fontFamily(base.textTheme).apply(
        bodyColor: AppColors.inkDark,
        displayColor: AppColors.inkDark,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.bgDark,
        foregroundColor: AppColors.inkDark,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surfaceDark,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardBorderRadius),
          side: const BorderSide(color: AppColors.lineDark),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: AppColors.surface2Dark,
        selectedColor: AppColors.accentDark,
        labelStyle: _fontFamily(base.textTheme).bodyMedium?.copyWith(
              color: AppColors.inkDark,
            ),
        secondaryLabelStyle: _fontFamily(base.textTheme).bodyMedium?.copyWith(
              color: AppColors.accentInkDark,
            ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(999),
          side: const BorderSide(color: AppColors.lineDark),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accentDark,
          foregroundColor: AppColors.accentInkDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(cardBorderRadius),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          textStyle: _fontFamily(base.textTheme).titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.lineDark),
      extensions: const [AppPalette.dark],
    );
  }
}

/// גישה נוחה: `context.palette.gold` במקום
/// `Theme.of(context).extension<AppPalette>()!.gold` בכל מסך.
extension AppPaletteContext on BuildContext {
  AppPalette get palette => Theme.of(this).extension<AppPalette>()!;
}
SHIFTEOF

cat > 'lib/main.dart' << 'SHIFTEOF'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/config/app_config.dart';
import 'core/config/supabase_config.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await EasyLocalization.ensureInitialized();

  await Supabase.initialize(
    url: SupabaseConfig.url,
    anonKey: SupabaseConfig.anonKey,
  );

  runApp(
    EasyLocalization(
      supportedLocales: AppConfig.supportedLocaleCodes
          .map((code) => Locale(code))
          .toList(),
      path: 'assets/translations',
      fallbackLocale: const Locale('en'),
      startLocale: const Locale('he'), // Hebrew is the primary market locale
      child: const ProviderScope(child: ShiftApp()),
    ),
  );
}

class ShiftApp extends StatelessWidget {
  const ShiftApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      // שלב 6: עודכן מ-Dark קשיח (שלב 2) לתמיכה מלאה ב-Light+Dark לפי
      // מכשיר המשתמש, כמו שהוגדר במוקאפים שאושרו.
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      localizationsDelegates: context.localizationDelegates,
      supportedLocales: context.supportedLocales,
      locale: context.locale,
      routerConfig: AppRouter.router,
    );
  }
}
SHIFTEOF

cat > 'lib/features/render_flow/data/render_flow_state.dart' << 'SHIFTEOF'
import 'package:flutter/foundation.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';

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
}
SHIFTEOF

cat > 'lib/features/render_flow/data/render_flow_notifier.dart' << 'SHIFTEOF'
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import 'render_flow_state.dart';

/// מנהל את [RenderFlowState] לאורך מסכים 1-3. חי ב-`ProviderScope` הראשי
/// (לא `autoDispose`) כדי שהמצב ישרוד ניווט בין המסכים; מאופס במפורש
/// (`reset()`) אחרי שהדמיה נשלחה בהצלחה או כשחוזרים למסך הבית מחדש.
class RenderFlowNotifier extends StateNotifier<RenderFlowState> {
  RenderFlowNotifier() : super(const RenderFlowState());

  /// בחירת סוג חדר במסך הבית. מאפס את שאר הבחירות — הן תלויות בחדר
  /// (קבוצות-על זמינות, ופריטים בתוכן), אז בחירת חדר אחר מתחילה מחדש.
  void selectRoomType(String code) {
    state = RenderFlowState(roomTypeCode: code);
  }

  /// הפעלה/כיבוי של קבוצת-על אחת (צבע/רהיטים/חומרי בנייה/תאורה/גינה/ועוד).
  void toggleGroup(String groupCode) {
    final next = Set<String>.from(state.selectedGroupCodes);
    if (!next.remove(groupCode)) next.add(groupCode);
    state = state.copyWith(selectedGroupCodes: next);
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
  }

  /// שמירת התמונה שנבחרה במסך העלאת התמונה.
  void setLocalImage(String localPath) {
    state = state.copyWith(localImagePath: localPath);
  }

  /// איפוס מלא — אחרי שליחת הדמיה (הצלחה או כישלון), או חזרה למסך הבית.
  void reset() {
    state = const RenderFlowState();
  }
}

final renderFlowProvider =
    StateNotifierProvider<RenderFlowNotifier, RenderFlowState>(
  (ref) => RenderFlowNotifier(),
);
SHIFTEOF

cat > 'lib/features/render/data/render_providers.dart' << 'SHIFTEOF'
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'render_service.dart';

/// לקוח Supabase — provider יחיד, נגיש מכל מקום כדי לא לכתוב
/// `Supabase.instance.client` בעשרות מקומות.
final supabaseClientProvider = Provider<SupabaseClient>((ref) {
  return Supabase.instance.client;
});

/// שירות ההדמיות (נכתב בשלב 5) — provider כדי שאפשר יהיה להחליף אותו
/// בבדיקות (mock) בעתיד.
final renderServiceProvider = Provider<RenderService>((ref) {
  return RenderService(ref.watch(supabaseClientProvider));
});

/// זכאות המשתמש הנוכחית (קרדיטים חינמיים / מנוי) — להצגת "מונית" הקרדיטים
/// במסך הבית ובמסך החומרים. `autoDispose` כי זה מידע רגיש-לזמן שכדאי
/// לרענן בכל פעם שהמסך נפתח מחדש, לא לשמור לנצח בזיכרון.
final renderEligibilityProvider =
    FutureProvider.autoDispose<RenderEligibility>((ref) {
  return ref.watch(renderServiceProvider).checkEligibility();
});
SHIFTEOF

cat > 'lib/features/feedback/data/feedback_repository.dart' << 'SHIFTEOF'
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// שלושת ערכי שביעות-הרצון האפשריים בכרטיס אבן-הדרך, בדיוק כמו שהוגדרו
/// במיגרציה 0005 (`claude/20`) ובממשק ("טוב מאוד" / "בסדר" / "לא משהו").
enum MilestoneSatisfaction { veryGood, ok, notGreat }

extension MilestoneSatisfactionValue on MilestoneSatisfaction {
  /// הערך שנשמר במסד הנתונים — חייב להתאים בדיוק ל-check constraint
  /// של `feedback_milestones.satisfaction` במיגרציה 0005.
  String get dbValue => switch (this) {
        MilestoneSatisfaction.veryGood => 'very_good',
        MilestoneSatisfaction.ok => 'ok',
        MilestoneSatisfaction.notGreat => 'not_great',
      };
}

/// מקור הדירוג — לתיעוד בלבד (איפה בממשק המשתמש שלח את הדירוג).
enum ReviewSource { menu, resultScreen }

extension ReviewSourceValue on ReviewSource {
  String get dbValue => switch (this) {
        ReviewSource.menu => 'menu',
        ReviewSource.resultScreen => 'result_screen',
      };
}

/// עוטף את שלוש הפונקציות שמיגרציה 0005 חשפה (`claude/20`) — מנגנון
/// המשוב כולו אדמין-בלבד בצד השרת (RLS בלי policies על הטבלאות עצמן),
/// כך שהאפליקציה תמיד עוברת דרך ה-RPC-ים האלה, אף פעם לא קוראת/כותבת
/// ישירות לטבלאות `feedback_milestones` / `app_reviews`.
class FeedbackRepository {
  final SupabaseClient _client;
  const FeedbackRepository(this._client);

  /// הסף הראשון (2/10/20) שהמשתמש חצה ועדיין לא ענה עליו, או null אם
  /// אין כזה. לקרוא אחרי כל הדמיה מוצלחת (מסך התוצאה).
  Future<int?> pendingMilestone() async {
    final res = await _client.rpc('pending_milestone');
    if (res == null) return null;
    return res as int;
  }

  /// שליחת התשובה על כרטיס אבן-הדרך. בטוח לקריאה כפולה על אותו סף —
  /// השרת פשוט מתעלם (unique constraint), לא זורק שגיאה.
  Future<void> submitMilestoneFeedback({
    required int milestone,
    required MilestoneSatisfaction satisfaction,
    required bool missingElements,
    String? missingElementsText,
  }) async {
    await _client.rpc('submit_milestone_feedback', params: {
      'p_milestone': milestone,
      'p_satisfaction': satisfaction.dbValue,
      'p_missing_elements': missingElements,
      'p_missing_elements_text':
          (missingElements && (missingElementsText?.trim().isNotEmpty ?? false))
              ? missingElementsText!.trim()
              : null,
    });
  }

  /// שליחת דירוג כוכבים + טקסט חופשי אופציונלי, מהתפריט או ממסך התוצאה.
  /// אפשר לשלוח כמה פעמים שרוצים — אין הגבלה כמו באבני-הדרך.
  Future<void> submitReview({
    required int stars,
    String? reviewText,
    required ReviewSource source,
  }) async {
    assert(stars >= 1 && stars <= 5, 'דירוג חייב להיות בין 1 ל-5');
    await _client.rpc('submit_app_review', params: {
      'p_stars': stars,
      'p_review_text':
          (reviewText?.trim().isNotEmpty ?? false) ? reviewText!.trim() : null,
      'p_source': source.dbValue,
    });
  }
}

final feedbackRepositoryProvider = Provider<FeedbackRepository>((ref) {
  return FeedbackRepository(ref.watch(supabaseClientProvider));
});
SHIFTEOF

cat > 'lib/features/marquee/data/marquee_repository.dart' << 'SHIFTEOF'
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// הודעה בודדת בפס הנייד — נטענת מטבלת `marquee_messages` (מיגרציה 0005,
/// `claude/20`). ירון עורך את התוכן עצמו דרך Table Editor, בדיוק כמו
/// קופונים; האפליקציה רק קוראת (יש לה policy לקריאה בלבד על שורות
/// פעילות — הסינון של is_active/starts_at/ends_at קורה כבר בשרת).
@immutable
class MarqueeMessage {
  final String id;
  final String message;
  final int sortOrder;

  const MarqueeMessage({
    required this.id,
    required this.message,
    required this.sortOrder,
  });

  factory MarqueeMessage.fromRow(Map<String, dynamic> row) => MarqueeMessage(
        id: row['id'] as String,
        message: row['message'] as String,
        sortOrder: row['sort_order'] as int? ?? 0,
      );
}

class MarqueeRepository {
  final SupabaseClient _client;
  const MarqueeRepository(this._client);

  Future<List<MarqueeMessage>> activeMessages() async {
    final rows = await _client
        .from('marquee_messages')
        .select('id, message, sort_order')
        .order('sort_order');
    return (rows as List)
        .map((r) => MarqueeMessage.fromRow(r as Map<String, dynamic>))
        .toList();
  }
}

final marqueeRepositoryProvider = Provider<MarqueeRepository>((ref) {
  return MarqueeRepository(ref.watch(supabaseClientProvider));
});

/// `autoDispose` — נטען מחדש בכל פעם שמסך עם פס נייד נפתח, כדי שעדכון
/// שירון עשה ב-Table Editor (למשל מבצע חדש) יופיע בלי לדרוש עדכון גרסה.
final marqueeMessagesProvider =
    FutureProvider.autoDispose<List<MarqueeMessage>>((ref) {
  return ref.watch(marqueeRepositoryProvider).activeMessages();
});
SHIFTEOF

cat > 'lib/core/router/route_names.dart' << 'SHIFTEOF'
/// נתיבי הניווט של זרימת ההדמיה (5 מסכים). קובץ נפרד כדי שכל מסך יוכל
/// להפנות למסך הבא בלי להמתין לעדכון app_router.dart — הראוטר עצמו
/// מחובר בחלק הבא של קוד שלב 6.
class AppRoutes {
  AppRoutes._();

  static const home = '/';
  static const designStudio = '/design-studio';
  static const uploadPhoto = '/upload-photo';
  static const processing = '/processing';
  static const result = '/result';
}
SHIFTEOF

cat > 'lib/core/widgets/marquee_bar.dart' << 'SHIFTEOF'
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// פס הודעות/פרסומות נייד בראש המסכים "הרגילים" — נע **משמאל לימין**
/// (בקשה מפורשת של ירון, גם שזה לא כיוון קריאה טבעי בעברית). לא מוצג
/// במסך צילום התמונה ולא במסך העיבוד (states חולפים) — כל מסך מחליט
/// בעצמו אם להציב את הווידג'ט הזה, זה לא global.
///
/// תוכן ההודעות מגיע מ-[marqueeMessagesProvider] (טבלת `marquee_messages`,
/// שירון עורך דרך Table Editor). אם אין הודעות פעילות, הפס פשוט לא נבנה
/// בכלל (גובה 0) — לא משאיר רצועה ריקה.
class MarqueeBar extends StatefulWidget {
  final List<String> messages;

  const MarqueeBar({super.key, required this.messages});

  @override
  State<MarqueeBar> createState() => _MarqueeBarState();
}

class _MarqueeBarState extends State<MarqueeBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 16),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.messages.isEmpty) return const SizedBox.shrink();

    final text = widget.messages.join('     •     ');
    final palette = context.palette;
    final accent = Theme.of(context).colorScheme.primary;

    return Container(
      height: 34,
      width: double.infinity,
      color: palette.accentSoft,
      child: ClipRect(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final width = constraints.maxWidth;
                // נע מ--75% הרוחב (מחוץ למסך, שמאלה) עד 100% הרוחב
                // (מחוץ למסך, ימינה) — כמו ה-keyframes במוקאפ
                // (mockups_stage6.html, .marquee-bar).
                final start = -0.75 * width;
                final end = width;
                final x = start + (end - start) * _controller.value;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned(
                      left: x,
                      top: 0,
                      bottom: 0,
                      child: Center(
                        child: Text(
                          text,
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.visible,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: accent,
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}
SHIFTEOF

cat > 'lib/features/home/presentation/home_screen.dart' << 'SHIFTEOF'
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
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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

cat > 'lib/features/dictionary/data/category_group.dart' << 'SHIFTEOF'
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
SHIFTEOF

cat > 'lib/features/render/data/render_service.dart' << 'SHIFTEOF'
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../prompt_engine/prompt_engine.dart';

/// תוצאת ניסיון יצירת הדמיה.
sealed class RenderOutcome {
  const RenderOutcome();
}

class RenderSuccess extends RenderOutcome {
  final String renderId;

  /// נתיב התמונה שנוצרה ב-Storage (בתוך התיקייה של המשתמש).
  final String? afterImagePath;

  /// כתובת ישירה — רק אם ההעלאה ל-Storage נכשלה. זמנית.
  final String? fallbackUrl;

  /// כמה הדמיות חינם נותרו אחרי הפעולה.
  final int freeRemaining;

  const RenderSuccess({
    required this.renderId,
    required this.afterImagePath,
    required this.fallbackUrl,
    required this.freeRemaining,
  });
}

/// המכסה נגמרה — האפליקציה תציג Paywall.
class RenderQuotaExhausted extends RenderOutcome {
  const RenderQuotaExhausted();
}

/// כשל טכני. הקרדיט כבר הוחזר בשרת.
class RenderFailure extends RenderOutcome {
  final String code;
  final String? detail;
  const RenderFailure(this.code, [this.detail]);

  /// הודעה ידידותית להצגה למשתמש.
  String get messageHe => switch (code) {
        'unauthorized' => 'צריך להתחבר מחדש כדי ליצור הדמיה.',
        'bad_selection' => 'אחת הבחירות אינה תקפה לחדר שנבחר.',
        'replicate_error' ||
        'replicate_unreachable' ||
        'generation_failed' =>
          'שרת ההדמיות לא זמין כרגע. הקרדיט לא נוצל — אפשר לנסות שוב.',
        'image_url_failed' => 'לא הצלחנו לגשת לתמונה שהעלית. נסה להעלות שוב.',
        _ => 'משהו השתבש. הקרדיט לא נוצל — אפשר לנסות שוב.',
      };
}

/// מצב הזכאות של המשתמש — להצגת מונה הקרדיטים במסך העיצוב.
class RenderEligibility {
  final bool allowed;
  final String reason;
  final int freeRemaining;
  final String subscriptionTier;
  final bool subscriptionActive;

  const RenderEligibility({
    required this.allowed,
    required this.reason,
    required this.freeRemaining,
    required this.subscriptionTier,
    required this.subscriptionActive,
  });
}

/// השירות שמדבר עם ה-Edge Function.
///
/// **שים לב מה *לא* נשלח מכאן:** הפרומפט. האפליקציה שולחת את סוג החדר ואת
/// מזהי הפריטים בלבד, והשרת בונה את הפרומפט בעצמו מהמילון שלו. אחרת כל מי
/// שיפרק את האפליקציה יוכל לשלוח פרומפט חופשי ולהשתמש בחשבון ה-Replicate
/// שלנו לכל מטרה.
///
/// `PromptEngine` שבאפליקציה משמש לתצוגה מקדימה למשתמש בלבד — הגרסה שבשרת
/// היא הקובעת.
class RenderService {
  final SupabaseClient _client;
  RenderService(this._client);

  /// כמה הדמיות נותרו — בלי לצרוך כלום.
  Future<RenderEligibility> checkEligibility() async {
    final rows = await _client.rpc('render_eligibility');
    final r = (rows is List && rows.isNotEmpty) ? rows.first : rows;
    return RenderEligibility(
      allowed: r?['allowed'] as bool? ?? false,
      reason: r?['reason'] as String? ?? 'unknown',
      freeRemaining: r?['free_remaining'] as int? ?? 0,
      subscriptionTier: r?['subscription_tier'] as String? ?? 'free',
      subscriptionActive: r?['subscription_active'] as bool? ?? false,
    );
  }

  /// מעלה את תמונת המקור לתיקייה הפרטית של המשתמש ומחזיר את הנתיב.
  Future<String> uploadBeforeImage(String localFilePath) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) throw StateError('לא מחובר');
    final name = '$uid/before_${DateTime.now().millisecondsSinceEpoch}.jpg';
    await _client.storage.from('renders').upload(name, File(localFilePath));
    return name;
  }

  /// יוצר הדמיה.
  Future<RenderOutcome> generate({
    required String roomTypeCode,
    required List<MaterialSelection> selections,
    required String beforeImagePath,
    String languageCode = 'he',
  }) async {
    try {
      final res = await _client.functions.invoke(
        'generate-render',
        body: {
          'roomTypeCode': roomTypeCode,
          'beforeImagePath': beforeImagePath,
          'languageCode': languageCode,
          'selections': selections.map(_selectionToJson).toList(),
        },
      );

      final data = res.data as Map<String, dynamic>?;

      if (res.status == 402) return const RenderQuotaExhausted();
      if (res.status != 200 || data == null) {
        return RenderFailure(
          data?['error'] as String? ?? 'unknown',
          data?['detail'] as String?,
        );
      }

      return RenderSuccess(
        renderId: data['renderId'] as String,
        afterImagePath: data['afterImagePath'] as String?,
        fallbackUrl: data['outputUrl'] as String?,
        freeRemaining: data['freeRemaining'] as int? ?? 0,
      );
    } on FunctionException catch (e) {
      if (e.status == 402) return const RenderQuotaExhausted();
      return RenderFailure('function_error', e.details?.toString());
    } catch (e) {
      return RenderFailure('network_error', e.toString());
    }
  }

  /// כתובת חתומה לצפייה בתמונה שנוצרה.
  Future<String> signedUrlFor(String storagePath) => _client.storage
      .from('renders')
      .createSignedUrl(storagePath, 3600);

  // ---------- המרה ל-JSON ----------

  Map<String, dynamic> _selectionToJson(MaterialSelection sel) => {
        'itemId': sel.item.id,
        if (sel.modifiers.isNotEmpty)
          'modifiers': sel.modifiers.map(_modifierToJson).toList(),
      };

  Map<String, dynamic> _modifierToJson(NoteModifier m) => switch (m) {
        HeightLimit h => {
            'kind': 'heightLimit',
            'cm': h.centimeters,
            if (h.aboveTreatmentEn != null)
              'aboveTreatmentEn': h.aboveTreatmentEn,
          },
        StopShortOfEdge s => {
            'kind': 'stopShortOfEdge',
            'cm': s.centimeters,
            'edgeEn': s.edge.labelEn,
          },
        PartialCoverage p => {
            'kind': 'partialCoverage',
            'scopeEn': p.scope.labelEn,
          },
        LayoutDirection d => {
            'kind': 'layoutDirection',
            'directionEn': d.direction.labelEn,
          },
        // הטקסט נשלח כמו שהוא בשפת הלקוח. השרת מנסח אותו מחדש באנגלית —
        // ומתעלם מכל resolvedEn שיגיע מהלקוח.
        FreeTextNote f => {
            'kind': 'freeText',
            'rawText': f.rawText,
          },
      };
}
SHIFTEOF

cat > 'lib/features/home/presentation/home_placeholder_screen.dart' << 'SHIFTEOF'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';

/// Stage-2 placeholder screen.
///
/// Purpose: prove the project boots, the theme/i18n are wired correctly,
/// and the Supabase connection (URL + anon key + `profiles` table from
/// supabase/migrations/0001_init.sql) actually works end-to-end.
///
/// This is intentionally NOT the real home/upload screen from the PRD
/// (camera / gallery upload, project-type picker) — that's built in
/// stage 3/6 once this scaffold is approved.
///
/// **שלב 6 (שחזור/איחוד):** עודכן רק בגלל שינוי טוקני הצבע ב-app_colors.dart
/// (AppColors.emerald / AppColors.mutedText כבר לא קיימים בפלטה החדשה) —
/// שום שינוי לוגי אחר. המסך הזה עדיין זמני; יוחלף כש-app_router.dart יחובר
/// למסכי שלב 6 האמיתיים.
class HomePlaceholderScreen extends StatefulWidget {
  const HomePlaceholderScreen({super.key});

  @override
  State<HomePlaceholderScreen> createState() => _HomePlaceholderScreenState();
}

class _HomePlaceholderScreenState extends State<HomePlaceholderScreen> {
  late final Future<bool> _connectionCheck;

  @override
  void initState() {
    super.initState();
    _connectionCheck = _checkSupabaseConnection();
  }

  Future<bool> _checkSupabaseConnection() async {
    try {
      // Lightweight read against the schema defined in
      // supabase/migrations/0001_init.sql. Succeeds once that migration
      // has been run in the user's Supabase project.
      await Supabase.instance.client.from('profiles').select('id').limit(1);
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppConfig.appName),
        actions: [
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            tooltip: 'language.select'.tr(),
            onSelected: (locale) => context.setLocale(locale),
            itemBuilder: (context) => context.supportedLocales
                .map(
                  (locale) => PopupMenuItem(
                    value: locale,
                    child: Text('language.${locale.languageCode}'.tr()),
                  ),
                )
                .toList(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'home.title'.tr(),
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'home.placeholder_note'.tr(),
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: context.palette.inkSoft),
                  ),
                  const SizedBox(height: 24),
                  FutureBuilder<bool>(
                    future: _connectionCheck,
                    builder: (context, snapshot) {
                      if (!snapshot.hasData) {
                        return CircularProgressIndicator(
                          color: Theme.of(context).colorScheme.primary,
                        );
                      }
                      final connected = snapshot.data!;
                      return Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            connected ? Icons.check_circle : Icons.error,
                            color: connected
                                ? Theme.of(context).colorScheme.primary
                                : AppColors.danger,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            connected
                                ? 'home.connected'.tr()
                                : 'home.not_connected'.tr(),
                          ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
SHIFTEOF

echo "done"
