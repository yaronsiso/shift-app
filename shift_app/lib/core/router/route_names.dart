/// נתיבי הניווט של זרימת ההדמיה (5 מסכים). קובץ נפרד כדי שכל מסך יוכל
/// להפנות למסך הבא בלי להמתין לעדכון app_router.dart — הראוטר עצמו
/// מחובר בחלק הבא של קוד שלב 6.
class AppRoutes {
  AppRoutes._();

  static const home = '/';
  static const designStudio = '/design-studio';
  static const uploadPhoto = '/upload-photo';
  static const processing = '/processing';
  static const result = '/result';

  /// מסך הזנת קוד קופון (סשן 7) — נגיש מתפריט מסך הבית, לא חלק מזרימת
  /// ההדמיה הליניארית של 5 המסכים למעלה.
  static const coupon = '/coupon';

  /// הגלריה האישית (סשן 9) — כל ההדמיות שהצליחו של המשתמש. נגיש גם
  /// מאייקון בסרגל העליון של מסך הבית וגם מכפתור במסך התוצאה.
  static const gallery = '/gallery';

  /// מסך התחברות/הרשמה/חשבון (סשן 13, המשך) — נגיש מאייקון "החשבון
  /// שלי" בסרגל העליון של מסך הבית. לא הרשמת משתמש "מאפס" — משדרג את
  /// אותו auth.uid() האנונימי הקיים בצירוף טלפון/אימייל (ראו
  /// auth_service.dart), או מתחבר לחשבון קיים אם כבר יש כזה.
  static const auth = '/auth';
}

/// פרמטר אופציונלי למסך העיבוד (AppRoutes.processing), מועבר דרך `extra`
/// של go_router.
///
/// **סשן 9 — מנגנון "חידוש אוטומטי":** כשמסך הבית מגלה (דרך
/// `RenderService.findPendingRender()`) שיש למשתמש הדמיה שנשארה תקועה
/// ב-status='processing' — למשל כי האפליקציה נסגרה/נהרגה ברקע בזמן
/// שהיא עדיין רצה בשרת — הוא מנווט למסך העיבוד עם `ProcessingResumeArgs`
/// שמכיל את ה-renderId הקיים. מסך העיבוד, כשהוא מקבל את זה, **לא שולח
/// בקשה חדשה** (אין קרדיט נוסף, אין תמונה חדשה) — הוא רק ממשיך לעקוב
/// אחרי אותה הדמיה בדיוק עד שהיא מוכנה, בדיוק כאילו לא יצאנו מהמסך
/// מלכתחילה. כשה-`extra` הוא null (הכניסה הרגילה, אחרי לחיצת SHIFT) —
/// המסך שולח בקשה חדשה כרגיל מ-`renderFlowProvider`.
class ProcessingResumeArgs {
  final String renderId;
  const ProcessingResumeArgs({required this.renderId});
}
