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

enum _ProcessingPhase {
  /// שולחים/מעקבים אחרי הדמיה שעדיין רצה.
  running,

  /// אין קרדיטים — נתגלה מיד עם ההגשה, לפני שנוצר renderId.
  quotaExhausted,

  /// כשל מיידי בהגשה עצמה (לפני שנוצר renderId) — בחירות/רשת/שרת.
  /// מצב הזרימה (`render_flow`) עדיין שלם, אז "נסה שוב" שולח את אותה
  /// בקשה שוב.
  submitFailure,

  /// כשל שהתגלה בתשאול (אחרי שכבר היה renderId) — הקרדיט כבר הוחזר
  /// אוטומטית בשרת. אין "נסה שוב" עם אותן בחירות: הזרימה כבר אופסה
  /// ברגע שהבקשה הוגשה (ראו ההסבר ב-_run), ובמצב "חידוש אוטומטי" היא
  /// לא הייתה קיימת מלכתחילה (האפליקציה נפתחה מחדש). המשתמש פשוט בוחר
  /// שוב מההתחלה.
  postFailure,

  /// עברו הרבה יותר מ-30 השניות הרגילות בלי תוצאה. שום דבר לא אבד —
  /// ההדמיה עדיין רצה/ממתינה בשרת — אבל מפסיקים לתשאל באגרסיביות
  /// ומאפשרים למשתמש לחזור למסך הבית ולבוא לבדוק אחר כך (גם דרך חידוש
  /// אוטומטי בפעם הבאה שהוא פותח את האפליקציה, וגם דרך הגלריה שלו ברגע
  /// שההדמיה תסתיים).
  stillWorking,
}

/// מסך 4/5 — עיבוד ההדמיה.
///
/// **סשן 9 — שינוי ארכיטקטוני מלא:** בעבר המסך היה שולח בקשה אחת ומחכה
/// לה עד הסוף (18-30 שניות, חיבור פתוח לכל האורך) — וזה מה שגרם לבאג
/// "קפיצה למסך הבית": מערכת ההפעלה (גם ב-MIUI/פוקו וגם בסמסונג, אושר
/// בבדיקה אצל שני משתמשים שונים) הורגת את האפליקציה ברקע בזמן ההמתנה,
/// והתוצאה שהשרת כבר סיים ליצור בהצלחה (מאומת ב-Invocations: 200)
/// "נופלת על הרצפה" כי אין מי שיציג אותה.
///
/// עכשיו הזרימה מפוצלת לשני שלבים: `RenderService.submitRender` שולח
/// את הבקשה וחוזר **כמעט מיד** עם renderId בלבד (השרת ממשיך לעבד ברקע
/// אחרי שהוא כבר ענה — ראו ה-Edge Function), ואז המסך **מתשאל**
/// (`checkStatus`) כל 2 שניות עד שהתוצאה מוכנה. גם אם המסך הזה עצמו
/// נסגר/נהרס באמצע (המשתמש יצא, או האפליקציה נהרגה) — שום דבר לא אבד:
/// כשהמשתמש חוזר למסך הבית, `HomeScreen` מגלה אוטומטית שיש הדמיה שעדיין
/// בעיבוד וחוזר לכאן להמשיך לעקוב אחריה (`ProcessingResumeArgs`).
/// **לכן המסך הזה כבר לא חוסם יציאה** (ה-`PopScope` שנוסף בסשן 8 הוסר
/// בכוונה) — אפשר לצאת בביטחון.
///
/// ⚠️ שים לב: RenderService.uploadBeforeImage משתמש ב-dart:io, שלא נתמך
/// ב-Flutter Web. לכן אי אפשר לבדוק את שלב ההגשה (לא את התשאול) מקצה-
/// לקצה עם `flutter run -d web-server` — צריך מכשיר או אמולטור אמיתי.
class ProcessingScreen extends ConsumerStatefulWidget {
  const ProcessingScreen({super.key});

  @override
  ConsumerState<ProcessingScreen> createState() => _ProcessingScreenState();
}

class _ProcessingScreenState extends ConsumerState<ProcessingScreen> {
  static const _pollInterval = Duration(seconds: 2);
  // ~2 דקות של תשאול פעיל (60 * 2 שניות) לפני שעוברים למצב "עדיין עובדים
  // על זה" הפסיבי — נדיב בהרבה מזמן היצירה הרגיל (18-30 שניות).
  static const _maxActivePollAttempts = 60;

  _ProcessingPhase _phase = _ProcessingPhase.running;
  RenderFailure? _failure;
  Timer? _tipTimer;
  Timer? _pollTimer;
  int _tipIndex = 0;
  int _pollAttempts = 0;

  String? _renderId;
  int _freeRemainingAtSubmit = 0;
  String? _beforeLocalImagePathForResult;
  bool _isResume = false;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _tipTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) setState(() => _tipIndex++);
    });
    // רצים אחרי הפריים הראשון כדי שניווט (context.go/push) יהיה בטוח.
    WidgetsBinding.instance.addPostFrameCallback((_) => _init());
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    _pollTimer?.cancel();
    super.dispose();
  }

  void _init() {
    if (_initialized) return;
    _initialized = true;

    final extra = GoRouterState.of(context).extra;
    if (extra is ProcessingResumeArgs) {
      // חידוש אוטומטי — כבר יש renderId קיים, רק ממשיכים לעקוב אחריו.
      // אין תמונת "לפני" מקומית זמינה (מצב הזרימה כבר אבד כשהאפליקציה
      // נסגרה) — מסך התוצאה יודע להתמודד עם זה בחן (תמונת "אחרי" בלבד).
      _isResume = true;
      _renderId = extra.renderId;
      _startPolling();
    } else {
      _run();
    }
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
    _beforeLocalImagePathForResult = flow.localImagePath;

    final service = ref.read(renderServiceProvider);
    try {
      final beforeImagePath =
          await service.uploadBeforeImage(flow.localImagePath!);
      final outcome = await service.submitRender(
        roomTypeCode: flow.roomTypeCode!,
        selections: flow.selectionsList,
        beforeImagePath: beforeImagePath,
        languageCode: context.locale.languageCode,
      );

      if (!mounted) return;

      switch (outcome) {
        case RenderSubmitted submitted:
          _renderId = submitted.renderId;
          _freeRemainingAtSubmit = submitted.freeRemaining;
          // מאפסים את מצב הזרימה **מיד אחרי ההגשה**, לא אחרי שהתוצאה
          // מוכנה: מרגע שהבקשה נקלטה בשרת, אין עוד צורך בבחירות האלה
          // כאן — וכך אפשר להתחיל זרימת עיצוב חדשה בלי להתנגש איתן, גם
          // אם ההדמיה הזו עדיין רצה ברקע.
          ref.read(renderFlowProvider.notifier).reset();
          _startPolling();
        case RenderQuotaExhausted _:
          setState(() => _phase = _ProcessingPhase.quotaExhausted);
        case RenderFailure failure:
          setState(() {
            _phase = _ProcessingPhase.submitFailure;
            _failure = failure;
          });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _ProcessingPhase.submitFailure;
        _failure = RenderFailure('network_error', e.toString());
      });
    }
  }

  void _startPolling() {
    setState(() => _phase = _ProcessingPhase.running);
    _pollAttempts = 0;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _pollOnce());
    _pollOnce(); // בדיקה ראשונה מיידית, לא מחכים ל-tick הראשון.
  }

  Future<void> _pollOnce() async {
    final renderId = _renderId;
    if (renderId == null) return;
    _pollAttempts++;

    try {
      final status =
          await ref.read(renderServiceProvider).checkStatus(renderId);
      if (!mounted) return;

      if (status.isSucceeded) {
        _pollTimer?.cancel();
        final resultData = RenderResultData(
          outcome: RenderSuccess(
            renderId: status.renderId,
            afterImagePath: status.afterImagePath,
            fallbackUrl: null,
            freeRemaining: _freeRemainingAtSubmit,
          ),
          beforeLocalImagePath: _beforeLocalImagePathForResult,
        );
        context.pushReplacement(AppRoutes.result, extra: resultData);
        return;
      }

      if (status.isTerminalFailure) {
        _pollTimer?.cancel();
        setState(() {
          _phase = _ProcessingPhase.postFailure;
          _failure = RenderFailure(status.status, status.errorMessage);
        });
        return;
      }

      // עדיין pending/processing.
      if (_pollAttempts >= _maxActivePollAttempts) {
        _pollTimer?.cancel();
        setState(() => _phase = _ProcessingPhase.stillWorking);
      }
    } catch (_) {
      // שגיאת רשת זמנית בבדיקת סטטוס — לא מכשילים את כל התהליך, פשוט
      // מנסים שוב בבדיקה הבאה. אם זה נמשך הרבה זמן, _maxActivePollAttempts
      // עדיין יעצור את התשאול האגרסיבי.
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
          _ProcessingPhase.running =>
            _RunningView(tipIndex: _tipIndex, isResume: _isResume),
          _ProcessingPhase.quotaExhausted => _QuotaExhaustedView(
              onBackHome: () => context.go(AppRoutes.home),
            ),
          _ProcessingPhase.submitFailure => _FailureView(
              failure: _failure,
              primaryLabel: 'processing_screen.retry_button'.tr(),
              onPrimary: _run,
              secondaryLabel: 'processing_screen.back_button'.tr(),
              onSecondary: () => context.pop(),
            ),
          _ProcessingPhase.postFailure => _FailureView(
              failure: _failure,
              primaryLabel: 'processing_screen.quota_button'.tr(),
              onPrimary: () => context.go(AppRoutes.home),
            ),
          _ProcessingPhase.stillWorking => _StillWorkingView(
              onBackHome: () => context.go(AppRoutes.home),
              onKeepWaiting: _startPolling,
            ),
        },
      ),
    );
  }
}

class _RunningView extends ConsumerWidget {
  final int tipIndex;
  final bool isResume;
  const _RunningView({required this.tipIndex, required this.isResume});

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
            isResume
                ? 'processing_screen.resuming_note'.tr()
                : 'processing_screen.eta_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 6),
          Text(
            'processing_screen.leave_ok_note'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.palette.inkFaint,
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

/// עדיין רצה הרבה יותר מהצפוי — לא כישלון, רק המתנה ארוכה. שום דבר לא
/// אבד: אפשר לחזור למסך הבית (ההדמיה תופיע שם אוטומטית כשתסתיים, ובגלריה
/// האישית) או להישאר ולהמשיך להמתין כאן.
class _StillWorkingView extends StatelessWidget {
  final VoidCallback onBackHome;
  final VoidCallback onKeepWaiting;
  const _StillWorkingView(
      {required this.onBackHome, required this.onKeepWaiting});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.hourglass_top, size: 48, color: context.palette.inkFaint),
          const SizedBox(height: 16),
          Text(
            'processing_screen.still_working_title'.tr(),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'processing_screen.still_working_body'.tr(),
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
                  onPressed: onBackHome,
                  child: Text('processing_screen.quota_button'.tr()),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onKeepWaiting,
                  child:
                      Text('processing_screen.still_working_wait_button'.tr()),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  final RenderFailure? failure;
  final String primaryLabel;
  final VoidCallback onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  const _FailureView({
    required this.failure,
    required this.primaryLabel,
    required this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
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
          if (secondaryLabel != null && onSecondary != null)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onSecondary,
                    child: Text(secondaryLabel!),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: onPrimary,
                    child: Text(primaryLabel),
                  ),
                ),
              ],
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: onPrimary,
                child: Text(primaryLabel),
              ),
            ),
        ],
      ),
    );
  }
}
