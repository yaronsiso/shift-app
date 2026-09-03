#!/bin/bash
set -e

echo "== שלב 1/4: מאתר את הפרויקט ומוודא ש-Flutter זמין =="
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

echo ""
echo "== שלב 2/4: מתקין Java 17 (נדרש לגרסת Gradle החדשה שנוצרה) =="
apt-get update -y
apt-get install -y openjdk-17-jdk-headless

JAVA17_PATH=$(update-alternatives --list java 2>/dev/null | grep 'java-17' | head -1 | sed 's|/bin/java$||')
if [ -z "$JAVA17_PATH" ]; then
  JAVA17_PATH=$(find /usr/lib/jvm -maxdepth 1 -iname "*17*" 2>/dev/null | head -1)
fi
if [ -z "$JAVA17_PATH" ]; then
  echo "⚠️ לא הצלחתי לאתר את נתיב Java 17 אוטומטית. פלט לבדיקה ידנית:"
  update-alternatives --list java || true
  ls /usr/lib/jvm/ || true
  exit 1
fi
echo "Java 17 נמצא ב: $JAVA17_PATH"

echo ""
echo "== שלב 3/4: מגדיר את Flutter להשתמש ב-Java 17 =="
flutter config --jdk-dir="$JAVA17_PATH"

echo ""
echo "== שלב 4/4: בונה APK מחדש (זה עשוי לקחת כמה דקות) =="
flutter build apk --release

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה מוכן:"
ls -la build/app/outputs/flutter-apk/app-release.apk
echo "=================================================="
