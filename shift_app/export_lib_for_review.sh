#!/bin/bash
# SHIFT — סשן 15 (המשך 3): ייצוא כל תיקיית lib/ + תרגומים לסקירה
#
# כדי לתכנן נכון את שינוי הקטגוריות (זרימה חדשה: חדר -> קטגוריות
# ממוינות לפי רלוונטיות -> פריטים), אני צריך לראות את הקוד האמיתי
# והעדכני של כל הקבצים הרלוונטיים — לא לנחש לפי תיעוד ישן. במקום
# להעתיק קבצים בודדים (וכנראה לפספס משהו), הסקריפט הזה אורז את כל
# lib/ + assets/translations/ + pubspec.yaml ל-ZIP אחד.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/export_lib_for_review.sh
#
# אחרי ההרצה: תוריד את shift_app_export.zip מה-Codespace למחשב שלך —
# קליק ימני עליו בפאנל ה-Explorer בצד שמאל -> Download. הוא בדרך כלל
# ייפול לתיקיית ההורדות שלך (Downloads) — משם אני אוכל למשוך אותו
# ישירות.

set -e
cd /workspaces/shift-app/shift_app

rm -f shift_app_export.zip
zip -r shift_app_export.zip lib assets/translations pubspec.yaml -x "*.g.dart" > /tmp/_zip_log.txt

echo "=== נוצר: shift_app_export.zip ==="
ls -la shift_app_export.zip
echo ""
echo "=== תוכן שנארז (רשימת קבצים) ==="
unzip -l shift_app_export.zip
echo ""
echo "עכשיו: קליק ימני על shift_app_export.zip בפאנל הקבצים משמאל -> Download."
