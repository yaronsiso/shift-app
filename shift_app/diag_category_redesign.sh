#!/bin/bash
# SHIFT — סשן 15 (המשך 3): אבחון — ירון דיווח שאחרי מחיקה+התקנה מחדש
# שום דבר לא השתנה (לא סדר הקטגוריות, לא צבע האייקונים). לפני שמנחשים
# שוב, בואו נבדוק בוודאות: (א) האם apply_category_redesign.sh בכלל
# הורץ והשינויים קיימים בקוד המקור, (ב) האם ה-APK שהותקן בכלל נבנה
# אחרי השינויים האלה, (ג) האם יש שוב בעיית עותק-פרויקט כפול.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/diag_category_redesign.sh

cd /workspaces/shift-app/shift_app || { echo "שגיאה: לא נמצאה תיקיית shift_app בנתיב הצפוי"; exit 1; }

echo "=== 1. כמה עותקי pubspec.yaml יש בסביבה? ==="
find /workspaces/shift-app -iname "pubspec.yaml" 2>/dev/null
echo ""

echo "=== 2. האם קוד המיון החדש קיים ב-category_group.dart? ==="
if grep -q "itemsForRoomAndGroupSorted" lib/features/dictionary/data/category_group.dart 2>/dev/null; then
  echo "✅ נמצא itemsForRoomAndGroupSorted — הקובץ הזה כן עודכן."
else
  echo "⚠️ לא נמצא! category_group.dart עדיין הגרסה הישנה — הסקריפט לא הורץ בהצלחה על הקובץ הזה."
fi
echo ""

echo "=== 3. האם מסך תתי-הקטגוריות קיים ב-design_studio_screen.dart? ==="
if grep -q "_SubcategoryListView" lib/features/design_studio/presentation/design_studio_screen.dart 2>/dev/null; then
  echo "✅ נמצא _SubcategoryListView — הקובץ הזה כן עודכן."
else
  echo "⚠️ לא נמצא! design_studio_screen.dart עדיין הגרסה הישנה."
fi
echo ""

echo "=== 4. כמה פעמים מופיע צבע ה-primary באייקונים ב-home_screen.dart? (צריך 5: 1 למונה הקרדיטים + 4 לאייקונים) ==="
COUNT=$(grep -c "color: Theme.of(context).colorScheme.primary" lib/features/home/presentation/home_screen.dart 2>/dev/null || echo 0)
echo "נמצא: $COUNT מופעים"
if [ "$COUNT" -ge 5 ]; then
  echo "✅ זה נראה תקין — כנראה גם האייקונים צבועים בקוד."
else
  echo "⚠️ פחות מ-5 — האייקונים כנראה עדיין לא צבועים בקוד בפועל."
fi
echo ""

echo "=== 5. מצב git — האם יש שינויים לא-שמורים / מה ה-commit האחרון? ==="
git log --oneline -5 2>/dev/null || echo "(לא נמצא git repo)"
echo "--- git status ---"
git status --short lib/features/dictionary/data/category_group.dart lib/features/design_studio/presentation/design_studio_screen.dart lib/features/home/presentation/home_screen.dart 2>/dev/null
echo ""

echo "=== 6. תזמון: מתי נבנה ה-APK האחרון, לעומת מתי נערכו הקבצים? ==="
if [ -f build/app/outputs/flutter-apk/app-debug.apk ]; then
  echo "APK נבנה ב:"
  stat -c '%y  %n' build/app/outputs/flutter-apk/app-debug.apk 2>/dev/null || stat -f '%Sm  %N' build/app/outputs/flutter-apk/app-debug.apk
else
  echo "לא נמצא build/app/outputs/flutter-apk/app-debug.apk — כלומר עוד לא בנית APK מאז שהתחלת את התיקייה הזו (או שהוא נמחק)."
fi
echo "קבצי המקור נערכו לאחרונה ב:"
stat -c '%y  %n' lib/features/dictionary/data/category_group.dart lib/features/home/presentation/home_screen.dart lib/features/design_studio/presentation/design_studio_screen.dart 2>/dev/null || \
stat -f '%Sm  %N' lib/features/dictionary/data/category_group.dart lib/features/home/presentation/home_screen.dart lib/features/design_studio/presentation/design_studio_screen.dart
echo ""
echo "(אם ה-APK ישן יותר מהקבצים — זה סימן שבנית APK *לפני* ההרצה של apply_category_redesign.sh, והתקנת גרסה ישנה)."
