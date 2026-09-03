#!/bin/bash
set -e

echo "== שלב 1/3: מאתר את הפרויקט ומוודא ש-Flutter זמין =="
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

echo ""
echo "== שלב 2/3: משדרג את share_plus לגרסה עדכנית (עם הגדרות Android תקינות) =="
flutter pub upgrade share_plus --major-versions
echo ""
echo "הגרסה שנבחרה:"
grep "share_plus" pubspec.yaml pubspec.lock | head -5

echo ""
echo "== שלב 3/3: בונה APK בגרסת debug מחדש (זה עשוי לקחת כמה דקות) =="
flutter build apk --debug

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה מוכן:"
ls -la build/app/outputs/flutter-apk/app-debug.apk
echo "=================================================="
