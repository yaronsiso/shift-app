# הפעלה ראשונה של פרויקט SHIFT — הוראות למחשב שלך

הקוד (`lib/`, `pubspec.yaml`, `assets/`, `supabase/`) נכתב כאן במלואו, אבל הסביבה
העננית הזו חסומה מגישה לתשתיות ש-Flutter/Dart תלויים בהן (pub.dev,
storage.googleapis.com) — כך שלא הצלחתי להריץ `flutter pub get` / `flutter
analyze` ולוודא build בפועל. את זה צריך לעשות פעם אחת אצלך, במחשב עם Flutter
מותקן וגישה רגילה לאינטרנט. הפעולות הבאות הן חד-פעמיות (רק בהקמה הראשונית).

## שלב 1: יצירת תשתית Android/iOS (חד פעמי)

הקוד שלנו לא כולל עדיין את תיקיות `android/` ו-`ios/` (הקבצים הטכניים
שה-Flutter tooling מייצר אוטומטית לכל פלטפורמה — כולל קובץ Xcode שמסוכן
לכתוב ידנית בלי להריץ אותו). תיצור אותן כך:

```bash
# בתיקייה נפרדת וזמנית, לא בתוך תיקיית הפרויקט שקיבלת:
flutter create --org com.shiftapp --project-name shift_app -i swift -a kotlin shift_app_native_tmp

# עכשיו תעתיק את שתי התיקיות האלה מהפרויקט הזמני לתוך הפרויקט שקיבלת ממני:
#   shift_app_native_tmp/android  ->  shift_app/android
#   shift_app_native_tmp/ios      ->  shift_app/ios
# ואז אפשר למחוק את shift_app_native_tmp כולו.
```

## שלב 2: קביעת מזהה החבילה (Bundle ID) — com.shiftapp.mobile

הפקודה למעלה יוצרת ברירת מחדל `com.shiftapp.shift_app_native_tmp`. צריך לתקן
אותה בשני מקומות ל-`com.shiftapp.mobile` המדויק שסיכמנו:

- **Android**: פתח את `android/app/build.gradle`, מצא את השורה
  `applicationId "..."` ושנה ל-`applicationId "com.shiftapp.mobile"`.
- **iOS**: פתח את `ios/Runner.xcworkspace` ב-Xcode → בחר Target "Runner" →
  לשונית General → שדה "Bundle Identifier" → שנה ל-`com.shiftapp.mobile`.

## שלב 3: הקמת מסד הנתונים ב-Supabase (חד פעמי)

היכנס ל-Supabase Dashboard של הפרויקט → SQL Editor → New query → הדבק את
כל התוכן של `supabase/migrations/0001_init.sql` → Run.
זה יוצר את הטבלאות (`profiles`, `renders`), את ה-Storage bucket, ואת כללי
ה-RLS ששומרים שכל משתמש רואה רק את הנתונים שלו.

## שלב 4: הרצה

```bash
cd shift_app
flutter pub get
flutter run
```

אם הכל תקין, האפליקציה תעלה עם מסך "SHIFT" כהה, בורר שפה (עברית/ערבית/רוסית/
אנגלית), וסטטוס "מחובר בהצלחה ל-Supabase" (ירוק) — זה הסימן שהחיבור לשלב 2
עובד מקצה לקצה.

## מה עוד לא בפרויקט (בכוונה)

מסכי המצלמה/העלאה, סטודיו העיצוב עם הצ'יפים, מסך התוצאה, ה-Paywall, מנגנון
ה-Prompt Engineering ומילון החומרים המלא — כל אלה שלבים 3–6 במפת הדרכים, ולא
נכתבו עדיין בכוונה, בהתאם לכלל "פוקוס על MVP" ו"עבודה מודולרית". יתווספו
בהמשך, שלב אחרי שלב.
