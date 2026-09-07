#!/bin/bash
# SHIFT — סשן 15 (המשך): ניקוי מדויק של ה-SizedBox הריק (גרסה 2)
#
# הסקריפט הקודם (cleanup_empty_sizedbox.sh) היה זהיר מדי ותפס את ה-
# SizedBox החיצוני הלא נכון (יש לו child: Padding(...) ) ונמנע מלגעת
# בו כמו שצריך. עכשיו, מהפלט שירון שלח, יודעים בדיוק את המבנה:
#
#   const SizedBox(height: 6),
#   SizedBox(
#     width: double.infinity,
#   ),
#   const SizedBox(height: 32),
#
# הסקריפט הזה מחפש במפורש את הרצף המדויק הזה (SizedBox עם width:
# double.infinity ובלי child בכלל בפנים) ומסיר אותו יחד עם ה-spacer
# שלפניו (height: 6), משאיר את ה-spacer שאחריו (height: 32).
#
# להריץ עם: bash /workspaces/shift-app/shift_app/cleanup_empty_sizedbox_v2.sh

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_cleanup_v2.py << 'PYEOF'
import io, re

PATH = "lib/features/processing/presentation/processing_screen.dart"
with io.open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

# מחפשים את הרצף המדויק: SizedBox( ... width: double.infinity, ... ) —
# בלי שום "child:" בפנים — כלומר רק 3 שורות: פתיחה, width, סגירה.
pattern = re.compile(
    r'[ \t]*const SizedBox\(height:\s*6\),\n'
    r'[ \t]*SizedBox\(\n'
    r'[ \t]*width:\s*double\.infinity,\n'
    r'[ \t]*\),\n'
)

matches = list(pattern.finditer(content))
if not matches:
    print("✅ לא נמצא הרצף המדויק (SizedBox(height:6) + SizedBox ריק) — כנראה כבר נוקה, או שהמבנה השתנה. לא בוצע שינוי.")
elif len(matches) > 1:
    print(f"⚠️ נמצאו {len(matches)} מופעים תואמים — לא ברור איזה להסיר, עוצר בלי לשנות כלום כדי לא לפגוע במקום הלא נכון.")
else:
    m = matches[0]
    removed = content[m.start():m.end()]
    new_content = content[:m.start()] + content[m.end():]
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("--- הוסר הבלוק הבא ---")
    print(removed)
    print("--- סוף מה שהוסר ---\n")
    print(f"✅✅ נוקה בהצלחה מ-{PATH}")
PYEOF

python3 /tmp/_shift_cleanup_v2.py

echo ""
echo "=== הקשר עדכני (לבדיקה חזותית) — שורות עם SizedBox סביב האזור ==="
grep -n "SizedBox\|leave_ok_note" lib/features/processing/presentation/processing_screen.dart | sed -n '1,15p'
