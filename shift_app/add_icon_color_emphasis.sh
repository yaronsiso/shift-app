#!/bin/bash
# SHIFT — סשן 15 (המשך): צביעה בולטת יותר לאייקוני הסרגל העליון
#
# בקשת ירון: האייקונים למעלה במסך הבית (גלריה/קופון/חשבון/שפה) לא
# בולטים מספיק. ירון בחר במפורש: **צבע בולט יותר, לא רקע/עיגול**.
# הצבע שנבחר: Theme.of(context).colorScheme.primary — זה בדיוק הצבע
# שכבר משמש בכל האפליקציה לדברים שאמורים לבלוט (כותרת מסך הבית, מונה
# הקרדיטים, הטקסט בפס הנייד) — כדי לשמור על עקביות ולא להמציא צבע חדש.
#
# שוב טלאי ממוקד, לא החלפת קובץ שלמה: home_screen.dart עבר שינוי בסשן
# 13 (נוסף אייקון חשבון) שלא תועד כקוד מלא כאן, אז אין טעם לנחש את כל
# הקובץ. הסקריפט מטפל בכל אייקון בנפרד, ומדלג (עם הודעה ברורה, בלי
# להפיל את שאר הסקריפט) על כל אייקון שהטקסט המדויק שלו לא נמצא.
#
# להריץ עם: bash /workspaces/shift-app/shift_app/add_icon_color_emphasis.sh

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_patch_icons.py << 'PYEOF'
import io

PATH = "lib/features/home/presentation/home_screen.dart"
COLOR_EXPR = "Theme.of(context).colorScheme.primary"
SKIP_MARKER = f"color: {COLOR_EXPR}"

with io.open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if SKIP_MARKER in content:
    print(f"הערה: {PATH} כבר מכיל '{SKIP_MARKER}' — כנראה כבר טולא (לפחות אייקון אחד), מדלג על כל הקובץ.")
else:
    # כל אייקון: רשימת מועמדים אפשריים לטקסט הישן (בסדר עדיפות) — כדי
    # להתמודד עם אי-ודאות לגבי הניסוח המדויק אחרי שינויים לא-מתועדים.
    icons = [
        ("גלריה", [
            "icon: const Icon(Icons.photo_library_outlined),",
        ]),
        ("קופון", [
            "icon: const Icon(Icons.confirmation_number_outlined),",
        ]),
        ("שפה", [
            "icon: const Icon(Icons.language),",
        ]),
        ("חשבון", [
            "icon: const Icon(Icons.person_outline),",
            "icon: const Icon(Icons.person_outline)",
            "const Icon(Icons.person_outline),",
            "const Icon(Icons.person_outline)",
        ]),
    ]

    applied = []
    skipped = []

    for label, candidates in icons:
        done = False
        for old in candidates:
            count = content.count(old)
            if count == 1:
                # בונים את הגרסה החדשה: מסירים "const " (כי color תלוי
                # ב-Theme.of(context), אז זה כבר לא ניתן ל-const), ומוסיפים
                # פרמטר color לפני הסוגר הסוגר של ה-Icon(...).
                new = old.replace("const Icon(", "Icon(", 1)
                # מוצאים את ")" הראשון אחרי "Icon(" כדי להכניס את color
                # ממש לפני הסגירה של קריאת ה-Icon עצמה (לא של ה-IconButton).
                icon_start = new.index("Icon(")
                close_idx = new.index(")", icon_start)
                new = new[:close_idx] + f", color: {COLOR_EXPR}" + new[close_idx:]
                content = content.replace(old, new, 1)
                applied.append(label)
                done = True
                break
        if not done:
            skipped.append(label)

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(content)

    if applied:
        print(f"תקין: {PATH} — נצבעו האייקונים: {', '.join(applied)}.")
    if skipped:
        print(f"הערה: לא נמצא טקסט מדויק תואם עבור: {', '.join(skipped)} — אלה לא טופלו, צריך לבדוק ידנית.")

print("✅✅ צביעת האייקונים הושלמה")
PYEOF

python3 /tmp/_shift_patch_icons.py
