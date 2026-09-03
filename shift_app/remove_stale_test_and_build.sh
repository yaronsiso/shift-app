#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

echo "== מסיר קובץ טסט-ברירת-מחדל לא רלוונטי (test/widget_test.dart) =="
rm -f test/widget_test.dart

echo ""
echo "== מריץ flutter analyze לוודא שהכל נקי =="
flutter analyze

echo ""
echo "== בונה APK debug מחדש (זה עשוי לקחת כמה דקות) =="
flutter build apk --debug

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה מוכן:"
cp build/app/outputs/flutter-apk/app-debug.apk SHIFT_APK_TO_INSTALL.apk
ls -la SHIFT_APK_TO_INSTALL.apk
echo "(נמצא בתיקייה הראשית של shift_app, ליד pubspec.yaml)"
echo "=================================================="
