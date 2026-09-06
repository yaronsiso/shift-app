import 'package:supabase_flutter/supabase_flutter.dart';

/// תוצאה של פעולת אימות (שליחת קוד / אימות קוד / התחברות בסיסמה /
/// הגדרת סיסמה / יציאה).
sealed class AuthOutcome {
  const AuthOutcome();
}

class AuthSuccess extends AuthOutcome {
  const AuthSuccess();
}

class AuthFailure extends AuthOutcome {
  final String code;
  final String? detail;
  const AuthFailure(this.code, [this.detail]);

  /// הודעה ידידותית להצגה למשתמש (עברית — כמו שאר האפליקציה).
  String get messageHe => switch (code) {
        'invalid_credentials' => 'מספר הטלפון או הסיסמה שגויים.',
        'invalid_otp' => 'הקוד שהוזן שגוי או שפג תוקפו. אפשר לנסות שוב.',
        'network_error' => 'בעיית תקשורת. בדוק את החיבור לאינטרנט ונסה שוב.',
        _ => 'משהו השתבש. אפשר לנסות שוב.',
      };
}

/// שירות ההתחברות/הרשמה. עוטף את `supabase_flutter` Auth API ומטפל
/// בהבחנה הקריטית בין שתי זרימות שונות לגמרי, בלי שהמשתמש צריך לדעת
/// להבדיל ביניהן בעצמו:
///
/// 1) **שדרוג משתמש אנונימי קיים** (המקרה הרגיל באפליקציה — `main.dart`
///    כבר יצר סשן אנונימי בהתקנה): קוראים ל-`updateUser()` כדי לצרף
///    טלפון/אימייל לאותו `auth.uid()` הקיים. Supabase מבטיחים במפורש
///    ש-`auth.uid()` **לא משתנה** בשדרוג כזה — כלומר כל הקרדיטים,
///    ההדמיות והפרופיל שכבר משויכים למשתמש נשארים בדיוק כמו שהם, בלי
///    צורך בשום מיגרציית נתונים.
/// 2) **התחברות לחשבון קיים** (למשל התקנה חדשה על מכשיר אחר, שיצרה
///    סשן אנונימי חדש משלה): כשהטלפון/אימייל כבר שייכים לחשבון קבוע
///    קיים, `updateUser()` נכשל — ואז עוברים אוטומטית ל-`signInWithOtp()`
///    / `signInWithPassword()`, שמחליפים את הסשן האנונימי בסשן של
///    החשבון הקיים (עם ה-`auth.uid()` וההיסטוריה האמיתיים שלו).
///
/// חשוב: `verifyOTP` דורש סוג שונה (`OtpType`) בכל אחת משתי הזרימות
/// (`phoneChange`/`emailChange` מול `sms`/`email`) — לכן מנסים קודם את
/// הסוג המתאים לשדרוג, ואם הוא נכשל מנסים את הסוג המתאים להתחברות.
class AuthService {
  final SupabaseClient _client;
  AuthService(this._client);

  User? get currentUser => _client.auth.currentUser;

  /// true אם עדיין אין למשתמש הנוכחי זהות קבועה (טלפון/אימייל) מאומתת —
  /// כלומר הוא עדיין בסשן האנונימי שנוצר אוטומטית ב-main.dart.
  bool get isAnonymous => currentUser?.isAnonymous ?? true;

  String? get currentPhone =>
      (currentUser?.phone?.isNotEmpty ?? false) ? currentUser!.phone : null;

  String? get currentEmail =>
      (currentUser?.email?.isNotEmpty ?? false) ? currentUser!.email : null;

  bool _looksLikeAlreadyRegistered(Object e) {
    final s = e.toString().toLowerCase();
    return s.contains('already') &&
        (s.contains('registered') ||
            s.contains('exists') ||
            s.contains('taken') ||
            s.contains('in use'));
  }

  /// שולח קוד אימות SMS לטלפון. מנסה קודם לשדרג את המשתמש האנונימי
  /// הנוכחי; אם הטלפון כבר שייך לחשבון קבוע אחר — עובר אוטומטית
  /// לזרימת התחברות באותו טלפון.
  Future<AuthOutcome> sendPhoneCode(String phone) async {
    try {
      if (isAnonymous) {
        try {
          await _client.auth.updateUser(UserAttributes(phone: phone));
          return const AuthSuccess();
        } on AuthException catch (e) {
          if (!_looksLikeAlreadyRegistered(e)) rethrow;
          // הטלפון כבר שייך לחשבון קיים — ממשיכים לזרימת התחברות למטה.
        }
      }
      await _client.auth.signInWithOtp(phone: phone);
      return const AuthSuccess();
    } on AuthException catch (e) {
      return AuthFailure('auth_error', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  /// מאמת קוד SMS. מנסה קודם `phoneChange` (המשך שדרוג משתמש אנונימי),
  /// ואם זה נכשל מנסה `sms` (המשך זרימת התחברות לחשבון קיים).
  Future<AuthOutcome> verifyPhoneCode(String phone, String token) async {
    try {
      try {
        await _client.auth.verifyOTP(
          type: OtpType.phoneChange,
          phone: phone,
          token: token,
        );
        return const AuthSuccess();
      } on AuthException {
        await _client.auth.verifyOTP(
          type: OtpType.sms,
          phone: phone,
          token: token,
        );
        return const AuthSuccess();
      }
    } on AuthException catch (e) {
      return AuthFailure('invalid_otp', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  /// זהה ל-`sendPhoneCode`/`verifyPhoneCode`, עבור אימייל — **בלי סיסמה
  /// בכלל**: כניסה עם קוד חד-פעמי לתיבת הדוא"ל בלבד, לפי בקשת ירון.
  Future<AuthOutcome> sendEmailCode(String email) async {
    try {
      if (isAnonymous) {
        try {
          await _client.auth.updateUser(UserAttributes(email: email));
          return const AuthSuccess();
        } on AuthException catch (e) {
          if (!_looksLikeAlreadyRegistered(e)) rethrow;
        }
      }
      await _client.auth.signInWithOtp(email: email);
      return const AuthSuccess();
    } on AuthException catch (e) {
      return AuthFailure('auth_error', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  Future<AuthOutcome> verifyEmailCode(String email, String token) async {
    try {
      try {
        await _client.auth.verifyOTP(
          type: OtpType.emailChange,
          email: email,
          token: token,
        );
        return const AuthSuccess();
      } on AuthException {
        await _client.auth.verifyOTP(
          type: OtpType.email,
          email: email,
          token: token,
        );
        return const AuthSuccess();
      }
    } on AuthException catch (e) {
      return AuthFailure('invalid_otp', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  /// התחברות מהירה בלי SMS נוסף — טלפון + סיסמה שהוגדרה מראש
  /// (ראו `setPassword`).
  Future<AuthOutcome> signInWithPhonePassword(
    String phone,
    String password,
  ) async {
    try {
      await _client.auth.signInWithPassword(phone: phone, password: password);
      return const AuthSuccess();
    } on AuthException catch (e) {
      return AuthFailure('invalid_credentials', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  /// הגדרת סיסמה למשתמש המחובר כרגע — שלב אופציונלי אחרי אימות טלפון
  /// בקוד, כדי לאפשר כניסה מהירה בפעם הבאה בלי SMS נוסף. אין מסך מקביל
  /// לאימייל (לפי בקשת ירון: אימייל תמיד בלי סיסמה).
  Future<AuthOutcome> setPassword(String password) async {
    try {
      await _client.auth.updateUser(UserAttributes(password: password));
      return const AuthSuccess();
    } on AuthException catch (e) {
      return AuthFailure('auth_error', e.message);
    } catch (e) {
      return AuthFailure('network_error', e.toString());
    }
  }

  /// יציאה מהחשבון — וחזרה מיידית לסשן אנונימי חדש, כדי שהאפליקציה
  /// תמשיך לעבוד בלי שינוי בשום מסך אחר (כולם מניחים שתמיד יש
  /// `auth.currentUser`, בדיוק כמו מייד אחרי התקנה טרייה).
  Future<void> signOut() async {
    await _client.auth.signOut();
    await _client.auth.signInAnonymously();
  }
}
