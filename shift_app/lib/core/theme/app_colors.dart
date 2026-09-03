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
