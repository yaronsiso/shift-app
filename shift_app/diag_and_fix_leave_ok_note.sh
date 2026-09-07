#!/bin/bash
# SHIFT — סשן 15 (המשך): אבחון מדויק + הסרה מבוססת-הקשר של leave_ok_note
#
# האבחון הקודם גילה שני דברים חשובים:
# 1. יש שני עותקי pubspec.yaml בסביבה:
#      /workspaces/shift-app/shift_app_stage2/shift_app/pubspec.yaml
#      /workspaces/shift-app/shift_app/pubspec.yaml
#    (עותק ישן/כפול — כנראה לא הגורם לבעיה כרגע כי כל הסקריפטים עובדים
#    במפורש על shift_app ולא stage2, אבל שווה לדעת שהוא שם.)
# 2. leave_ok_note עדיין קיים בפועל בקובץ המקור (שורה 335) — כלומר
#    הפאץ' הקודם, למרות שדיווח "תקין", בפועל לא הוחל (או הוחל ואז אבד,
#    למשל אם ה-Codespace אופס/נבנה מחדש בלי commit של השינויים).
#
# הפעם: קודם מדפיסים את ההקשר המדויק סביב leave_ok_note (כדי שיהיה תיעוד
# מה בדיוק הוסר), ואז מסירים את הבלוק לפי איזון סוגריים אמיתי (לא ניחוש
# של מחרוזת קבועה) — כך שזה יעבוד גם אם הפורמט המדויק שונה ממה שציפינו.
# בסוף גם עושים git status כדי לבדוק אם יש סיכון שהשינויים יאבדו שוב.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/diag_and_fix_leave_ok_note.sh

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_fix_leave_ok_note.py << 'PYEOF'
import io, re

PATH = "lib/features/processing/presentation/processing_screen.dart"
with io.open(PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

target_idx = None
for i, line in enumerate(lines):
    if "leave_ok_note" in line:
        target_idx = i
        break

if target_idx is None:
    print("✅ leave_ok_note לא נמצא בקובץ — כבר הוסר, אין צורך בפעולה.")
else:
    start_ctx = max(0, target_idx - 8)
    end_ctx = min(len(lines), target_idx + 3)
    print("--- הקשר סביב leave_ok_note (לפני התיקון) ---")
    for i in range(start_ctx, end_ctx):
        print(f"{i+1}: {lines[i]}", end='')
    print("--- סוף הקשר ---\n")

    text_start = None
    for i in range(target_idx, max(-1, target_idx - 6), -1):
        if 'Text(' in lines[i]:
            text_start = i
            break

    if text_start is None:
        print("⚠️ לא הצלחתי לאתר את תחילת ה-Text( שמכילה את leave_ok_note — עוצר בלי לשנות כלום. צריך התערבות ידנית עם ההקשר שהודפס למעלה.")
    else:
        depth = 0
        text_end = None
        started = False
        for i in range(text_start, len(lines)):
            for ch in lines[i]:
                if ch == '(':
                    depth += 1
                    started = True
                elif ch == ')':
                    depth -= 1
            if started and depth == 0:
                text_end = i
                break

        if text_end is None:
            print("⚠️ לא הצלחתי לאזן את הסוגריים של קריאת ה-Text( — עוצר בלי לשנות כלום. צריך התערבות ידנית עם ההקשר שהודפס למעלה.")
        else:
            remove_start = text_start
            if text_start - 1 >= 0 and re.search(r'SizedBox\(\s*height:\s*[\d.]+\s*\)\s*,?\s*$', lines[text_start - 1].strip()):
                remove_start = text_start - 1

            removed_block = ''.join(lines[remove_start:text_end + 1])
            new_lines = lines[:remove_start] + lines[text_end + 1:]

            with io.open(PATH, "w", encoding="utf-8") as f:
                f.writelines(new_lines)

            print("--- הוסר הבלוק הבא (שורות מקוריות %d-%d) ---" % (remove_start + 1, text_end + 1))
            print(removed_block)
            print("--- סוף מה שהוסר ---\n")
            print(f"✅✅ leave_ok_note הוסר בהצלחה מ-{PATH}")
PYEOF

python3 /tmp/_shift_fix_leave_ok_note.py

echo ""
echo "=== בדיקת git status (לוודא שהשינוי לא ילך לאיבוד שוב) ==="
git status --short lib/features/processing/presentation/processing_screen.dart lib/features/result/presentation/result_screen.dart lib/features/home/presentation/home_screen.dart assets/translations/ 2>/dev/null || echo "(לא נמצא git repo כאן, או שגיאה בבדיקה — לא קריטי)"
echo ""
echo "טיפ חשוב: אם יש כאן git, כדאי לעשות commit לשינויים האלה (git add -A && git commit -m 'session 15 fixes') כדי שלא יאבדו אם ה-Codespace יתאפס."
