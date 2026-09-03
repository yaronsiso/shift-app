#!/bin/bash
set -e

echo "== שלב 1/3: מאתר את הפרויקט ומוודא ש-Flutter זמין =="
cd /workspaces/shift-app/shift_app

if [ -f "$HOME/flutter/bin/flutter" ]; then
  export PATH="$HOME/flutter/bin:$PATH"
fi

echo ""
echo "== שלב 2/3: מקטין את צריכת הזיכרון של Gradle (כדי שלא יתרסק שוב) =="
PROPS="android/gradle.properties"
touch "$PROPS"

# מסיר שורות ישנות של אותן הגדרות (אם קיימות) ומוסיף גרסה מותאמת
grep -v -E '^org\.gradle\.(jvmargs|daemon|parallel|workers)' "$PROPS" > "${PROPS}.tmp" || true
mv "${PROPS}.tmp" "$PROPS"

cat >> "$PROPS" << 'EOF'
org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.workers.max=1
EOF

echo "תוכן $PROPS עכשיו:"
cat "$PROPS"

echo ""
echo "== שלב 3/3: בונה APK בגרסת debug (קלה יותר על הזיכרון, מספיקה לבדיקה) =="
flutter build apk --debug

echo ""
echo "=================================================="
echo "✅ סיום! קובץ ההתקנה מוכן:"
ls -la build/app/outputs/flutter-apk/app-debug.apk
echo "=================================================="
