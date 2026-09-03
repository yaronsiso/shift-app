#!/bin/bash
set -e

echo "== שלב 1/5: מאתר את הפרויקט ומוודא ש-Flutter זמין =="
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "לא נמצא flutter ב-PATH. משכפל מחדש..."
  git clone https://github.com/flutter/flutter.git -b stable --depth 1 "$HOME/flutter"
  export PATH="$HOME/flutter/bin:$PATH"
fi

flutter --version

echo ""
echo "== שלב 2/5: מוסיף תמיכת Android לפרויקט (יוצר תיקיית android/) =="
flutter create . --platforms=android --org com.shiftapp --project-name shift_app

echo ""
echo "== שלב 3/5: מתקן את מזהה האפליקציה ל-com.shiftapp.mobile =="
GRADLE_KTS="android/app/build.gradle.kts"
GRADLE_GROOVY="android/app/build.gradle"

if [ -f "$GRADLE_KTS" ]; then
  sed -i 's/applicationId = "com.shiftapp.shift_app"/applicationId = "com.shiftapp.mobile"/' "$GRADLE_KTS"
  grep -n "applicationId" "$GRADLE_KTS"
elif [ -f "$GRADLE_GROOVY" ]; then
  sed -i 's/applicationId "com.shiftapp.shift_app"/applicationId "com.shiftapp.mobile"/' "$GRADLE_GROOVY"
  grep -n "applicationId" "$GRADLE_GROOVY"
else
  echo "⚠️ לא נמצא קובץ build.gradle — לעצור ולבדוק ידנית."
  exit 1
fi

echo ""
echo "== שלב 4/5: מוסיף הרשאת מצלמה ל-AndroidManifest.xml =="
MANIFEST="android/app/src/main/AndroidManifest.xml"
if grep -q "android.permission.CAMERA" "$MANIFEST"; then
  echo "הרשאת מצלמה כבר קיימת — לא נוגע."
else
  python3 - "$MANIFEST" << 'PYEOF'
import re, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()
perm = '    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-feature android:name="android.hardware.camera" android:required="false"/>\n'
match = re.search(r'(<manifest[^>]*>)', content)
if not match:
    raise SystemExit("לא נמצא תג <manifest> — לעצור.")
insert_pos = match.end()
content = content[:insert_pos] + "\n" + perm + content[insert_pos:]
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("הרשאת מצלמה נוספה.")
PYEOF
fi

echo ""
echo "== שלב 5/5: בונה APK להתקנה (זה עשוי לקחת כמה דקות) =="
flutter pub get
flutter build apk --release

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה נמצא כאן:"
echo "   android/app/build/../../build/app/outputs/flutter-apk/app-release.apk"
ls -la build/app/outputs/flutter-apk/app-release.apk
echo "=================================================="
