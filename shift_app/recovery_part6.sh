#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p \
  "assets/translations" \
  "lib/features/processing/presentation"

cat > 'lib/features/processing/presentation/processing_screen.dart' << 'SHIFTEOF'
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
          ref.read(renderFlowProvider.notifier).reset();
          context.pushReplacement(AppRoutes.result, extra: success);
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
    return Scaffold(
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
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF

echo "done: recovery_part6 (processing screen + translations)"