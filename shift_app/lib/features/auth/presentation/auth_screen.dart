import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../data/auth_providers.dart';
import '../data/auth_service.dart';

// ⚠️ `easy_localization` (דרך `intl`) מייצא גם הוא סמל בשם `TextDirection`,
// בלי `ltr`/`rtl` — וכשהוא מיובא באותו קובץ עם `flutter/material.dart`,
// הכתיב הרגיל `TextDirection.ltr` נפתר לטיפוס הלא-נכון ונכשל בקומפילציה
// עם "Member not found: 'ltr'" (תועד גם ב-flutter/flutter#128220). לכן
// כאן משתמשים תמיד ב-`ui.TextDirection.ltr` המפורש (מ-`dart:ui`), לא
// בכתיב הקצר.

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
            textDirection: ui.TextDirection.ltr,
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
          textDirection: ui.TextDirection.ltr,
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
          textDirection: ui.TextDirection.ltr,
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
