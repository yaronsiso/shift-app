#!/bin/bash
set -e

echo "== שלב 1/3: מאתר את הפרויקט ומוודא ש-Flutter זמין =="
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

echo ""
echo "== שלב 2/3: מעדכן את גרסת ה-Android SDK שמולה מקמפלים (compileSdk) ל-36 =="
GRADLE_KTS="android/app/build.gradle.kts"
GRADLE_GROOVY="android/app/build.gradle"

python3 - << 'PYEOF'
import re, os

candidates = ["android/app/build.gradle.kts", "android/app/build.gradle"]
path = next((p for p in candidates if os.path.isfile(p)), None)
if not path:
    raise SystemExit("לא נמצא קובץ build.gradle/build.gradle.kts")

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

before = content

# Kotlin DSL style: compileSdk = flutter.compileSdkVersion
content = re.sub(r'compileSdk\s*=\s*flutter\.compileSdkVersion', 'compileSdk = 36', content)
content = re.sub(r'targetSdk\s*=\s*flutter\.targetSdkVersion', 'targetSdk = 36', content)

# Groovy style: compileSdkVersion flutter.compileSdkVersion
content = re.sub(r'compileSdkVersion\s+flutter\.compileSdkVersion', 'compileSdkVersion 36', content)
content = re.sub(r'targetSdkVersion\s+flutter\.targetSdkVersion', 'targetSdkVersion 36', content)

if content == before:
    print("⚠️ לא בוצע שינוי — יכול להיות שכבר מוגדר ידנית. ממשיך בכל זאת.")
else:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"עודכן: {path}")

for line in content.splitlines():
    if "compileSdk" in line or "targetSdk" in line:
        print("  " + line.strip())
PYEOF

echo ""
echo "== שלב 3/3: בונה APK בגרסת debug מחדש (זה עשוי לקחת כמה דקות) =="
flutter build apk --debug

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה מוכן:"
ls -la build/app/outputs/flutter-apk/app-debug.apk
echo "=================================================="
