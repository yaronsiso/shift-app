#!/bin/bash
# SHIFT — סשן 15 (המשך): ניקוי שאריות אחרי הסרת leave_ok_note
#
# הסקריפט הקודם (diag_and_fix_leave_ok_note.sh) הסיר בהצלחה את
# child: Text('processing_screen.leave_ok_note'...) אבל השאיר את ה-
# SizedBox(width: double.infinity, ...) שעטף אותו — עכשיו הוא ריק
# (בלי child). זה לא באג (SizedBox בלי child הוא תקין, פשוט תיבה בלתי
# נראית), אבל זה קוד מת שכדאי לנקות. הסקריפט הזה גם מסיר את
# SizedBox(height: 6) שהיה לפניו (המרווח שהיה קיים רק בשביל המשפט
# שכבר לא שם).
#
# להריץ עם: bash /workspaces/shift-app/shift_app/cleanup_empty_sizedbox.sh

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_cleanup.py << 'PYEOF'
import io, re

PATH = "lib/features/processing/presentation/processing_screen.dart"
with io.open(PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

# מוצאים SizedBox( ... width: double.infinity ... ) שאין לו child: בפנים
sb_start = None
for i, line in enumerate(lines):
    if re.search(r'\bSizedBox\(\s*$', line):
        # בודקים אם זה ה-SizedBox עם width: double.infinity בשורה הבאה
        if i + 1 < len(lines) and 'width: double.infinity' in lines[i + 1]:
            sb_start = i
            break

if sb_start is None:
    print("✅ לא נמצא SizedBox ריק עם width: double.infinity — כנראה כבר נוקה, או שהמבנה שונה. לא בוצע שינוי.")
else:
    depth = 0
    sb_end = None
    started = False
    for i in range(sb_start, len(lines)):
        for ch in lines[i]:
            if ch == '(':
                depth += 1
                started = True
            elif ch == ')':
                depth -= 1
        if started and depth == 0:
            sb_end = i
            break

    if sb_end is None:
        print("⚠️ לא הצלחתי לאזן את הסוגריים של ה-SizedBox — עוצר בלי לשנות כלום.")
    else:
        block = ''.join(lines[sb_start:sb_end + 1])
        if 'child:' in block:
            print("הערה: ה-SizedBox הזה עדיין מכיל child: — כנראה זה לא הבלוק שהתכוונו אליו, לא נוגעים בו.")
            print("--- תוכן הבלוק שנבדק (לבדיקה ידנית) ---")
            print(block)
        else:
            remove_start = sb_start
            # אם השורה שלפני היא SizedBox(height: 6), מסירים גם אותה
            if sb_start - 1 >= 0 and re.search(r'SizedBox\(\s*height:\s*[\d.]+\s*\)\s*,?\s*$', lines[sb_start - 1].strip()):
                remove_start = sb_start - 1

            removed_block = ''.join(lines[remove_start:sb_end + 1])
            new_lines = lines[:remove_start] + lines[sb_end + 1:]

            with io.open(PATH, "w", encoding="utf-8") as f:
                f.writelines(new_lines)

            print("--- הוסר הבלוק הבא (ניקוי) ---")
            print(removed_block)
            print("--- סוף מה שהוסר ---\n")
            print(f"✅✅ נוקה בהצלחה — SizedBox הריק (וה-spacer שלפניו, אם היה) הוסרו מ-{PATH}")
PYEOF

python3 /tmp/_shift_cleanup.py

echo ""
echo "=== הקשר עדכני סביב האזור (לבדיקה חזותית) ==="
grep -n "SizedBox\|leave_ok_note" lib/features/processing/presentation/processing_screen.dart | sed -n '1,40p'
