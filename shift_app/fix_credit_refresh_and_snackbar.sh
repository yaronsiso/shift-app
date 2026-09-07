#!/bin/bash
# SHIFT — סשן 15 (המשך): 3 תיקונים מהבדיקה של ירון על המכשיר
#
# בדיוק כמו add_quota_signup_button.sh — טלאי ממוקד (לא החלפת קובץ
# שלמה), כי הקבצים האלה עברו שינויים בסשנים קודמים שלא תועדו כקוד מלא
# כאן. אם בלוק ספציפי לא נמצא בדיוק פעם אחת — הסקריפט מדפיס שגיאה
# ברורה ולא נוגע בקובץ הזה, כדי שנוכל לבדוק ביחד.
#
# מה זה עושה:
# 1. processing_screen.dart:
#    (א) מבטל (invalidate) את מונה הקרדיטים אחרי כל הגשת הדמיה —
#        זה מתקן את הבאג שמסך הבית תמיד מראה "נותרו לך שלוש הדמיות"
#        גם אחרי שנצרכו/נגמרו קרדיטים.
#    (ב) אותו דבר אחרי כישלון שמוחזר עליו קרדיט אוטומטית.
#    (ג) מסיר את המשפט "אפשר לצאת מהמסך בלי חשש..." ממסך ההמתנה —
#        לפי בקשת ירון שהמשתמשים יישארו, לא יעודדו לצאת.
# 2. result_screen.dart: מוסיף הודעת סנאקבר לשתי שניות "נוספה תמונה
#    חדשה לגלריה שלך" ברגע שתמונת התוצאה נטענת בהצלחה.
# 3. assets/translations/{he,en,ar,ru}.json: מפתח חדש
#    result_screen.saved_to_gallery_snackbar (רק אם לא קיים כבר).
#
# להריץ עם: bash /workspaces/shift-app/shift_app/fix_credit_refresh_and_snackbar.sh

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_patch_round2.py << 'PYEOF'
import json, sys, io

PROCESSING_PATH = "lib/features/processing/presentation/processing_screen.dart"
RESULT_PATH = "lib/features/result/presentation/result_screen.dart"


def patch_file(path, patches, skip_marker):
    """patches: list of (old, new, label). skip_marker: if present in file,
    assume already patched and skip entirely."""
    with io.open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if skip_marker in content:
        print(f"הערה: {path} כבר מכיל '{skip_marker}' — כנראה כבר מטולא, מדלג.")
        return

    changed = False
    for old, new, label in patches:
        count = content.count(old)
        if count != 1:
            print(f"שגיאה ב-{path}: ציפיתי למופע יחיד של [{label}], נמצאו {count}. מדלג על הטלאי הזה בקובץ הזה בלבד.")
            continue
        content = content.replace(old, new, 1)
        changed = True
        print(f"תקין: {path} — טלאי [{label}] הוחל.")

    if changed:
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(content)


# --- processing_screen.dart -------------------------------------------------

OLD_INVALIDATE_SUBMIT = '''      if (!mounted) return;

      switch (outcome) {'''

NEW_INVALIDATE_SUBMIT = '''      if (!mounted) return;

      // סשן 15: מונה הקרדיטים במסך הבית (renderEligibilityProvider,
      // FutureProvider.autoDispose) לא היה מתרענן אחרי הגשת הדמיה —
      // כי HomeScreen נשאר חי מתחת למסך העיבוד (push, לא pushReplacement)
      // וממשיך להחזיק את הערך הישן. מבטלים אותו כאן כדי שייטען
      // מחדש בפעם הבאה שמישהו צופה בו.
      ref.invalidate(renderEligibilityProvider);

      switch (outcome) {'''

OLD_INVALIDATE_REFUND = '''      if (status.isTerminalFailure) {
        _pollTimer?.cancel();
        setState(() {
          _phase = _ProcessingPhase.postFailure;
          _failure = RenderFailure(status.status, status.errorMessage);
        });
        return;
      }'''

NEW_INVALIDATE_REFUND = '''      if (status.isTerminalFailure) {
        _pollTimer?.cancel();
        // סשן 15: כישלון בעיבוד ברקע מחזיר קרדיט אוטומטית בשרת
        // (refund_render_credit) — מבטלים את מונה הזכאות כדי שמסך הבית יראה
        // את הקרדיט המוחזר בפעם הבאה שהוא נטען.
        ref.invalidate(renderEligibilityProvider);
        setState(() {
          _phase = _ProcessingPhase.postFailure;
          _failure = RenderFailure(status.status, status.errorMessage);
        });
        return;
      }'''

OLD_REMOVE_LEAVE_NOTE = '''          const SizedBox(height: 6),
          Text(
            'processing_screen.leave_ok_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.palette.inkFaint,
                ),
          ),
          const SizedBox(height: 32),'''

NEW_REMOVE_LEAVE_NOTE = '''          const SizedBox(height: 32),'''

patch_file(
    PROCESSING_PATH,
    [
        (OLD_INVALIDATE_SUBMIT, NEW_INVALIDATE_SUBMIT, "רינון מונה קרדיטים אחרי הגשה"),
        (OLD_INVALIDATE_REFUND, NEW_INVALIDATE_REFUND, "רינון מונה קרדיטים אחרי החזרת קרדיט"),
        (OLD_REMOVE_LEAVE_NOTE, NEW_REMOVE_LEAVE_NOTE, "הסרת משפט leave_ok_note"),
    ],
    skip_marker="ref.invalidate(renderEligibilityProvider)",
)

# --- result_screen.dart ------------------------------------------------------

OLD_SNACKBAR = '''      setState(() {
        _afterImageUrl = url;
        _loadingImage = false;
      });
    } catch (_) {'''

NEW_SNACKBAR = '''      setState(() {
        _afterImageUrl = url;
        _loadingImage = false;
      });
      // סשן 15: הודעה קצרה שמזכירה למשתמש שיש גלריה אישית — ההדמיה כבר
      // שמורה שם אוטומטית (השרת שומר את after_image_path ברגע
      // שההדמיה מצליחה, עוד לפני שהמסך הזה בכלל נטען).
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('result_screen.saved_to_gallery_snackbar'.tr()),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (_) {'''

patch_file(
    RESULT_PATH,
    [
        (OLD_SNACKBAR, NEW_SNACKBAR, "הודעת סנאקבר גלריה"),
    ],
    skip_marker="saved_to_gallery_snackbar",
)

# --- קובצי תרגום: מוסיפים רק מפתח חדש, לא נוגעים בכלום אחר ---
SNACKBAR_TEXT = {
    "he": "נוספה תמונה חדשה לגלריה שלך",
    "en": "A new image was added to your gallery",
    "ar": "تمت إضافة صورة جديدة إلى معرضك",
    "ru": "В вашу галерею добавлено новое изображение",
}

for locale, label in SNACKBAR_TEXT.items():
    path = f"assets/translations/{locale}.json"
    with io.open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    rs = data.setdefault("result_screen", {})
    if "saved_to_gallery_snackbar" in rs:
        print(f"הערה: {path} כבר מכיל saved_to_gallery_snackbar, לא נוגע בו.")
    else:
        rs["saved_to_gallery_snackbar"] = label
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"תקין: {path} טולא (נוסף result_screen.saved_to_gallery_snackbar).")

print("✅✅ סבב התיקונים השני הושלם")
PYEOF

python3 /tmp/_shift_patch_round2.py
