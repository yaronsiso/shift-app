#!/usr/bin/env bash
set -e

echo "== שלב 1: מתקין Flutter SDK עדכני בנתיב נפרד (לא נוגעים בישן) =="
cd /workspaces
if [ -d flutter ]; then
  echo "יש כבר תיקיית /workspaces/flutter — מוחקים ומתקינים מחדש כדי להיות בטוחים שהיא נקייה"
  rm -rf flutter
fi
git clone -b stable --depth 1 https://github.com/flutter/flutter.git
export PATH="/workspaces/flutter/bin:$PATH"

echo ""
echo "--- גרסת ה-Flutter החדשה ---"
flutter --version

echo ""
echo "== שלב 2: מוודא שהתיקייה android/ תקינה =="
cd /workspaces/shift-app
find shift_app/android -maxdepth 4 -iname "AndroidManifest.xml"

if [ ! -f shift_app/android/app/src/main/AndroidManifest.xml ]; then
  echo ""
  echo "❌ הקובץ נעלם. עוצרים כאן — שלח לי את כל הפלט למעלה."
  exit 1
fi

echo ""
echo "== שלב 3: בונה APK חדש (עם ה-Flutter החדש) =="
cd /workspaces/shift-app/shift_app
flutter pub get
flutter build apk --debug
cp build/app/outputs/flutter-apk/app-debug.apk SHIFT_APK_TO_INSTALL.apk
echo "✅ נבנה: SHIFT_APK_TO_INSTALL.apk"
ls -la SHIFT_APK_TO_INSTALL.apk

echo ""
echo "== שלב 4: שמירה ב-git =="
cd /workspaces/shift-app
git add shift_app/lib/features/processing/presentation/processing_screen.dart \
        shift_app/assets/translations/he.json \
        shift_app/assets/translations/en.json \
        shift_app/assets/translations/ru.json \
        shift_app/assets/translations/ar.json
git commit -m "fix(processing): block back navigation while a render is still running

The server-side bug is now fully fixed (confirmed via a real successful
HTTP 200 in Supabase's own invocation logs, ~18.5s execution time). The
remaining problem was client-side: ProcessingScreen correctly guards its
success handler with 'if (!mounted) return;', but real generation now
takes up to ~18-20s while the UI text still promised \"about 15 seconds\"
and nothing stopped the user from backing out early. If they leave before
the response arrives, the request finishes successfully on the server
(consuming a real credit) with no one there to see the result.

Wrap the Scaffold in a PopScope that blocks back-navigation only during
the running phase (failure/quota screens keep their existing explicit
back buttons), and bump the ETA copy in all four languages to \"about 30
seconds\" with a note not to leave the screen, so the promised wait time
comfortably covers real-world generation time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W3TMFTUyNnBNVSFhLxGn9F" || echo "(אין שינוי חדש לשמור — ממשיכים)"
git push origin main
echo "✅ נשמר ונדחף ל-GitHub."

echo ""
echo "✅✅✅ סיימנו! עכשיו צריך להתקין את ה-APK החדש (SHIFT_APK_TO_INSTALL.apk, בתיקיית shift_app) על מכשיר הבדיקה, בדיוק כמו בפעמים הקודמות."
