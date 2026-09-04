#!/usr/bin/env bash
set -e

echo "== שלב 1: משחזר את תיקיית android/ מ-git (בלי לגעת בשום דבר אחר) =="
cd /workspaces/shift-app
git fetch origin
git checkout HEAD -- shift_app/android/
git checkout origin/main -- shift_app/android/ 2>/dev/null || true

echo ""
echo "--- בדיקה שהשחזור באמת הצליח ---"
find shift_app/android -type f | sort

if [ ! -f shift_app/android/app/src/main/AndroidManifest.xml ]; then
  echo ""
  echo "❌ עדיין אין shift_app/android/app/src/main/AndroidManifest.xml אחרי השחזור."
  echo "עוצרים כאן בלי לנסות לבנות — משהו יוצא דופן קורה בקודספייס הזה. אל תמשיך, שלח לי את כל הפלט למעלה."
  exit 1
fi

echo ""
echo "✅ תיקיית android/ תקינה. ממשיכים מיד לבנייה בלי לעצור באמצע."

echo ""
echo "== שלב 2: מעדכן את מסך העיבוד ואת קבצי התרגום (ליתר ביטחון) =="
cd /workspaces/shift-app/shift_app

cat > lib/features/processing/presentation/processing_screen.dart << 'PS_EOF'
import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart';
import '../../render_flow/data/render_flow_notifier.dart';
import '../../result/data/render_result_data.dart';

enum _ProcessingPhase { running, quotaExhausted, failure }

/// מסך 4/5 — עיבוד ההדמיה בפועל. כאן, ורק כאן, נשלחת הקריאה האמיתית:
/// העלאת התמונה המקומית ל-Storage (RenderService.uploadBeforeImage) ואז
/// יצירת ההדמיה (RenderService.generate).
///
/// ⚠️ שים לב: RenderService.uploadBeforeImage משתמש ב-dart:io, שלא נתמך
/// ב-Flutter Web. לכן אי אפשר לבדוק את המסך הזה מקצה-לקצה עם
/// `flutter run -d web-server` — צריך מכשיר או אמולטור אמיתי. המסך עצמו
/// מתקמפל ומציג נכון גם בדפדפן, רק הקריאה בפועל תיכשל שם.
class ProcessingScreen extends ConsumerStatefulWidget {
  const ProcessingScreen({super.key});

  @override
  ConsumerState<ProcessingScreen> createState() => _ProcessingScreenState();
}

class _ProcessingScreenState extends ConsumerState<ProcessingScreen> {
  _ProcessingPhase _phase = _ProcessingPhase.running;
  RenderFailure? _failure;
  Timer? _tipTimer;
  int _tipIndex = 0;

  @override
  void initState() {
    super.initState();
    _tipTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) setState(() => _tipIndex++);
    });
    // רצים אחרי הפריים הראשון כדי שניווט (context.go/push) יהיה בטוח.
    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    super.dispose();
  }

  Future<void> _run() async {
    setState(() {
      _phase = _ProcessingPhase.running;
      _failure = null;
    });

    final flow = ref.read(renderFlowProvider);
    if (!flow.readyForShift) {
      // הגעה למסך הזה בלי תמונה/בחירות תקינות — מצב לא תקין, חוזרים הביתה.
      if (mounted) context.go(AppRoutes.home);
      return;
    }

    final service = ref.read(renderServiceProvider);
    try {
      final beforeImagePath =
          await service.uploadBeforeImage(flow.localImagePath!);
      final outcome = await service.generate(
        roomTypeCode: flow.roomTypeCode!,
        selections: flow.selectionsList,
        beforeImagePath: beforeImagePath,
        languageCode: context.locale.languageCode,
      );

      if (!mounted) return;

      switch (outcome) {
        case RenderSuccess success:
          // שומרים את נתיב תמונת ה"לפני" *לפני* שמאפסים את המצב — היא
          // צריכה להגיע למסך התוצאה בשביל סליידר ההשוואה לפני/אחרי.
          final resultData = RenderResultData(
            outcome: success,
            beforeLocalImagePath: flow.localImagePath,
          );
          ref.read(renderFlowProvider.notifier).reset();
          context.pushReplacement(AppRoutes.result, extra: resultData);
        case RenderQuotaExhausted _:
          setState(() => _phase = _ProcessingPhase.quotaExhausted);
        case RenderFailure failure:
          setState(() {
            _phase = _ProcessingPhase.failure;
            _failure = failure;
          });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _ProcessingPhase.failure;
        _failure = RenderFailure('network_error', e.toString());
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // סשן 8: מונע יציאה (כפתור/מחווה "חזרה" של האנדרואיד) בזמן שההדמיה
    // עדיין רצה בפועל בשרת. בלי זה, משתמש שיוצא לפני שהתשובה חוזרת גורם
    // לקריאה להצליח ברקע (השרת ממשיך לרוץ) בלי שיהיה מי שיציג את התוצאה —
    // בדיוק מה שקרה בבדיקה שהצליחה בפועל אחרי כ-18 שניות, אחרי שהמשתמשת
    // כבר יצאה מהמסך. אחרי running (הצלחה/כישלון/מכסה) יציאה חופשית כרגיל.
    return PopScope(
      canPop: _phase != _ProcessingPhase.running,
      child: Scaffold(
        appBar: AppBar(
          title: Text('processing_screen.app_title'.tr()),
          automaticallyImplyLeading: false,
        ),
        body: SafeArea(
          child: switch (_phase) {
            _ProcessingPhase.running => _RunningView(tipIndex: _tipIndex),
            _ProcessingPhase.quotaExhausted => _QuotaExhaustedView(
                onBackHome: () => context.go(AppRoutes.home),
              ),
            _ProcessingPhase.failure => _FailureView(
                failure: _failure,
                onRetry: _run,
                onBack: () => context.pop(),
              ),
          },
        ),
      ),
    );
  }
}

class _RunningView extends ConsumerWidget {
  final int tipIndex;
  const _RunningView({required this.tipIndex});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(strokeWidth: 3),
          const SizedBox(height: 24),
          Text(
            'processing_screen.title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.eta_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 32),
          // מקום לפרסומת/הודעת מערכת (לא הפס הנייד העליון — זה במפורש לא
          // מוצג במסך העיבוד; זה כרטיס נייח שמתחלף כל כמה שניות).
          marquee.when(
            data: (messages) {
              if (messages.isEmpty) return const SizedBox.shrink();
              final text = messages[tipIndex % messages.length].message;
              return AnimatedSwitcher(
                duration: const Duration(milliseconds: 350),
                child: Container(
                  key: ValueKey(text),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: context.palette.accentSoft,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: context.palette.accentSoftLine),
                  ),
                  child: Text(
                    text,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                ),
              );
            },
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _QuotaExhaustedView extends StatelessWidget {
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
}

class _FailureView extends StatelessWidget {
  final RenderFailure? failure;
  final VoidCallback onRetry;
  final VoidCallback onBack;

  const _FailureView({
    required this.failure,
    required this.onRetry,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: AppColors.danger),
          const SizedBox(height: 16),
          Text(
            'processing_screen.error_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            failure?.messageHe ?? 'processing_screen.error_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onBack,
                  child: Text('processing_screen.back_button'.tr()),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onRetry,
                  child: Text('processing_screen.retry_button'.tr()),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
PS_EOF

cat > assets/translations/he.json << 'HE_EOF'
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
    "eta_note": "יצירת ההדמיה תיקח עד כ-30 שניות",
    "take_photo": "צלם תמונה",
    "choose_gallery": "בחר מהגלריה",
    "tap_to_pick": "גע כדי לצלם או לבחור מהגלריה",
    "uploaded_ok": "התמונה הועלתה בהצלחה",
    "file_hint": "JPG · PNG · עד 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "יוצרים את ההדמיה שלך",
    "eta_note": "לוקח בדרך כלל עד כ-30 שניות — נא לא לצאת מהמסך",
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
HE_EOF

cat > assets/translations/en.json << 'EN_EOF'
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
    "eta_note": "Creating the render takes up to about 30 seconds",
    "take_photo": "Take a photo",
    "choose_gallery": "Choose from gallery",
    "tap_to_pick": "Tap to take a photo or choose from gallery",
    "uploaded_ok": "Photo uploaded successfully",
    "file_hint": "JPG · PNG · up to 15MB"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Creating your render",
    "eta_note": "Usually takes up to about 30 seconds — please don't leave this screen",
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
EN_EOF

cat > assets/translations/ru.json << 'RU_EOF'
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
    "eta_note": "Создание рендера может занять до 30 секунд",
    "take_photo": "Сделать фото",
    "choose_gallery": "Выбрать из галереи",
    "tap_to_pick": "Нажмите, чтобы сделать фото или выбрать из галереи",
    "uploaded_ok": "Фото успешно загружено",
    "file_hint": "JPG · PNG · до 15МБ"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "Создаём ваш рендер",
    "eta_note": "Обычно занимает до 30 секунд — не покидайте этот экран",
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
RU_EOF

cat > assets/translations/ar.json << 'AR_EOF'
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
    "eta_note": "إنشاء الصورة قد يستغرق حتى 30 ثانية",
    "take_photo": "التقط صورة",
    "choose_gallery": "اختر من المعرض",
    "tap_to_pick": "اضغط لالتقاط صورة أو الاختيار من المعرض",
    "uploaded_ok": "تم رفع الصورة بنجاح",
    "file_hint": "JPG · PNG · حتى 15 ميغابايت"
  },
  "processing_screen": {
    "app_title": "SHIFT",
    "title": "جارٍ إنشاء التصميم الخاص بك",
    "eta_note": "يستغرق عادةً حتى 30 ثانية — يرجى عدم مغادرة هذه الشاشة",
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
AR_EOF

echo "✅ הקבצים עודכנו."

echo ""
echo "== שלב 3: בונה APK חדש (מיד, בלי הפסקה) =="
flutter build apk --debug
cp build/app/outputs/flutter-apk/app-debug.apk SHIFT_APK_TO_INSTALL.apk
echo "✅ נבנה: SHIFT_APK_TO_INSTALL.apk"
ls -la SHIFT_APK_TO_INSTALL.apk

echo ""
echo "== שלב 4: שמירה ב-git =="
cd /workspaces/shift-app
git add shift_app/lib/features/processing/presentation/processing_screen.dart \
        shift_app/assets/translations/he.json \
        shift_app/assets/translations/en.json \
        shift_app/assets/translations/ru.json \
        shift_app/assets/translations/ar.json
git commit -m "fix(processing): block back navigation while a render is still running

The server-side bug is now fully fixed (confirmed via a real successful
HTTP 200 in Supabase's own invocation logs, ~18.5s execution time). The
remaining problem was client-side: ProcessingScreen correctly guards its
success handler with 'if (!mounted) return;', but real generation now
takes up to ~18-20s while the UI text still promised \"about 15 seconds\"
and nothing stopped the user from backing out early. If they leave before
the response arrives, the request finishes successfully on the server
(consuming a real credit) with no one there to see the result.

Wrap the Scaffold in a PopScope that blocks back-navigation only during
the running phase (failure/quota screens keep their existing explicit
back buttons), and bump the ETA copy in all four languages to \"about 30
seconds\" with a note not to leave the screen, so the promised wait time
comfortably covers real-world generation time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W3TMFTUyNnBNVSFhLxGn9F" || echo "(אין שינוי חדש לשמור — ממשיכים)"
git push origin main
echo "✅ נשמר ונדחף ל-GitHub."

echo ""
echo "✅✅✅ סיימנו! עכשיו צריך להתקין את ה-APK החדש (SHIFT_APK_TO_INSTALL.apk, בתיקיית shift_app) על מכשיר הבדיקה, בדיוק כמו בפעמים הקודמות."
