#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p lib
cat > lib/main.dart << 'DARTEOF'
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

  // סשן 7: "כניסה אנונימית" שקטה בכל פתיחת אפליקציה — בלי מסך התחברות
  // ובלי שהמשתמש שם לב. Supabase חוסם מטעמי אבטחה (RLS) כל גישה
  // לנתונים — העלאת תמונה, צריכת קרדיט, פדיית קופון וכו' — ממשתמש לא
  // מזוהה. בלי השורות האלה שום קריאה לשרת לא עובדת בפועל (זה בדיוק מה
  // שגרם ל"משהו השתבש" בבדיקה הראשונה על מכשיר אמיתי). ה-session נשמר
  // במכשיר, אז זה קורה בפועל רק פעם אחת לכל התקנה, לא בכל פתיחה.
  //
  // ⚠️ דורש להפעיל "Anonymous Sign-Ins" ב-Supabase Dashboard →
  // Authentication → Sign In / Providers, אחרת הקריאה הזו תיכשל.
  final client = Supabase.instance.client;
  if (client.auth.currentSession == null) {
    await client.auth.signInAnonymously();
  }

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
DARTEOF

echo "== main.dart עודכן. מריץ flutter analyze לוודא שהכל תקין =="
if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi
flutter analyze

echo ""
echo "== בונה APK debug מחדש =="
flutter build apk --debug

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה החדש מוכן:"
ls -la build/app/outputs/flutter-apk/app-debug.apk
cp build/app/outputs/flutter-apk/app-debug.apk SHIFT_APK_TO_INSTALL.apk
echo "עותק נוסף גם כאן (קל יותר למצוא ב-Explorer):"
echo "shift_app/SHIFT_APK_TO_INSTALL.apk"
echo "=================================================="
