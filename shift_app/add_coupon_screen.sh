#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/shift-app/shift_app

mkdir -p lib/features/coupon/data lib/features/coupon/presentation

cat > 'lib/features/coupon/data/coupon_repository.dart' << 'SHIFTEOF'
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../render/data/render_providers.dart';

/// תוצאת קריאה ל-RPC `redeem_coupon(p_code)` (מיגרציה 0003, `claude/17`).
/// שדות ה-`RETURNS TABLE` בשרת, בדיוק כמו שאומתו מול הגדרת הפונקציה
/// בפועל ב-Supabase (סשן 7): `success boolean, reason text,
/// granted_tier text, new_expires_at timestamptz`.
///
/// ערכי `reason` אפשריים: `not_found` · `inactive` · `expired` ·
/// `redemption_limit_reached` · `already_redeemed` · `tracked_only`
/// (success=true, קופון מעקב-בלבד בלי הטבה) · `granted` (success=true,
/// ניתן מנוי — `grantedTier`/`newExpiresAt` תמיד לא-null במקרה הזה).
@immutable
class CouponRedemptionResult {
  final bool success;
  final String reason;
  final String? grantedTier;
  final DateTime? newExpiresAt;

  const CouponRedemptionResult({
    required this.success,
    required this.reason,
    required this.grantedTier,
    required this.newExpiresAt,
  });

  factory CouponRedemptionResult.fromRow(Map<String, dynamic> row) {
    final expiresRaw = row['new_expires_at'] as String?;
    return CouponRedemptionResult(
      success: row['success'] as bool? ?? false,
      reason: row['reason'] as String? ?? 'unknown',
      grantedTier: row['granted_tier'] as String?,
      newExpiresAt: expiresRaw != null ? DateTime.tryParse(expiresRaw) : null,
    );
  }
}

class CouponRepository {
  final SupabaseClient _client;
  const CouponRepository(this._client);

  /// מממש קוד קופון עבור המשתמש המחובר. הפונקציה בשרת אטומית
  /// (`for update` על שורת הקופון) ובודקת בעצמה תוקף/מכסה/כפילות —
  /// האפליקציה רק מציגה את התוצאה שחוזרת.
  Future<CouponRedemptionResult> redeem(String code) async {
    final rows = await _client.rpc('redeem_coupon', params: {'p_code': code});
    final r = (rows is List && rows.isNotEmpty) ? rows.first : rows;
    return CouponRedemptionResult.fromRow(r as Map<String, dynamic>);
  }
}

final couponRepositoryProvider = Provider<CouponRepository>((ref) {
  return CouponRepository(ref.watch(supabaseClientProvider));
});
SHIFTEOF

cat > 'lib/features/coupon/presentation/coupon_screen.dart' << 'SHIFTEOF'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../marquee/data/marquee_repository.dart';
import '../data/coupon_repository.dart';

/// מסך הזנת קוד קופון — נגיש דרך אייקון בתפריט מסך הבית. קורא ל-RPC
/// `redeem_coupon(p_code)` הקיים בשרת מאז מיגרציה 0003 (`claude/17`) —
/// לא נוגע בטבלת `coupons`/`coupon_redemptions` ישירות, בדיוק כמו שאר
/// מסכי הקצה (feedback/marquee) שתמיד עוברים דרך RPC ולא דרך הטבלה.
class CouponScreen extends ConsumerStatefulWidget {
  const CouponScreen({super.key});

  @override
  ConsumerState<CouponScreen> createState() => _CouponScreenState();
}

class _CouponScreenState extends ConsumerState<CouponScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  CouponRedemptionResult? _result;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _controller.text.trim();
    if (code.isEmpty) return;

    setState(() {
      _loading = true;
      _result = null;
      _errorMessage = null;
    });

    try {
      final result = await ref.read(couponRepositoryProvider).redeem(code);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _result = result;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'coupon_screen.error_generic'.tr();
      });
    }
  }

  String _tierLabel(String tier) => switch (tier) {
        'monthly' => 'coupon_screen.tier_monthly'.tr(),
        'annual' => 'coupon_screen.tier_annual'.tr(),
        'annual_premium' => 'coupon_screen.tier_annual_premium'.tr(),
        _ => tier,
      };

  String _reasonMessage(String reason) => switch (reason) {
        'not_found' => 'coupon_screen.error_not_found'.tr(),
        'inactive' => 'coupon_screen.error_inactive'.tr(),
        'expired' => 'coupon_screen.error_expired'.tr(),
        'redemption_limit_reached' => 'coupon_screen.error_limit'.tr(),
        'already_redeemed' => 'coupon_screen.error_already_redeemed'.tr(),
        _ => 'coupon_screen.error_generic'.tr(),
      };

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  @override
  Widget build(BuildContext context) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(title: Text('coupon_screen.app_title'.tr())),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) => MarqueeBar(
                messages: messages.map((m) => m.message).toList(),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'coupon_screen.title'.tr(),
                    style:
                        Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                            ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'coupon_screen.subtitle'.tr(),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _controller,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(
                      hintText: 'coupon_screen.field_hint'.tr(),
                      border: const OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text('coupon_screen.redeem_button'.tr()),
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (_errorMessage != null)
                    _MessageCard(text: _errorMessage!, isSuccess: false),
                  if (_result != null) _buildResultCard(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(BuildContext context) {
    final result = _result!;
    if (!result.success) {
      return _MessageCard(
        text: _reasonMessage(result.reason),
        isSuccess: false,
      );
    }
    if (result.reason == 'granted' &&
        result.grantedTier != null &&
        result.newExpiresAt != null) {
      return _MessageCard(
        title: 'coupon_screen.success_granted_title'.tr(),
        text: 'coupon_screen.success_granted_body'.tr(args: [
          _tierLabel(result.grantedTier!),
          _formatDate(result.newExpiresAt!),
        ]),
        isSuccess: true,
      );
    }
    return _MessageCard(
      text: 'coupon_screen.success_tracked'.tr(),
      isSuccess: true,
    );
  }
}

class _MessageCard extends StatelessWidget {
  final String? title;
  final String text;
  final bool isSuccess;

  const _MessageCard({
    this.title,
    required this.text,
    required this.isSuccess,
  });

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
        color: isSuccess ? palette.accentSoft : color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSuccess ? palette.accentSoftLine : color.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: TextStyle(fontWeight: FontWeight.w800, color: color),
            ),
            const SizedBox(height: 4),
          ],
          Text(text, style: TextStyle(color: color)),
        ],
      ),
    );
  }
}
SHIFTEOF

cat > 'lib/core/router/route_names.dart' << 'SHIFTEOF'
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
}
SHIFTEOF

cat > 'lib/core/router/app_router.dart' << 'SHIFTEOF'
import 'package:go_router/go_router.dart';

import '../../features/coupon/presentation/coupon_screen.dart';
import '../../features/design_studio/presentation/design_studio_screen.dart';
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
    ],
  );
}
SHIFTEOF

cat > 'lib/features/home/presentation/home_screen.dart' << 'SHIFTEOF'
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
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
            icon: const Icon(Icons.confirmation_number_outlined),
            tooltip: 'coupon_screen.entry_tooltip'.tr(),
            onPressed: () => context.push(AppRoutes.coupon),
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
SHIFTEOF

cat > 'assets/translations/he.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "מחובר בהצלחה ל-Supabase",
    "not_connected": "אין חיבור לשרת",
    "placeholder_note": "שלד פרויקט (שלב 2) — מסכי האפליקציה האמיתיים יתווספו בשלבים הבאים"
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
    "eta_note": "יצירת ההדמיה תיקח כ-15 שניות",
    "take_photo": "צלם תמונה",
    "choose_gallery": "בחר מהגלריה",
    "tap_to_pick": "גע כדי לצלם או לבחור מהגלריה",
    "uploaded_ok": "התמונה הועלתה בהצלחה",
    "file_hint": "JPG · PNG · עד 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "יוצרים את ההדמיה שלך",
    "eta_note": "לוקח בערך 15 שניות",
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
  "language": {
    "select": "בחר שפה",
    "he": "עברית",
    "ar": "ערבית",
    "ru": "רוסית",
    "en": "אנגלית"
  }
}
SHIFTEOF

cat > 'assets/translations/en.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Connected to Supabase successfully",
    "not_connected": "No connection to the server",
    "placeholder_note": "Project scaffold (stage 2) — real app screens will be added in later stages"
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
    "eta_note": "Creating the render takes about 15 seconds",
    "take_photo": "Take a photo",
    "choose_gallery": "Choose from gallery",
    "tap_to_pick": "Tap to take a photo or choose from gallery",
    "uploaded_ok": "Photo uploaded successfully",
    "file_hint": "JPG · PNG · up to 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Creating your render",
    "eta_note": "Takes about 15 seconds",
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
  "language": {
    "select": "Select language",
    "he": "Hebrew",
    "ar": "Arabic",
    "ru": "Russian",
    "en": "English"
  }
}
SHIFTEOF

cat > 'assets/translations/ar.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "تم الاتصال بنجاح بـ Supabase",
    "not_connected": "لا يوجد اتصال بالخادم",
    "placeholder_note": "هيكل المشروع (المرحلة 2) — سيتم إضافة شاشات التطبيق الفعلية في المراحل القادمة"
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
    "eta_note": "إنشاء الصورة يستغرق حوالي 15 ثانية",
    "take_photo": "التقط صورة",
    "choose_gallery": "اختر من المعرض",
    "tap_to_pick": "اضغط لالتقاط صورة أو الاختيار من المعرض",
    "uploaded_ok": "تم رفع الصورة بنجاح",
    "file_hint": "JPG · PNG · حتى 15 ميغابايت"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "جارٍ إنشاء التصميم الخاص بك",
    "eta_note": "يستغرق حوالي 15 ثانية",
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
  "language": {
    "select": "اختر اللغة",
    "he": "العبرية",
    "ar": "العربية",
    "ru": "الروسية",
    "en": "الإنجليزية"
  }
}
SHIFTEOF

cat > 'assets/translations/ru.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Успешно подключено к Supabase",
    "not_connected": "Нет подключения к серверу",
    "placeholder_note": "Каркас проекта (этап 2) — реальные экраны приложения будут добавлены на следующих этапах"
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
    "eta_note": "Создание рендера займёт около 15 секунд",
    "take_photo": "Сделать фото",
    "choose_gallery": "Выбрать из галереи",
    "tap_to_pick": "Нажмите, чтобы сделать фото или выбрать из галереи",
    "uploaded_ok": "Фото успешно загружено",
    "file_hint": "JPG · PNG · до 15МБ"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Создаём ваш рендер",
    "eta_note": "Занимает около 15 секунд",
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
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF

echo ""
echo "✅ מסך קוד קופון נוצר וחובר לתפריט מסך הבית."
echo "עכשיו מריצים flutter analyze כדי לוודא שהכל מתקמפל נקי."
