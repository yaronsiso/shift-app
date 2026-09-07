#!/bin/bash
# SHIFT — סשן 15: כפתור "מעבר להרשמה/התחברות" במסך "נגמרה המכסה"
#
# למה בצורה הזאת (טלאי ממוקד, לא החלפת קובץ שלמה):
# processing_screen.dart ו-4 קובצי התרגום עברו שינויים בסשנים 10-14
# (סמלי בית, מסכי התחברות, כפתור חשבון וכו') שלא תועדו כקוד מלא בפרויקט
# הזה — רק כתמצית. במקום לשחזר קובץ שלם מהזיכרון ולהסתכן במחיקת שינויים
# שכבר קיימים אצלך (למשל namespace auth_screen, או תיקון ה-ETA), הסקריפט
# הזה פותח את הקבצים האמיתיים שלך כמו שהם עכשיו, מוצא רק את הבלוק הספציפי
# שצריך להחליף, ומחליף רק אותו. אם הבלוק לא נמצא בדיוק פעם אחת — הסקריפט
# עוצר עם שגיאה ברורה ולא נוגע בכלום, כדי שנוכל לבדוק ביחד מה השתנה.
#
# מה זה עושה:
# 1. lib/features/processing/presentation/processing_screen.dart —
#    _QuotaExhaustedView מקבל כפתור ראשי חדש "מעבר להרשמה / התחברות"
#    שמוביל ל-AppRoutes.auth (מסך ההתחברות מסשן 13, שמשדרג את המשתמש
#    האנונימי הקיים — לא יוצר חדש, אז שום קרדיט/היסטוריה לא הולכים
#    לאיבוד). כפתור "חזרה למסך הבית" נשאר כאופציה משנית.
# 2. assets/translations/{he,en,ar,ru}.json — נוסף מפתח חדש
#    processing_screen.quota_signup_button (רק אם הוא לא קיים כבר).
#
# להריץ עם: bash /workspaces/shift-app/shift_app/add_quota_signup_button.sh
# (נתיב מלא — עובד מכל תיקייה שהטרמינל פתוח בה.)

set -e
cd /workspaces/shift-app/shift_app

cat > /tmp/_shift_patch_quota_button.py << 'PYEOF'
import json, sys, io

DART_PATH = "lib/features/processing/presentation/processing_screen.dart"

OLD_WIDGET = '''class _QuotaExhaustedView extends StatelessWidget {
  final VoidCallback onBackHome;
  const _QuotaExhaustedView({required this.onBackHome});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.hourglass_bottom,
              size: 48, color: context.palette.inkFaint),
          const SizedBox(height: 16),
          Text(
            'processing_screen.quota_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.quota_body'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onBackHome,
              child: Text('processing_screen.quota_button'.tr()),
            ),
          ),
        ],
      ),
    );
  }
}'''

NEW_WIDGET = '''/// סשן 15: נוסף onSignUp — כפתור ראשי חדש שמוביל למסך ההרשמה/התחברות
/// (AppRoutes.auth), כמיתון לפרצה "מחיקה+התקנה מחדש = עוד 3 הדמיות חינם".
class _QuotaExhaustedView extends StatelessWidget {
  final VoidCallback onSignUp;
  final VoidCallback onBackHome;
  const _QuotaExhaustedView({
    required this.onSignUp,
    required this.onBackHome,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.hourglass_bottom,
              size: 48, color: context.palette.inkFaint),
          const SizedBox(height: 16),
          Text(
            'processing_screen.quota_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.quota_body'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onSignUp,
              child: Text('processing_screen.quota_signup_button'.tr()),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: onBackHome,
              child: Text('processing_screen.quota_button'.tr()),
            ),
          ),
        ],
      ),
    );
  }
}'''

OLD_CALLSITE = '''          _ProcessingPhase.quotaExhausted => _QuotaExhaustedView(
              onBackHome: () => context.go(AppRoutes.home),
            ),'''

NEW_CALLSITE = '''          _ProcessingPhase.quotaExhausted => _QuotaExhaustedView(
              onSignUp: () => context.push(AppRoutes.auth),
              onBackHome: () => context.go(AppRoutes.home),
            ),'''


def patch_one(content, old, new, label):
    count = content.count(old)
    if count != 1:
        print(f"שגיאה: ציפיתי למופע יחיד של {label}, נמצאו {count}. עוצר בלי לשנות כלום.")
        sys.exit(1)
    return content.replace(old, new, 1)


with io.open(DART_PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "onSignUp" in content:
    print("הערה: processing_screen.dart כבר מכיל onSignUp — כנראה כבר מטולא, מדלג על שינוי ה-Dart.")
else:
    content = patch_one(content, OLD_WIDGET, NEW_WIDGET, "בלוק ה-widget של _QuotaExhaustedView")
    content = patch_one(content, OLD_CALLSITE, NEW_CALLSITE, "נקודת הקריאה ל-_QuotaExhaustedView")
    with io.open(DART_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("תקין: processing_screen.dart טולא בהצלחה.")

# --- קובצי תרגום: מוסיפים רק את המפתח החדש, לא נוגעים בכלום אחר ---
SIGNUP_LABEL = {
    "he": "מעבר להרשמה / התחברות",
    "en": "Sign up / Log in",
    "ar": "التسجيل / تسجيل الدخول",
    "ru": "Регистрация / Вход",
}

for locale, label in SIGNUP_LABEL.items():
    path = f"assets/translations/{locale}.json"
    with io.open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    ps = data.setdefault("processing_screen", {})
    if "quota_signup_button" in ps:
        print(f"הערה: {path} כבר מכיל quota_signup_button, לא נוגע בו.")
    else:
        ps["quota_signup_button"] = label
        with io.open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"תקין: {path} טולא (נוסף processing_screen.quota_signup_button).")

print("✅✅ הטלאי הושלם בהצלחה")
PYEOF

python3 /tmp/_shift_patch_quota_button.py
