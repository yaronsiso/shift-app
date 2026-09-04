#!/usr/bin/env bash
set -e

echo "== בדיקה: מצב ה-git וה-android/ בפרויקט =="
cd /workspaces/shift-app

echo "--- git status (שורש הריפו) ---"
git status

echo ""
echo "--- commit נוכחי ---"
git log -1 --oneline

echo ""
echo "--- מה שהריפו המקומי חושב שיש בתיקיית android/app/src/main/ ---"
ls -la shift_app/android/app/src/main/ 2>&1 || echo "(התיקייה עצמה לא קיימת)"

echo ""
echo "== מנסה למשוך שינויים עדכניים מ-GitHub =="
git fetch origin
git status

echo ""
echo "== משחזר את תיקיית android/ בדיוק כפי שהיא ב-git (בלי לגעת בשום דבר אחר) =="
git checkout HEAD -- shift_app/android/
git checkout origin/main -- shift_app/android/ 2>/dev/null || true

echo ""
echo "--- אחרי השחזור ---"
ls -la shift_app/android/app/src/main/ 2>&1 || echo "(עדיין לא קיימת — נדרשת בדיקה נוספת)"

if [ -f shift_app/android/app/src/main/AndroidManifest.xml ]; then
  echo ""
  echo "✅ הקובץ AndroidManifest.xml נמצא! עכשיו אפשר לנסות שוב את סקריפט הבנייה."
else
  echo ""
  echo "⚠️ הקובץ עדיין חסר. תשלח לי את כל הפלט למעלה — נצטרך לבדוק לעומק."
fi
