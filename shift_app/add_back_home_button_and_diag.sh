#!/bin/bash
# SHIFT — סשן 15 (המשך): כפתור "חזרה למסך הבית" במסך התוצאה + בדיקת
# אבחון למקרה שמשפט "אפשר לצאת מהמסך" עדיין מופיע אצל ירון על המכשיר
# למרות שהפאץ' הקודם דיווח שהוחל בהצלחה.
#
# למה יש כאן גם בדיקת אבחון (לא רק תיקון חדש):
# ירון דיווח ש-processing_screen.dart עדיין מציג את המשפט "אפשר לצאת
# מהמסך בלי חשש" למרות שהסקריפט הקודם (fix_credit_refresh_and_snackbar.sh)
# הדפיס "תקין ... הוחל" עליו. יש שתי אפשרויות: (א) יש עוד עותק פרויקט
# עם pubspec.yaml שהבנייה בטעות משתמשת בו (קרה בעבר בפרויקט הזה, ראו
# claude/24), או (ב) ה-APK שהותקן על המכשיר הוא לא ה-APK הכי טרי
# (למשל קובץ ישן עם אותו שם ב-Downloads שלא הוחלף). הבדיקה כאן בודקת
# את שני אלה ומדפיסה בבירור מה היא מצאה.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/add_back_home_button_and_diag.sh

set -e
cd /workspaces/shift-app/shift_app

echo "=== שלב אבחון 1: כמה עותקי pubspec.yaml יש בכלל? ==="
find /workspaces/shift-app -iname "pubspec.yaml" 2>/dev/null || true
echo ""

echo "=== שלב אבחון 2: האם 'leave_ok_note' עדיין קיים במקור? ==="
if grep -n "leave_ok_note" lib/features/processing/presentation/processing_screen.dart; then
  echo "⚠️ נמצא! המשפט עדיין קיים בקובץ המקור עצמו — צריך לבדוק למה הפאץ' הקודם לא באמת הוחל (למרות שהוא דיווח שכן)."
else
  echo "✅ לא נמצא בקובץ המקור — הקוד תקין. אם המשפט עדיין מופיע במכשיר, זו כמעט בוודאות בעיה של APK ישן/לא-מעודכן שהותקן, לא בעיה בקוד. פתרון: למחוק את קובץ ה-app-debug.apk הישן (אם יש כזה כבר ב-Downloads אצלך), להריץ שוב flutter build apk --debug, ולוודא שמתקינים בדיוק את הקובץ שנוצר עכשיו (לבדוק תאריך/שעת יצירה של הקובץ)."
fi
echo ""

cat > /tmp/_shift_patch_back_home.py << 'PYEOF'
import json, sys, io

RESULT_PATH = "lib/features/result/presentation/result_screen.dart"

OLD_BUTTONS = '''                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.go(AppRoutes.home),
                            child: Text(
                                'result_screen.design_again_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.push(AppRoutes.gallery),
                            child: Text(
                                'result_screen.view_gallery_button'.tr()),
                          ),
                        ),'''

NEW_BUTTONS = '''                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.go(AppRoutes.home),
                            child: Text(
                                'result_screen.design_again_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 4),
                        // סשן 15: כפתור נפרד וברור "חזרה למסך הבית" —
                        // ירון דיווח שאחרי קבלת התמונה אין דרך ברורה
                        // לחזור הביתה חוץ מ"עיצוב נוסף לחדר הזה" (שגם
                        // הוא בפועל הולך הביתה, אבל הניסוח לא ברור לזה).
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.go(AppRoutes.home),
                            child:
                                Text('result_screen.back_home_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.push(AppRoutes.gallery),
                            child: Text(
                                'result_screen.view_gallery_button'.tr()),
                          ),
                        ),'''

with io.open(RESULT_PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "result_screen.back_home_button" in content:
    print(f"הערה: {RESULT_PATH} כבר מכיל back_home_button — כנראה כבר מטולא, מדלג.")
else:
    count = content.count(OLD_BUTTONS)
    if count != 1:
        print(f"שגיאה: ציפיתי למופע יחיד של בלוק הכפתורים ב-{RESULT_PATH}, נמצאו {count}. עוצר בלי לשנות את הקובץ הזה.")
        sys.exit(1)
    content = content.replace(OLD_BUTTONS, NEW_BUTTONS, 1)
    with io.open(RESULT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"תקין: {RESULT_PATH} — נוסף כפתור 'חזרה למסך הבית'.")

# --- קובצי תרגום: מוסיפים רק מפתח חדש ---
BACK_HOME_TEXT = {
    "he": "חזרה למסך הבית",
    "en": "Back to home",
    "ar": "العودة إلى الشاشة الرئيسية",
    "ru": "Назад на главный экран",
}

for locale, label in BACK_HOME_TEXT.items():
    path = f"assets/translations/{locale}.json"
    with io.open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    rs = data.setdefault("result_screen", {})
    if "back_home_button" in rs:
        print(f"הערה: {path} כבר מכיל back_home_button, לא נוגע בו.")
    else:
        rs["back_home_button"] = label
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"תקין: {path} טולא (נוסף result_screen.back_home_button).")

print("✅✅ כפתור חזרה למסך הבית נוסף בהצלחה")
PYEOF

python3 /tmp/_shift_patch_back_home.py
