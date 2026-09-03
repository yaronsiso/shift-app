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
