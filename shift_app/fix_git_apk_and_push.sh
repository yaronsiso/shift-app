#!/bin/bash
set -e
cd /workspaces/shift-app

echo "== שלב 1/4: מבטל את ההתחייבות (commit) האחרונה שנכשלה בדחיפה =="
echo "   (השינויים עצמם לא נמחקים — רק ה'תיוג' המקומי מתבטל, כדי שנוכל לתקן ולנסות שוב)"
git reset --soft HEAD~1

echo ""
echo "== שלב 2/4: מוציא את קובץ ה-APK הגדול מהמעקב של git (הוא נשאר על הדיסק אצלך) =="
git rm --cached shift_app/SHIFT_APK_TO_INSTALL.apk 2>/dev/null || echo "   (כבר לא היה במעקב, ממשיך)"

echo ""
echo "== שלב 3/4: מוסיף כלל קבוע שלא לעקוב יותר אחרי קבצי APK =="
if [ ! -f .gitignore ]; then
  touch .gitignore
fi
if ! grep -qxF "shift_app/*.apk" .gitignore 2>/dev/null; then
  echo "shift_app/*.apk" >> .gitignore
fi

echo ""
echo "== שלב 4/4: יוצר commit חדש (בלי ה-APK) ודוחף =="
git add -A
git commit -m "הוספת כניסה אנונימית + הסרת טסט לא רלוונטי + הוצאת APK מ-git"
git push

echo ""
echo "=================================================="
echo "✅ סיום! מצב סופי:"
git log -1 --format="%H %cd %s"
echo ""
echo "קובץ ההתקנה עדיין קיים כרגיל בשבילך (רק לא ב-git):"
ls -la shift_app/SHIFT_APK_TO_INSTALL.apk
echo "=================================================="
