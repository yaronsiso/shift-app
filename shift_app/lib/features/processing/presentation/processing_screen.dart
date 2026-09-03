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
