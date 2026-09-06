#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/shift-app/shift_app

mkdir -p assets/translations lib/core/router lib/features/auth/data lib/features/auth/presentation lib/features/home/presentation

cat > 'lib/features/auth/data/auth_service.dart' << 'SHIFTEOF0'
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
SHIFTEOF0

cat > 'lib/features/auth/data/auth_providers.dart' << 'SHIFTEOF1'
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart' show supabaseClientProvider;
import 'auth_service.dart';

/// שירות ההתחברות/הרשמה — provider כדי שאפשר יהיה להחליף אותו ב-mock
/// בבדיקות בעתיד, בדיוק כמו renderServiceProvider.
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(ref.watch(supabaseClientProvider));
});

/// זרם שינויי מצב ההתחברות (מתעדכן אוטומטית אחרי sendPhoneCode/
/// verifyPhoneCode/signInWithPhonePassword/signOut וכו') — משמש כדי
/// שמסך ההתחברות עצמו (ומסכים אחרים בעתיד) יוכלו להגיב אוטומטית ברגע
/// שהמשתמש כבר לא אנונימי, בלי לדרוש רענון ידני.
final authStateChangesProvider = StreamProvider<AuthState>((ref) {
  final client = ref.watch(supabaseClientProvider);
  return client.auth.onAuthStateChange;
});

/// true אם המשתמש הנוכחי הוא רק סשן אנונימי (עוד לא נרשם/התחבר עם
/// טלפון/אימייל בפועל). תלוי ב-authStateChangesProvider כדי להתעדכן
/// אוטומטית ברגע שההרשמה/ההתחברות/היציאה מסתיימת.
final isAnonymousUserProvider = Provider.autoDispose<bool>((ref) {
  ref.watch(authStateChangesProvider);
  final client = ref.watch(supabaseClientProvider);
  return client.auth.currentUser?.isAnonymous ?? true;
});
SHIFTEOF1

cat > 'lib/features/auth/presentation/auth_screen.dart' << 'SHIFTEOF2'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../data/auth_providers.dart';
import '../data/auth_service.dart';

enum _Channel { phone, email }

/// שלב הזרימה הנוכחי בערוץ הפעיל (טלפון/אימייל).
enum _Step {
  /// מזינים טלפון/אימייל (ובטלפון, אפשר גם לבחור כניסה מהירה עם סיסמה
  /// קיימת במקום לשלוח קוד SMS חדש).
  contact,

  /// הקוד נשלח — ממתינים להזנת קוד האימות.
  code,

  /// הזהות אומתה בהצלחה. עבור טלפון בלבד, מציעים להגדיר סיסמה לכניסה
  /// מהירה בפעם הבאה (רשות — אפשר לדלג).
  setPassword,
}

/// מסך התחברות/הרשמה/חשבון — טלפון (קוד SMS, עם סיסמה אופציונלית
/// לכניסה מהירה בפעם הבאה) ואימייל (קוד חד-פעמי בלבד, בלי סיסמה) —
/// בדיוק לפי בקשת ירון (סשן 13, המשך): "טלפון ואס אם אס סיסמא וגם
/// איימיל בלי סיסמא שיהיה לנו את הכל". התחברות עם רשתות חברתיות
/// (Google/Facebook/Apple) מוצגת כבר בממשק, אבל מנוטרלת ומסומנת
/// בכוכבית — לפי החלטת ירון לדחות את החיבור בפועל לשלב מאוחר יותר
/// ("סמן את זה בכוכבית ונסדר את זה בהמשך").
///
/// **חשוב: זה שדרוג של המשתמש האנונימי הקיים, לא הרשמה "מאפס".**
/// האפליקציה כבר יוצרת סשן אנונימי אוטומטית בכל התקנה (`main.dart`).
/// המסך הזה לא יוצר משתמש חדש — הוא משדרג את אותו משתמש כדי לצרף אליו
/// טלפון/אימייל, כך שכל הקרדיטים/ההדמיות/הפרופיל שכבר שייכים לו
/// נשארים בדיוק כמו שהם. ההבחנה בין "הרשמה" ל"התחברות לחשבון קיים"
/// (למשל התקנה על מכשיר חדש) מטופלת אוטומטית בתוך `AuthService` — יש
/// כאן רק כפתור אחד: "שלח קוד אימות".
class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  _Channel _channel = _Channel.phone;
  _Step _step = _Step.contact;

  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _loginPasswordController = TextEditingController();

  bool _useExistingPassword = false;
  bool _loading = false;
  String? _errorMessage;
  String? _infoMessage;

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    _loginPasswordController.dispose();
    super.dispose();
  }

  AuthService get _service => ref.read(authServiceProvider);

  String get _contactValue => _channel == _Channel.phone
      ? _phoneController.text.trim()
      : _emailController.text.trim();

  void _resetFlow() {
    setState(() {
      _step = _Step.contact;
      _codeController.clear();
      _passwordController.clear();
      _errorMessage = null;
      _infoMessage = null;
    });
  }

  Future<void> _sendCode() async {
    final value = _contactValue;
    if (value.isEmpty) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
      _infoMessage = null;
    });
    final outcome = _channel == _Channel.phone
        ? await _service.sendPhoneCode(value)
        : await _service.sendEmailCode(value);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (outcome is AuthSuccess) {
        _step = _Step.code;
        _infoMessage = 'auth_screen.code_sent_note'.tr();
      } else if (outcome is AuthFailure) {
        _errorMessage = outcome.messageHe;
      }
    });
  }

  Future<void> _verifyCode() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final outcome = _channel == _Channel.phone
        ? await _service.verifyPhoneCode(_phoneController.text.trim(), code)
        : await _service.verifyEmailCode(_emailController.text.trim(), code);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (outcome is AuthSuccess) {
        _errorMessage = null;
        _infoMessage = null;
        // אימייל תמיד בלי סיסמה — רק בטלפון מציעים שלב הגדרת סיסמה.
        _step = _channel == _Channel.phone ? _Step.setPassword : _Step.contact;
      } else if (outcome is AuthFailure) {
        _errorMessage = outcome.messageHe;
      }
    });
  }

  Future<void> _savePassword() async {
    final password = _passwordController.text;
    if (password.length < 6) {
      setState(() => _errorMessage = 'auth_screen.password_too_short'.tr());
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final outcome = await _service.setPassword(password);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (outcome is AuthFailure) {
        _errorMessage = outcome.messageHe;
      } else {
        _step = _Step.contact;
      }
    });
  }

  Future<void> _loginWithPassword() async {
    final phone = _phoneController.text.trim();
    final password = _loginPasswordController.text;
    if (phone.isEmpty || password.isEmpty) return;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final outcome = await _service.signInWithPhonePassword(phone, password);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (outcome is AuthFailure) {
        _errorMessage = outcome.messageHe;
      }
    });
  }

  Future<void> _signOut() async {
    setState(() => _loading = true);
    await _service.signOut();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _phoneController.clear();
      _emailController.clear();
      _loginPasswordController.clear();
      _useExistingPassword = false;
    });
    _resetFlow();
  }

  @override
  Widget build(BuildContext context) {
    // watch כדי שהמסך יתעדכן אוטומטית ברגע שההתחברות/היציאה מסתיימת,
    // בלי לדרוש חזרה ידנית למסך הבית ובחזרה.
    ref.watch(authStateChangesProvider);
    final isAnonymous = ref.watch(isAnonymousUserProvider);

    return Scaffold(
      appBar: AppBar(title: Text('auth_screen.app_title'.tr())),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (!isAnonymous) _buildSignedInView() else _buildSignInFlow(),
          ],
        ),
      ),
    );
  }

  Widget _buildSignedInView() {
    final identity = _service.currentPhone ?? _service.currentEmail ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'auth_screen.signed_in_title'.tr(),
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 6),
        Text(
          'auth_screen.signed_in_body'.tr(args: [identity]),
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: context.palette.inkSoft),
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: _loading ? null : _confirmSignOut,
            child: _loading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text('auth_screen.sign_out_button'.tr()),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmSignOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('auth_screen.sign_out_confirm_title'.tr()),
        content: Text('auth_screen.sign_out_confirm_body'.tr()),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('auth_screen.sign_out_cancel'.tr()),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('auth_screen.sign_out_confirm_yes'.tr()),
          ),
        ],
      ),
    );
    if (confirmed == true) await _signOut();
  }

  Widget _buildSignInFlow() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'auth_screen.title'.tr(),
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 6),
        Text(
          'auth_screen.subtitle'.tr(),
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: context.palette.inkSoft),
        ),
        const SizedBox(height: 20),
        if (_step == _Step.contact) _buildChannelToggle(),
        const SizedBox(height: 16),
        if (_step == _Step.contact) _buildContactStep(),
        if (_step == _Step.code) _buildCodeStep(),
        if (_step == _Step.setPassword) _buildSetPasswordStep(),
        if (_errorMessage != null) ...[
          const SizedBox(height: 16),
          _MessageCard(text: _errorMessage!, isSuccess: false),
        ],
        if (_infoMessage != null && _errorMessage == null) ...[
          const SizedBox(height: 16),
          _MessageCard(text: _infoMessage!, isSuccess: true),
        ],
        const SizedBox(height: 32),
        if (_step == _Step.contact) _buildSocialSection(),
      ],
    );
  }

  Widget _buildChannelToggle() {
    return SegmentedButton<_Channel>(
      segments: [
        ButtonSegment(
          value: _Channel.phone,
          label: Text('auth_screen.channel_phone'.tr()),
          icon: const Icon(Icons.phone_iphone_outlined),
        ),
        ButtonSegment(
          value: _Channel.email,
          label: Text('auth_screen.channel_email'.tr()),
          icon: const Icon(Icons.alternate_email),
        ),
      ],
      selected: {_channel},
      onSelectionChanged: (s) => setState(() {
        _channel = s.first;
        _errorMessage = null;
        _infoMessage = null;
      }),
    );
  }

  Widget _buildContactStep() {
    if (_channel == _Channel.phone) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: 'auth_screen.phone_label'.tr(),
              hintText: 'auth_screen.phone_hint'.tr(),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Checkbox(
                value: _useExistingPassword,
                onChanged: (v) =>
                    setState(() => _useExistingPassword = v ?? false),
              ),
              Expanded(child: Text('auth_screen.have_password_toggle'.tr())),
            ],
          ),
          if (_useExistingPassword) ...[
            TextField(
              controller: _loginPasswordController,
              obscureText: true,
              decoration: InputDecoration(
                labelText: 'auth_screen.password_label'.tr(),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _loading ? null : _loginWithPassword,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text('auth_screen.login_password_button'.tr()),
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                'auth_screen.or_divider'.tr(),
                style: TextStyle(color: context.palette.inkFaint),
              ),
            ),
            const SizedBox(height: 8),
          ] else
            const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _loading ? null : _sendCode,
              child: _loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text('auth_screen.send_code_button'.tr()),
            ),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(
            labelText: 'auth_screen.email_label'.tr(),
            hintText: 'auth_screen.email_hint'.tr(),
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _loading ? null : _sendCode,
            child: _loading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text('auth_screen.send_code_button'.tr()),
          ),
        ),
      ],
    );
  }

  Widget _buildCodeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'auth_screen.code_step_note'.tr(args: [_contactValue]),
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _codeController,
          keyboardType: TextInputType.number,
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(
            labelText: 'auth_screen.code_label'.tr(),
            border: const OutlineInputBorder(),
          ),
          onSubmitted: (_) => _verifyCode(),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _loading ? null : _verifyCode,
            child: _loading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text('auth_screen.verify_button'.tr()),
          ),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(
            onPressed: _loading ? null : _resetFlow,
            child: Text('auth_screen.change_contact_button'.tr()),
          ),
        ),
      ],
    );
  }

  Widget _buildSetPasswordStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'auth_screen.password_step_title'.tr(),
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          'auth_screen.password_step_body'.tr(),
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: context.palette.inkSoft),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _passwordController,
          obscureText: true,
          decoration: InputDecoration(
            labelText: 'auth_screen.new_password_label'.tr(),
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _loading ? null : _savePassword,
            child: _loading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text('auth_screen.save_password_button'.tr()),
          ),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(
            onPressed: _loading
                ? null
                : () => setState(() => _step = _Step.contact),
            child: Text('auth_screen.skip_password_button'.tr()),
          ),
        ),
      ],
    );
  }

  Widget _buildSocialSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Divider(color: context.palette.line)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Text(
                'auth_screen.social_divider'.tr(),
                style: TextStyle(color: context.palette.inkFaint),
              ),
            ),
            Expanded(child: Divider(color: context.palette.line)),
          ],
        ),
        const SizedBox(height: 16),
        _SocialButton(
          icon: Icons.g_mobiledata,
          label: 'auth_screen.social_google'.tr(),
        ),
        const SizedBox(height: 8),
        _SocialButton(
          icon: Icons.facebook,
          label: 'auth_screen.social_facebook'.tr(),
        ),
        const SizedBox(height: 8),
        _SocialButton(
          icon: Icons.apple,
          label: 'auth_screen.social_apple'.tr(),
        ),
        const SizedBox(height: 8),
        Text(
          'auth_screen.social_coming_soon_note'.tr(),
          style: TextStyle(fontSize: 11.5, color: context.palette.inkFaint),
        ),
      ],
    );
  }
}

/// כפתור התחברות עם רשת חברתית — מוצג בממשק אבל **מנוטרל בכוונה**
/// (ומסומן בכוכבית) עד שיחוברו בפועל חשבונות המפתחים של Google/
/// Facebook/Apple. לפי החלטת ירון (סשן 13, המשך) לדחות את זה לשלב
/// מאוחר יותר ולהתמקד קודם בזרימות טלפון+אימייל.
class _SocialButton extends StatelessWidget {
  final IconData icon;
  final String label;
  const _SocialButton({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: null,
        icon: Icon(icon),
        label: Text('$label *'),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  final String text;
  final bool isSuccess;
  const _MessageCard({required this.text, required this.isSuccess});

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final color = isSuccess
        ? Theme.of(context).colorScheme.primary
        : Theme.of(context).colorScheme.error;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isSuccess ? palette.accentSoft : color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSuccess ? palette.accentSoftLine : color.withValues(alpha: 0.3),
        ),
      ),
      child: Text(text, style: TextStyle(color: color)),
    );
  }
}
SHIFTEOF2

cat > 'lib/core/router/route_names.dart' << 'SHIFTEOF3'
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
SHIFTEOF3

cat > 'lib/core/router/app_router.dart' << 'SHIFTEOF4'
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_screen.dart';
import '../../features/coupon/presentation/coupon_screen.dart';
import '../../features/design_studio/presentation/design_studio_screen.dart';
import '../../features/gallery/presentation/gallery_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/processing/presentation/processing_screen.dart';
import '../../features/result/presentation/result_screen.dart';
import '../../features/upload_photo/presentation/upload_photo_screen.dart';
import 'route_names.dart';

/// App-wide navigation graph.
///
/// שלב 6 (סשן 7): הראוטר מחובר סוף-סוף לכל 5 מסכי זרימת ההדמיה —
/// בית → חומרים → העלאת תמונה → עיבוד → תוצאה. כל מסך כבר יודע לנווט
/// הלאה בעצמו (context.push / context.go / context.pushReplacement,
/// לפי AppRoutes ב-route_names.dart) — הראוטר כאן רק ממפה נתיב לווידג'ט.
///
/// מסך התוצאה (5/5) מקבל את RenderResultData דרך `extra` של go_router
/// (מסך העיבוד קורא context.pushReplacement(AppRoutes.result, extra: ...))
/// וקורא אותו בעצמו מ-GoRouterState.of(context).extra בתוך
/// result_screen.dart — אין צורך להעביר אותו כאן דרך ה-builder.
///
/// מסך הבית ה-placeholder (home_placeholder_screen.dart) לא נמחק, רק
/// הפסיק להיות מיובא — נשאר בפרויקט בלי שימוש, אין בזה נזק.
///
/// **סשן 9:** נוסף `AppRoutes.gallery` (הגלריה האישית). מסך העיבוד יכול
/// גם לקבל `ProcessingResumeArgs` דרך `extra` — ראו route_names.dart.
///
/// **סשן 13 (המשך):** נוסף `AppRoutes.auth` (מסך התחברות/הרשמה/חשבון).
class AppRouter {
  AppRouter._();

  static final GoRouter router = GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.designStudio,
        name: 'design-studio',
        builder: (context, state) => const DesignStudioScreen(),
      ),
      GoRoute(
        path: AppRoutes.uploadPhoto,
        name: 'upload-photo',
        builder: (context, state) => const UploadPhotoScreen(),
      ),
      GoRoute(
        path: AppRoutes.processing,
        name: 'processing',
        builder: (context, state) => const ProcessingScreen(),
      ),
      GoRoute(
        path: AppRoutes.result,
        name: 'result',
        builder: (context, state) => const ResultScreen(),
      ),
      GoRoute(
        path: AppRoutes.coupon,
        name: 'coupon',
        builder: (context, state) => const CouponScreen(),
      ),
      GoRoute(
        path: AppRoutes.gallery,
        name: 'gallery',
        builder: (context, state) => const GalleryScreen(),
      ),
      GoRoute(
        path: AppRoutes.auth,
        name: 'auth',
        builder: (context, state) => const AuthScreen(),
      ),
    ],
  );
}
SHIFTEOF4

cat > 'lib/features/home/presentation/home_screen.dart' << 'SHIFTEOF5'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../dictionary/data/category_group.dart';
import '../../dictionary/data/room_types_data.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart' show RenderEligibility;
import '../../render_flow/data/render_flow_notifier.dart';

/// מסך 1/5 — "מה מעצבים היום?". סוג חדר + קטגוריות-על. **אין כאן צילום
/// תמונה** — זה עבר במפורש למסך נפרד (upload_photo_screen, מסך 3) לפי
/// בקשת ירון (סשן 6): "במסך הבית קודם כל קטגוריות... ולאחר שהלקוח בוחר
/// את אותם הקטגוריות צריך להופיע לו צלם תמונה".
///
/// **סשן 9:** הפך מ-`ConsumerWidget` ל-`ConsumerStatefulWidget` כדי
/// שיוכל לבדוק, פעם אחת בכל פעם שהמסך נבנה (כולל פתיחה קרה של
/// האפליקציה), אם למשתמש יש הדמיה שנשארה תקועה ב-processing (למשל כי
/// האפליקציה נסגרה/נהרגה ברקע באמצע) — ואם כן, לחזור אוטומטית למסך
/// העיבוד כדי להמשיך לעקוב אחריה במקום לאבד אותה. גם נוסף אייקון גלריה
/// בסרגל העליון, לצד אייקון הקופון.
///
/// **סשן 10:** נוסף בדיוק אותו רעיון עבור מסכים 1-3 (לפני שההדמיה
/// בכלל נשלחה): אם `RenderFlowNotifier` שיחזר מהדיסק התקדמות שנשארה
/// תקועה (למשל כי המצלמה הרגה את התהליך אחרי בחירת חדר + חומרים —
/// ראו render_flow_notifier.dart), המשתמש מנווט אוטומטית בחזרה למסך
/// הנכון במקום להישאר במסך בית שנראה ריק וגורם לו לחשוב שהכל אבד.
///
/// **סשן 13 (המשך):** נוסף אייקון "החשבון שלי" בסרגל העליון, שמוביל
/// למסך ההתחברות/הרשמה (`AppRoutes.auth`) — ראו auth_screen.dart.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _checkedPendingRender = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkPendingRender());
  }

  Future<void> _checkPendingRender() async {
    if (_checkedPendingRender) return;
    _checkedPendingRender = true;
    try {
      final pending =
          await ref.read(renderServiceProvider).findPendingRender();
      if (pending != null && mounted) {
        context.push(
          AppRoutes.processing,
          extra: ProcessingResumeArgs(renderId: pending.renderId),
        );
        return;
      }
    } catch (_) {
      // לא קריטי — אם הבדיקה נכשלת (למשל רשת), המשתמש פשוט לא יופנה
      // אוטומטית הפעם. ההדמיה עדיין בטוחה בשרת, ותופיע בגלריה שלו כשהיא
      // תסתיים, ותנוסה שוב הבדיקה הזו בפעם הבאה שהוא פותח את מסך הבית.
    }
    // אין הדמיה תקועה בשרת — עכשיו בודקים אם יש התקדמות מקומית (מסכים
    // 1-3, לפני השליחה) ששוחזרה מדיסק ועדיין לא טופלה (סשן 10).
    await _checkRecoveredFlow();
  }

  /// ראו התיעוד המלא ב-`RenderFlowNotifier.consumeColdStartRecovery`.
  Future<void> _checkRecoveredFlow() async {
    final notifier = ref.read(renderFlowProvider.notifier);
    final shouldResume = await notifier.consumeColdStartRecovery();
    if (!shouldResume || !mounted) return;

    final flow = ref.read(renderFlowProvider);
    if (flow.hasSelections) {
      // כבר יש חדר + קבוצות + לפחות פריט אחד נבחר — ממשיכים למסך העלאת
      // התמונה (גם אם כבר יש תמונה שוחזרה, המשתמש עדיין צריך ללחוץ
      // SHIFT בעצמו; לא שולחים הדמיה אוטומטית בלי אישורו).
      context.push(AppRoutes.uploadPhoto);
    } else {
      // יש חדר + קבוצות אבל עוד לא נבחרו פריטים — ממשיכים למסך החומרים.
      context.push(AppRoutes.designStudio);
    }
  }

  @override
  Widget build(BuildContext context) {
    final flow = ref.watch(renderFlowProvider);
    final notifier = ref.read(renderFlowProvider.notifier);
    final eligibility = ref.watch(renderEligibilityProvider);
    final marquee = ref.watch(marqueeMessagesProvider);
    final locale = context.locale.languageCode;

    final roomType = flow.roomTypeCode;
    final availableGroups = roomType == null
        ? kCategoryGroups
        : CategoryGroups.groupsForRoom(roomType);

    return Scaffold(
      appBar: AppBar(
        title: Text('home_screen.app_title'.tr()),
        actions: [
          IconButton(
            icon: const Icon(Icons.photo_library_outlined),
            tooltip: 'gallery_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.gallery),
          ),
          IconButton(
            icon: const Icon(Icons.confirmation_number_outlined),
            tooltip: 'coupon_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.coupon),
          ),
          IconButton(
            icon: const Icon(Icons.person_outline),
            tooltip: 'auth_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.auth),
          ),
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            tooltip: 'language.select'.tr(),
            onSelected: (l) => context.setLocale(l),
            itemBuilder: (context) => context.supportedLocales
                .map(
                  (l) => PopupMenuItem(
                    value: l,
                    child: Text('language.${l.languageCode}'.tr()),
                  ),
                )
                .toList(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) =>
                  MarqueeBar(messages: messages.map((m) => m.message).toList()),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'home_screen.title'.tr(),
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'home_screen.subtitle'.tr(),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                  const SizedBox(height: 16),
                  _CreditPill(eligibility: eligibility),
                  const SizedBox(height: 24),

                  Text(
                    'home_screen.room_section'.tr(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: kRoomTypes.map((r) {
                      final selected = roomType == r.code;
                      return ChoiceChip(
                        label: Text(locale == 'he' ? r.labelHe : r.labelEn),
                        selected: selected,
                        onSelected: (_) => notifier.selectRoomType(r.code),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),

                  Text(
                    'home_screen.groups_section'.tr(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                  ),
                  if (roomType == null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'home_screen.select_room_first'.tr(),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: context.palette.inkFaint,
                          ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Opacity(
                    opacity: roomType == null ? 0.45 : 1.0,
                    child: IgnorePointer(
                      ignoring: roomType == null,
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: availableGroups.map((g) {
                          final selected = flow.selectedGroupCodes.contains(g.code);
                          return FilterChip(
                            label: Text(locale == 'he' ? g.labelHe : g.labelEn),
                            selected: selected,
                            onSelected: (_) => notifier.toggleGroup(g.code),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: flow.hasRoomAndGroups
                          ? () => context.push(AppRoutes.designStudio)
                          : null,
                      child: Text('home_screen.continue_button'.tr()),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CreditPill extends StatelessWidget {
  final AsyncValue<RenderEligibility> eligibility;
  const _CreditPill({required this.eligibility});

  @override
  Widget build(BuildContext context) {
    return eligibility.when(
      data: (e) {
        final String text;
        if (e.subscriptionActive) {
          text = 'home_screen.credits_subscription'.tr(args: ['${e.freeRemaining}']);
        } else if (e.allowed) {
          text = 'home_screen.credits_free'.tr(args: ['${e.freeRemaining}']);
        } else {
          text = 'home_screen.credits_exhausted'.tr();
        }
        return _pill(context, text);
      },
      loading: () => _pill(context, '…'),
      error: (_, __) => const SizedBox.shrink(),
    );
  }

  Widget _pill(BuildContext context, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: context.palette.accentSoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: context.palette.accentSoftLine),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
SHIFTEOF5

cat > 'assets/translations/he.json' << 'SHIFTEOF6'
{
  "home": {
    "title": "SHIFT",
    "connected": "מחובר בהצלחה ל-Supabase",
    "not_connected": "אין חיבור לשרת",
    "placeholder_note": "שלד פרויקט (שלב 2) — מסכי האפליקציה האמיתיים יתווספו בשלבים הבאים"
  },
  "common": {
    "back_to_home_tooltip": "חזרה לדף הבית",
    "account_tooltip": "החשבון שלי"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "מה מעצבים היום?",
    "subtitle": "בחר את סוג החדר ומה תרצה לשנות בו",
    "room_section": "סוג החדר",
    "groups_section": "מה תרצה לעצב?",
    "select_room_first": "קודם בוחרים סוג חדר",
    "continue_button": "המשך לבחירת חומרים",
    "credits_free": "{} הדמיות חינם נותרו",
    "credits_subscription": "מנוי פעיל — {} הדמיות נותרו החודש",
    "credits_exhausted": "המכסה נגמרה"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "בחירת חומרים",
    "no_items": "אין פריטים זמינים בקטגוריה הזו לסוג החדר שנבחר",
    "continue_button": "המשך להעלאת תמונה",
    "note_hint": "הוסף הערה חופשית לבחירה הזו (רשות)",
    "note_field_hint": "לדוגמה: רק על קיר אחד, לא בכל החדר",
    "note_save": "שמירה"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "העלה תמונה שתרצה לעצב",
    "subtitle": "כדי שנוכל להראות לך איך זה נראה אצלך",
    "shift_button": "SHIFT",
    "eta_note": "יצירת ההדמיה תיקח עד כ-20 שניות",
    "take_photo": "צלם תמונה",
    "choose_gallery": "בחר מהגלריה",
    "tap_to_pick": "גע כדי לצלם או לבחור מהגלריה",
    "uploaded_ok": "התמונה הועלתה בהצלחה",
    "file_hint": "JPG · PNG · עד 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "יוצרים את ההדמיה שלך",
    "eta_note": "לוקח בדרך כלל עד כ-20 שניות",
    "leave_ok_note": "אפשר לצאת מהמסך בלי חשש — ההדמיה תמשיך ברקע, ותופיע כאן ובגלריה שלך ברגע שתהיה מוכנה.",
    "resuming_note": "ההדמיה הקודמת שלך עדיין הייתה בעיבוד — ממשיכים לעקוב אחריה בדיוק מאיפה שהפסקנו.",
    "still_working_title": "עדיין עובדים על זה",
    "still_working_body": "זה לוקח קצת יותר זמן מהרגיל, אבל שום דבר לא אבד. אפשר לחזור למסך הבית — ההדמיה תופיע שם אוטומטית ברגע שתהיה מוכנה, וגם בגלריה שלך.",
    "still_working_wait_button": "להמשיך להמתין",
    "quota_title": "נגמרה המכסה",
    "quota_body": "אין לך כרגע הדמיות זמינות. אפשר לשדרג למנוי כדי להמשיך.",
    "quota_button": "חזרה למסך הבית",
    "error_title": "משהו השתבש",
    "retry_button": "נסה שוב",
    "back_button": "חזרה"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "ההדמיה שלך מוכנה!",
    "before_label": "לפני",
    "after_label": "אחרי",
    "save_button": "שמירה ב-HD",
    "share_button": "שיתוף בוואטסאפ",
    "design_again_button": "עיצוב נוסף לחדר הזה",
    "view_gallery_button": "לצפייה בכל ההדמיות שלי",
    "image_error": "לא הצלחנו לטעון את התמונה",
    "retry_button": "נסה שוב",
    "share_error": "לא הצלחנו לשתף את התמונה",
    "rating_title": "איך היה?",
    "rating_hint": "ספר לנו עוד (רשות)",
    "rating_submit": "שליחה",
    "rating_thanks": "תודה על המשוב!",
    "milestone_q1": "מה דעתך על האפליקציה והשימוש שלך עד כה?",
    "milestone_very_good": "טוב מאוד",
    "milestone_ok": "בסדר",
    "milestone_not_great": "לא משהו",
    "milestone_q2": "האם היו חסרים לך אלמנטים מסוימים?",
    "milestone_yes": "כן",
    "milestone_no": "לא",
    "milestone_missing_hint": "נשמח לעדכן את המערכת — מה חסר לך?",
    "milestone_send": "שליחה"
  },
  "coupon_screen": {
    "app_title": "קוד קופון",
    "title": "יש לך קוד קופון?",
    "subtitle": "הזן את הקוד שקיבלת ותראה מיד אם הוא בתוקף",
    "field_hint": "לדוגמה: DANI-GIFT-1M",
    "redeem_button": "מימוש הקוד",
    "success_granted_title": "מזל טוב!",
    "success_granted_body": "הקוד מומש בהצלחה. המנוי שלך ({}) בתוקף עד {}.",
    "success_tracked": "הקוד נרשם בהצלחה, תודה!",
    "error_not_found": "קוד קופון לא נמצא. בדוק שהקלדת נכון ונסה שוב.",
    "error_inactive": "קוד הקופון הזה כבר לא פעיל.",
    "error_expired": "תוקף הקוד הזה פג.",
    "error_limit": "הקוד הזה כבר מוצה במלואו.",
    "error_already_redeemed": "כבר מימשת את הקוד הזה בעבר.",
    "error_generic": "קרה משהו לא צפוי. אפשר לנסות שוב.",
    "tier_monthly": "חודשי",
    "tier_annual": "שנתי",
    "tier_annual_premium": "שנתי פרימיום",
    "entry_tooltip": "יש לי קוד קופון"
  },
  "gallery_screen": {
    "app_title": "הגלריה שלי",
    "entry_tooltip": "הגלריה שלי",
    "empty_title": "עדיין אין כאן כלום",
    "empty_body": "כל הדמיה שתיצור תישמר כאן אוטומטית, כדי שתוכל לחזור אליה בכל זמן.",
    "load_error": "לא הצלחנו לטעון את הגלריה",
    "retry_button": "נסה שוב",
    "share_button": "שיתוף",
    "delete_button": "מחיקה",
    "delete_confirm_title": "למחוק את התמונה?",
    "delete_confirm_body": "הפעולה לא הפיכה — התמונה תימחק לצמיתות מהגלריה שלך.",
    "delete_confirm_yes": "מחיקה",
    "delete_confirm_cancel": "ביטול",
    "delete_error": "המחיקה נכשלה, נסה שוב"
  },
  "auth_screen": {
    "app_title": "התחברות",
    "entry_tooltip": "התחברות / החשבון שלי",
    "title": "התחברות / הרשמה",
    "subtitle": "התחבר כדי לשמור את הקרדיטים וההדמיות שלך גם אם תחליף מכשיר",
    "channel_phone": "טלפון",
    "channel_email": "אימייל",
    "phone_label": "מספר טלפון",
    "phone_hint": "05XXXXXXXX",
    "email_label": "כתובת אימייל",
    "email_hint": "name@example.com",
    "have_password_toggle": "יש לי כבר סיסמה (התחברות מהירה בלי קוד)",
    "password_label": "סיסמה",
    "login_password_button": "התחברות עם סיסמה",
    "or_divider": "או",
    "send_code_button": "שלח קוד אימות",
    "code_sent_note": "הקוד נשלח בהצלחה",
    "code_step_note": "שלחנו קוד אימות אל {}",
    "code_label": "קוד אימות",
    "verify_button": "אימות הקוד",
    "change_contact_button": "שינוי מספר/אימייל",
    "password_step_title": "הגדרת סיסמה (רשות)",
    "password_step_body": "כדי שתוכל להתחבר בפעם הבאה בלי לחכות לקוד SMS, אפשר להגדיר סיסמה עכשיו. אפשר גם לדלג ולעשות זאת מאוחר יותר.",
    "new_password_label": "סיסמה חדשה",
    "save_password_button": "שמירת סיסמה",
    "skip_password_button": "דלג לעכשיו",
    "password_too_short": "הסיסמה צריכה לפחות 6 תווים",
    "signed_in_title": "מחובר בהצלחה",
    "signed_in_body": "מחובר בתור {}",
    "sign_out_button": "התנתקות",
    "sign_out_confirm_title": "להתנתק?",
    "sign_out_confirm_body": "תוכל תמיד להתחבר שוב עם אותו טלפון/אימייל.",
    "sign_out_cancel": "ביטול",
    "sign_out_confirm_yes": "התנתקות",
    "social_divider": "או המשך עם",
    "social_google": "התחברות עם Google",
    "social_facebook": "התחברות עם Facebook",
    "social_apple": "התחברות עם Apple",
    "social_coming_soon_note": "* התחברות עם רשתות חברתיות תתווסף בקרוב"
  },
  "language": {
    "select": "בחר שפה",
    "he": "עברית",
    "ar": "ערבית",
    "ru": "רוסית",
    "en": "אנגלית"
  }
}
SHIFTEOF6

cat > 'assets/translations/en.json' << 'SHIFTEOF7'
{
  "home": {
    "title": "SHIFT",
    "connected": "Connected to Supabase successfully",
    "not_connected": "No connection to the server",
    "placeholder_note": "Project scaffold (stage 2) — real app screens will be added in later stages"
  },
  "common": {
    "back_to_home_tooltip": "Back to home",
    "account_tooltip": "My account"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "What are we designing today?",
    "subtitle": "Choose the room type and what you'd like to change",
    "room_section": "Room type",
    "groups_section": "What would you like to design?",
    "select_room_first": "Choose a room type first",
    "continue_button": "Continue to materials",
    "credits_free": "{} free renders left",
    "credits_subscription": "Active subscription — {} renders left this month",
    "credits_exhausted": "You've used your quota"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "Choose materials",
    "no_items": "No items available in this category for the selected room",
    "continue_button": "Continue to upload photo",
    "note_hint": "Add an optional note for this choice",
    "note_field_hint": "e.g. only on one wall, not the whole room",
    "note_save": "Save"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "Upload a photo to design",
    "subtitle": "So we can show you what it looks like at your place",
    "shift_button": "SHIFT",
    "eta_note": "Creating the render takes up to about 20 seconds",
    "take_photo": "Take a photo",
    "choose_gallery": "Choose from gallery",
    "tap_to_pick": "Tap to take a photo or choose from gallery",
    "uploaded_ok": "Photo uploaded successfully",
    "file_hint": "JPG · PNG · up to 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Creating your render",
    "eta_note": "Usually takes up to about 20 seconds",
    "leave_ok_note": "It's fine to leave this screen — your render keeps going in the background, and will show up here and in your gallery as soon as it's ready.",
    "resuming_note": "Your previous render was still processing — picking up right where we left off.",
    "still_working_title": "Still working on it",
    "still_working_body": "This is taking a bit longer than usual, but nothing was lost. You can go back to the home screen — your render will appear there automatically once it's ready, and in your gallery too.",
    "still_working_wait_button": "Keep waiting",
    "quota_title": "You've used your quota",
    "quota_body": "You don't have any renders available right now. You can upgrade to a subscription to continue.",
    "quota_button": "Back to home",
    "error_title": "Something went wrong",
    "retry_button": "Try again",
    "back_button": "Back"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "Your design is ready!",
    "before_label": "Before",
    "after_label": "After",
    "save_button": "Save HD",
    "share_button": "Share on WhatsApp",
    "design_again_button": "Design another for this room",
    "view_gallery_button": "View all my renders",
    "image_error": "We couldn't load the image",
    "retry_button": "Try again",
    "share_error": "We couldn't share the image",
    "rating_title": "How was it?",
    "rating_hint": "Tell us more (optional)",
    "rating_submit": "Submit",
    "rating_thanks": "Thanks for the feedback!",
    "milestone_q1": "What do you think of the app and your experience so far?",
    "milestone_very_good": "Very good",
    "milestone_ok": "OK",
    "milestone_not_great": "Not great",
    "milestone_q2": "Was anything missing?",
    "milestone_yes": "Yes",
    "milestone_no": "No",
    "milestone_missing_hint": "We'd love to know — what's missing?",
    "milestone_send": "Send"
  },
  "coupon_screen": {
    "app_title": "Coupon Code",
    "title": "Have a coupon code?",
    "subtitle": "Enter your code below to see if it's valid",
    "field_hint": "e.g. DANI-GIFT-1M",
    "redeem_button": "Redeem code",
    "success_granted_title": "Congratulations!",
    "success_granted_body": "Your code was redeemed successfully. Your {} subscription is active until {}.",
    "success_tracked": "Your code was recorded — thank you!",
    "error_not_found": "Coupon code not found. Check the spelling and try again.",
    "error_inactive": "This coupon code is no longer active.",
    "error_expired": "This coupon code has expired.",
    "error_limit": "This coupon code has already been fully used.",
    "error_already_redeemed": "You've already redeemed this code.",
    "error_generic": "Something went wrong. Please try again.",
    "tier_monthly": "Monthly",
    "tier_annual": "Annual",
    "tier_annual_premium": "Annual Premium",
    "entry_tooltip": "I have a coupon code"
  },
  "gallery_screen": {
    "app_title": "My Gallery",
    "entry_tooltip": "My gallery",
    "empty_title": "Nothing here yet",
    "empty_body": "Every render you create is saved here automatically, so you can come back to it anytime.",
    "load_error": "We couldn't load your gallery",
    "retry_button": "Try again",
    "share_button": "Share",
    "delete_button": "Delete",
    "delete_confirm_title": "Delete this image?",
    "delete_confirm_body": "This can't be undone — the image will be permanently deleted from your gallery.",
    "delete_confirm_yes": "Delete",
    "delete_confirm_cancel": "Cancel",
    "delete_error": "Delete failed, please try again"
  },
  "auth_screen": {
    "app_title": "Sign in",
    "entry_tooltip": "Sign in / My account",
    "title": "Sign in / Sign up",
    "subtitle": "Sign in to keep your credits and renders even if you switch devices",
    "channel_phone": "Phone",
    "channel_email": "Email",
    "phone_label": "Phone number",
    "phone_hint": "05XXXXXXXX",
    "email_label": "Email address",
    "email_hint": "name@example.com",
    "have_password_toggle": "I already have a password (quick sign-in, no code)",
    "password_label": "Password",
    "login_password_button": "Sign in with password",
    "or_divider": "or",
    "send_code_button": "Send verification code",
    "code_sent_note": "Code sent successfully",
    "code_step_note": "We sent a verification code to {}",
    "code_label": "Verification code",
    "verify_button": "Verify code",
    "change_contact_button": "Change phone/email",
    "password_step_title": "Set a password (optional)",
    "password_step_body": "So you can sign in next time without waiting for an SMS code, you can set a password now. You can also skip and do this later.",
    "new_password_label": "New password",
    "save_password_button": "Save password",
    "skip_password_button": "Skip for now",
    "password_too_short": "Password must be at least 6 characters",
    "signed_in_title": "Signed in successfully",
    "signed_in_body": "Signed in as {}",
    "sign_out_button": "Sign out",
    "sign_out_confirm_title": "Sign out?",
    "sign_out_confirm_body": "You can always sign back in with the same phone/email.",
    "sign_out_cancel": "Cancel",
    "sign_out_confirm_yes": "Sign out",
    "social_divider": "or continue with",
    "social_google": "Sign in with Google",
    "social_facebook": "Sign in with Facebook",
    "social_apple": "Sign in with Apple",
    "social_coming_soon_note": "* Social sign-in is coming soon"
  },
  "language": {
    "select": "Select language",
    "he": "Hebrew",
    "ar": "Arabic",
    "ru": "Russian",
    "en": "English"
  }
}
SHIFTEOF7

cat > 'assets/translations/ru.json' << 'SHIFTEOF8'
{
  "home": {
    "title": "SHIFT",
    "connected": "Успешно подключено к Supabase",
    "not_connected": "Нет подключения к серверу",
    "placeholder_note": "Каркас проекта (этап 2) — реальные экраны приложения будут добавлены на следующих этапах"
  },
  "common": {
    "back_to_home_tooltip": "На главную",
    "account_tooltip": "Мой аккаунт"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "Что оформляем сегодня?",
    "subtitle": "Выберите тип комнаты и что хотите изменить",
    "room_section": "Тип комнаты",
    "groups_section": "Что вы хотите изменить?",
    "select_room_first": "Сначала выберите тип комнаты",
    "continue_button": "Далее к выбору материалов",
    "credits_free": "Осталось бесплатных рендеров: {}",
    "credits_subscription": "Активная подписка — осталось {} в этом месяце",
    "credits_exhausted": "Лимит исчерпан"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "Выбор материалов",
    "no_items": "Нет доступных вариантов в этой категории для выбранной комнаты",
    "continue_button": "Далее к загрузке фото",
    "note_hint": "Добавьте необязательное примечание к этому выбору",
    "note_field_hint": "например: только на одной стене, не по всей комнате",
    "note_save": "Сохранить"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "Загрузите фото для дизайна",
    "subtitle": "Чтобы мы могли показать, как это будет выглядеть у вас",
    "shift_button": "SHIFT",
    "eta_note": "Создание рендера может занять до 20 секунд",
    "take_photo": "Сделать фото",
    "choose_gallery": "Выбрать из галереи",
    "tap_to_pick": "Нажмите, чтобы сделать фото или выбрать из галереи",
    "uploaded_ok": "Фото успешно загружено",
    "file_hint": "JPG · PNG · до 15МБ"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Создаём ваш рендер",
    "eta_note": "Обычно занимает до 20 секунд",
    "leave_ok_note": "Можно спокойно покинуть этот экран — рендер продолжит создаваться в фоне и появится здесь и в вашей галерее, как только будет готов.",
    "resuming_note": "Ваш предыдущий рендер всё ещё обрабатывался — продолжаем следить за ним с того же места.",
    "still_working_title": "Всё ещё работаем над этим",
    "still_working_body": "Это занимает немного больше времени, чем обычно, но ничего не потеряно. Можно вернуться на главный экран — рендер появится там автоматически, как только будет готов, а также в вашей галерее.",
    "still_working_wait_button": "Продолжить ждать",
    "quota_title": "Лимит исчерпан",
    "quota_body": "Сейчас у вас нет доступных рендеров. Вы можете оформить подписку, чтобы продолжить.",
    "quota_button": "На главный экран",
    "error_title": "Что-то пошло не так",
    "retry_button": "Попробовать снова",
    "back_button": "Назад"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "Ваш дизайн готов!",
    "before_label": "До",
    "after_label": "После",
    "save_button": "Сохранить в HD",
    "share_button": "Поделиться в WhatsApp",
    "design_again_button": "Ещё один дизайн для этой комнаты",
    "view_gallery_button": "Смотреть все мои рендеры",
    "image_error": "Не удалось загрузить изображение",
    "retry_button": "Попробовать снова",
    "share_error": "Не удалось поделиться изображением",
    "rating_title": "Как вам?",
    "rating_hint": "Расскажите подробнее (необязательно)",
    "rating_submit": "Отправить",
    "rating_thanks": "Спасибо за отзыв!",
    "milestone_q1": "Что вы думаете о приложении и своём опыте использования?",
    "milestone_very_good": "Очень хорошо",
    "milestone_ok": "Нормально",
    "milestone_not_great": "Не очень",
    "milestone_q2": "Чего-то не хватало?",
    "milestone_yes": "Да",
    "milestone_no": "Нет",
    "milestone_missing_hint": "Мы хотим улучшить систему — чего вам не хватает?",
    "milestone_send": "Отправить"
  },
  "coupon_screen": {
    "app_title": "Промокод",
    "title": "Есть промокод?",
    "subtitle": "Введите код, чтобы проверить, действителен ли он",
    "field_hint": "Например: DANI-GIFT-1M",
    "redeem_button": "Активировать код",
    "success_granted_title": "Поздравляем!",
    "success_granted_body": "Код успешно активирован. Ваша подписка ({}) действует до {}.",
    "success_tracked": "Код успешно зарегистрирован, спасибо!",
    "error_not_found": "Промокод не найден. Проверьте правильность ввода и попробуйте снова.",
    "error_inactive": "Этот промокод больше не активен.",
    "error_expired": "Срок действия этого кода истёк.",
    "error_limit": "Этот код уже полностью использован.",
    "error_already_redeemed": "Вы уже использовали этот код.",
    "error_generic": "Произошла непредвиденная ошибка. Попробуйте снова.",
    "tier_monthly": "Ежемесячная",
    "tier_annual": "Годовая",
    "tier_annual_premium": "Годовая Премиум",
    "entry_tooltip": "У меня есть промокод"
  },
  "gallery_screen": {
    "app_title": "Моя галерея",
    "entry_tooltip": "Моя галерея",
    "empty_title": "Здесь пока пусто",
    "empty_body": "Каждый созданный вами рендер сохраняется здесь автоматически, чтобы вы могли вернуться к нему в любое время.",
    "load_error": "Не удалось загрузить галерею",
    "retry_button": "Попробовать снова",
    "share_button": "Поделиться",
    "delete_button": "Удалить",
    "delete_confirm_title": "Удалить это изображение?",
    "delete_confirm_body": "Это действие необратимо — изображение будет удалено из вашей галереи навсегда.",
    "delete_confirm_yes": "Удалить",
    "delete_confirm_cancel": "Отмена",
    "delete_error": "Не удалось удалить, попробуйте снова"
  },
  "auth_screen": {
    "app_title": "Вход",
    "entry_tooltip": "Вход / Мой аккаунт",
    "title": "Вход / Регистрация",
    "subtitle": "Войдите, чтобы сохранить кредиты и рендеры даже при смене устройства",
    "channel_phone": "Телефон",
    "channel_email": "Email",
    "phone_label": "Номер телефона",
    "phone_hint": "05XXXXXXXX",
    "email_label": "Адрес электронной почты",
    "email_hint": "name@example.com",
    "have_password_toggle": "У меня уже есть пароль (быстрый вход без кода)",
    "password_label": "Пароль",
    "login_password_button": "Войти с паролем",
    "or_divider": "или",
    "send_code_button": "Отправить код подтверждения",
    "code_sent_note": "Код успешно отправлен",
    "code_step_note": "Мы отправили код подтверждения на {}",
    "code_label": "Код подтверждения",
    "verify_button": "Подтвердить код",
    "change_contact_button": "Изменить телефон/email",
    "password_step_title": "Установить пароль (необязательно)",
    "password_step_body": "Чтобы в следующий раз войти без ожидания SMS-кода, можно установить пароль сейчас. Можно также пропустить и сделать это позже.",
    "new_password_label": "Новый пароль",
    "save_password_button": "Сохранить пароль",
    "skip_password_button": "Пропустить",
    "password_too_short": "Пароль должен содержать не менее 6 символов",
    "signed_in_title": "Вход выполнен успешно",
    "signed_in_body": "Вы вошли как {}",
    "sign_out_button": "Выйти",
    "sign_out_confirm_title": "Выйти из аккаунта?",
    "sign_out_confirm_body": "Вы всегда сможете снова войти с тем же телефоном/email.",
    "sign_out_cancel": "Отмена",
    "sign_out_confirm_yes": "Выйти",
    "social_divider": "или продолжить с",
    "social_google": "Войти через Google",
    "social_facebook": "Войти через Facebook",
    "social_apple": "Войти через Apple",
    "social_coming_soon_note": "* Вход через соцсети появится позже"
  },
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF8

cat > 'assets/translations/ar.json' << 'SHIFTEOF9'
{
  "home": {
    "title": "SHIFT",
    "connected": "تم الاتصال بنجاح بـ Supabase",
    "not_connected": "لا يوجد اتصال بالخادم",
    "placeholder_note": "هيكل المشروع (المرحلة 2) — سيتم إضافة شاشات التطبيق الفعلية في المراحل القادمة"
  },
  "common": {
    "back_to_home_tooltip": "العودة للصفحة الرئيسية",
    "account_tooltip": "حسابي"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "ماذا نصمم اليوم؟",
    "subtitle": "اختر نوع الغرفة وما تريد تغييره فيها",
    "room_section": "نوع الغرفة",
    "groups_section": "ماذا تريد أن تصمم؟",
    "select_room_first": "اختر نوع الغرفة أولاً",
    "continue_button": "متابعة لاختيار المواد",
    "credits_free": "{} صور مجانية متبقية",
    "credits_subscription": "اشتراك نشط — {} صور متبقية هذا الشهر",
    "credits_exhausted": "لقد استنفدت حصتك"
  },
  "design_studio_screen": {
    "app_title": "SHIFT",
    "title": "اختيار المواد",
    "no_items": "لا توجد عناصر متاحة في هذه الفئة لنوع الغرفة المختار",
    "continue_button": "متابعة لرفع الصورة",
    "note_hint": "أضف ملاحظة اختيارية لهذا الاختيار",
    "note_field_hint": "مثال: فقط على جدار واحد، وليس الغرفة كلها",
    "note_save": "حفظ"
  },
  "upload_photo_screen": {
    "app_title": "SHIFT",
    "title": "ارفع صورة تريد تصميمها",
    "subtitle": "حتى نتمكن من إظهار كيف سيبدو الأمر عندك",
    "shift_button": "SHIFT",
    "eta_note": "إنشاء الصورة قد يستغرق حتى 20 ثانية",
    "take_photo": "التقط صورة",
    "choose_gallery": "اختر من المعرض",
    "tap_to_pick": "اضغط لالتقاط صورة أو الاختيار من المعرض",
    "uploaded_ok": "تم رفع الصورة بنجاح",
    "file_hint": "JPG · PNG · حتى 15 ميغابايت"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "جارٍ إنشاء التصميم الخاص بك",
    "eta_note": "يستغرق عادةً حتى 20 ثانية",
    "leave_ok_note": "يمكنك مغادرة هذه الشاشة بلا قلق — التصميم يستمر في الخلفية، وسيظهر هنا وفي معرضك بمجرد أن يكون جاهزاً.",
    "resuming_note": "تصميمك السابق كان لا يزال قيد المعالجة — نواصل متابعته من حيث توقفنا بالضبط.",
    "still_working_title": "لا زلنا نعمل على ذلك",
    "still_working_body": "هذا يستغرق وقتاً أطول قليلاً من المعتاد، لكن لم يُفقد شيء. يمكنك العودة للشاشة الرئيسية — سيظهر التصميم هناك تلقائياً بمجرد جاهزيته، وأيضاً في معرضك.",
    "still_working_wait_button": "الاستمرار بالانتظار",
    "quota_title": "لقد استنفدت حصتك",
    "quota_body": "لا توجد لديك صور متاحة حالياً. يمكنك الترقية إلى اشتراك للمتابعة.",
    "quota_button": "العودة للشاشة الرئيسية",
    "error_title": "حدث خطأ ما",
    "retry_button": "حاول مرة أخرى",
    "back_button": "رجوع"
  },
  "result_screen": {
    "app_title": "SHIFT",
    "title": "تصميمك جاهز!",
    "before_label": "قبل",
    "after_label": "بعد",
    "save_button": "حفظ بجودة HD",
    "share_button": "مشاركة عبر واتساب",
    "design_again_button": "تصميم آخر لهذه الغرفة",
    "view_gallery_button": "عرض كل تصاميمي",
    "image_error": "تعذّر تحميل الصورة",
    "retry_button": "حاول مرة أخرى",
    "share_error": "تعذّرت مشاركة الصورة",
    "rating_title": "كيف كانت التجربة؟",
    "rating_hint": "أخبرنا المزيد (اختياري)",
    "rating_submit": "إرسال",
    "rating_thanks": "شكراً على ملاحظاتك!",
    "milestone_q1": "ما رأيك في التطبيق وتجربتك حتى الآن؟",
    "milestone_very_good": "جيد جداً",
    "milestone_ok": "جيد",
    "milestone_not_great": "ليس رائعاً",
    "milestone_q2": "هل كان هناك عناصر ناقصة؟",
    "milestone_yes": "نعم",
    "milestone_no": "لا",
    "milestone_missing_hint": "يسعدنا تحديث النظام — ما الذي ينقصك؟",
    "milestone_send": "إرسال"
  },
  "coupon_screen": {
    "app_title": "رمز الكوبون",
    "title": "هل لديك رمز كوبون؟",
    "subtitle": "أدخل الرمز الذي حصلت عليه لترى إذا كان صالحاً",
    "field_hint": "مثال: DANI-GIFT-1M",
    "redeem_button": "استخدام الرمز",
    "success_granted_title": "مبروك!",
    "success_granted_body": "تم استخدام الرمز بنجاح. اشتراكك ({}) ساري حتى {}.",
    "success_tracked": "تم تسجيل الرمز بنجاح، شكراً لك!",
    "error_not_found": "رمز الكوبون غير موجود. تحقق من الإدخال وحاول مرة أخرى.",
    "error_inactive": "رمز الكوبون هذا لم يعد نشطاً.",
    "error_expired": "انتهت صلاحية هذا الرمز.",
    "error_limit": "تم استخدام هذا الرمز بالكامل بالفعل.",
    "error_already_redeemed": "لقد استخدمت هذا الرمز من قبل.",
    "error_generic": "حدث خطأ غير متوقع. حاول مرة أخرى.",
    "tier_monthly": "شهري",
    "tier_annual": "سنوي",
    "tier_annual_premium": "سنوي مميز",
    "entry_tooltip": "لدي رمز كوبون"
  },
  "gallery_screen": {
    "app_title": "معرضي",
    "entry_tooltip": "معرضي",
    "empty_title": "لا يوجد شيء هنا بعد",
    "empty_body": "كل تصميم تنشئه يُحفظ هنا تلقائياً، حتى تتمكن من العودة إليه في أي وقت.",
    "load_error": "تعذّر تحميل المعرض",
    "retry_button": "حاول مرة أخرى",
    "share_button": "مشاركة",
    "delete_button": "حذف",
    "delete_confirm_title": "حذف هذه الصورة؟",
    "delete_confirm_body": "لا يمكن التراجع عن هذا — ستُحذف الصورة نهائياً من معرضك.",
    "delete_confirm_yes": "حذف",
    "delete_confirm_cancel": "إلغاء",
    "delete_error": "فشل الحذف، حاول مرة أخرى"
  },
  "auth_screen": {
    "app_title": "تسجيل الدخول",
    "entry_tooltip": "تسجيل الدخول / حسابي",
    "title": "تسجيل الدخول / إنشاء حساب",
    "subtitle": "سجّل الدخول للحفاظ على رصيدك وتصاميمك حتى لو غيّرت الجهاز",
    "channel_phone": "الهاتف",
    "channel_email": "البريد الإلكتروني",
    "phone_label": "رقم الهاتف",
    "phone_hint": "05XXXXXXXX",
    "email_label": "البريد الإلكتروني",
    "email_hint": "name@example.com",
    "have_password_toggle": "لدي كلمة مرور بالفعل (تسجيل دخول سريع بدون رمز)",
    "password_label": "كلمة المرور",
    "login_password_button": "تسجيل الدخول بكلمة المرور",
    "or_divider": "أو",
    "send_code_button": "إرسال رمز التحقق",
    "code_sent_note": "تم إرسال الرمز بنجاح",
    "code_step_note": "أرسلنا رمز تحقق إلى {}",
    "code_label": "رمز التحقق",
    "verify_button": "تأكيد الرمز",
    "change_contact_button": "تغيير الهاتف/البريد الإلكتروني",
    "password_step_title": "تعيين كلمة مرور (اختياري)",
    "password_step_body": "حتى تتمكن من تسجيل الدخول في المرة القادمة دون انتظار رمز SMS، يمكنك تعيين كلمة مرور الآن. يمكنك أيضاً التخطي وفعل ذلك لاحقاً.",
    "new_password_label": "كلمة مرور جديدة",
    "save_password_button": "حفظ كلمة المرور",
    "skip_password_button": "تخطي الآن",
    "password_too_short": "يجب أن تتكون كلمة المرور من 6 أحرف على الأقل",
    "signed_in_title": "تم تسجيل الدخول بنجاح",
    "signed_in_body": "مسجل الدخول باسم {}",
    "sign_out_button": "تسجيل الخروج",
    "sign_out_confirm_title": "تسجيل الخروج؟",
    "sign_out_confirm_body": "يمكنك دائماً تسجيل الدخول مرة أخرى بنفس الهاتف/البريد الإلكتروني.",
    "sign_out_cancel": "إلغاء",
    "sign_out_confirm_yes": "تسجيل الخروج",
    "social_divider": "أو تابع باستخدام",
    "social_google": "تسجيل الدخول عبر Google",
    "social_facebook": "تسجيل الدخول عبر Facebook",
    "social_apple": "تسجيل الدخول عبر Apple",
    "social_coming_soon_note": "* سيتم إضافة تسجيل الدخول عبر مواقع التواصل قريباً"
  },
  "language": {
    "select": "اختر اللغة",
    "he": "العبرية",
    "ar": "العربية",
    "ru": "الروسية",
    "en": "الإنجليزية"
  }
}
SHIFTEOF9

echo ""
echo "✅ מסכי התחברות/הרשמה (טלפון+SMS+סיסמה אופציונלית, אימייל בלי סיסמה) נוצרו וחוברו: ראוטר, מסך הבית (אייקון חשבון), תרגומים ל-4 שפות. התחברות עם רשתות חברתיות מוצגת בממשק אבל מנוטרלת בכוונה (\"*\", בקרוב)."
echo "עכשיו מריצים flutter analyze כדי לוודא שהכל מתקמפל נקי, ואז flutter build apk --debug."
