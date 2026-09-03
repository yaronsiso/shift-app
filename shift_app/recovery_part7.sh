#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p \
  "assets/translations" \
  "lib/features/processing/presentation" \
  "lib/features/result/data" \
  "lib/features/result/presentation"

grep -q "share_plus:" pubspec.yaml || sed -i '/image_picker: \^1.1.2/a\  share_plus: ^7.2.1' pubspec.yaml

cat > 'lib/features/result/data/render_result_data.dart' << 'SHIFTEOF'
import 'package:flutter/foundation.dart';

import '../../render/data/render_service.dart';

/// עוטף את תוצאת ההדמיה שמועברת ממסך העיבוד (4/5) למסך התוצאה (5/5) דרך
/// `extra` של go_router.
///
/// **למה זה קיים בנפרד מ-`RenderSuccess`:** `RenderSuccess` (שלב 5,
/// `render_service.dart`) לא כולל את נתיב תמונת ה"לפני" — היא חיה רק
/// ב-`render_flow` עד לאיפוס. מסך העיבוד קורא ל-`RenderFlowNotifier.reset()`
/// מיד אחרי הצלחה, אז הוא שומר את הנתיב כאן *לפני* שהוא מאפס, כדי
/// שמסך התוצאה יוכל להציג סליידר לפני/אחרי.
@immutable
class RenderResultData {
  final RenderSuccess outcome;

  /// נתיב מקומי לתמונת ה"לפני" שנבחרה במסך העלאת התמונה. עלול להיות
  /// null אם משום מה לא היה זמין בזמן שהעיבוד רץ — מסך התוצאה מתמודד
  /// עם זה בחן (מציג את תמונת ה"אחרי" בלבד, בלי סליידר השוואה, ולא קורס).
  final String? beforeLocalImagePath;

  const RenderResultData({
    required this.outcome,
    required this.beforeLocalImagePath,
  });
}
SHIFTEOF

cat > 'lib/features/result/presentation/result_screen.dart' << 'SHIFTEOF'
import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show consolidateHttpClientResponseBytes;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../feedback/data/feedback_repository.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../data/render_result_data.dart';

/// מסך 5/5 — התוצאה. סליידר לפני/אחרי, שמירה ב-HD, שיתוף (וואטסאפ ועוד,
/// דרך גיליון השיתוף של המערכת), כפתור "עיצוב נוסף לחדר הזה", ואזור
/// דירוג קבוע. אם יש אבן-דרך משוב ממתינה (2/10/20 הדמיות) — כרטיס קטן
/// ולא חוסם מוצג מעל התוכן.
///
/// ⚠️ **פישוט מכוון, לתיאום עתידי עם ירון:** "עיצוב נוסף לחדר הזה" כרגע
/// פשוט חוזר למסך הבית (מצב הזרימה כבר התאפס במסך העיבוד לפני שהגענו
/// לכאן) — לא שומר את סוג החדר/הקטגוריות שנבחרו קודם. אם רוצים שזה
/// יזכור וימלא מראש את אותו סוג חדר, זו תוספת קטנה להמשך.
///
/// ⚠️ **החלטת מימוש לשמירה/שיתוף:** הוספתי תלות חדשה אחת — `share_plus`
/// — במקום פלאגין ייעודי לשמירה לגלריה (למשל `gal`), כי כזה דורש הגדרות
/// הרשאה נוספות בקבצי iOS/Android שאי אפשר לבדוק מכאן (אין גישת רשת/build
/// בענן). שני הכפתורים ("שמירה ב-HD" ו"שיתוף בוואטסאפ") פותחים את גיליון
/// השיתוף המובנה של המכשיר — משם אפשר לבחור "שמור תמונה" או וואטסאפ
/// ישירות. זו הדרך הפשוטה והאמינה ביותר בלי פלאגין נוסף שדורש בדיקה.
class ResultScreen extends ConsumerStatefulWidget {
  const ResultScreen({super.key});

  @override
  ConsumerState<ResultScreen> createState() => _ResultScreenState();
}

class _ResultScreenState extends ConsumerState<ResultScreen> {
  String? _afterImageUrl;
  bool _loadingImage = true;
  bool _imageError = false;
  bool _isSharing = false;
  int? _pendingMilestone;
  bool _milestoneDismissed = false;

  RenderResultData? _data;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // רק בפעם הראשונה — לא רוצים להריץ שוב בכל rebuild.
    if (_data == null) {
      final extra = GoRouterState.of(context).extra;
      if (extra is RenderResultData) {
        _data = extra;
        _resolveAfterImage();
        _checkMilestone();
      }
    }
  }

  Future<void> _resolveAfterImage() async {
    final data = _data;
    if (data == null) return;
    setState(() {
      _loadingImage = true;
      _imageError = false;
    });
    try {
      final path = data.outcome.afterImagePath;
      final url = path != null
          ? await ref.read(renderServiceProvider).signedUrlFor(path)
          : data.outcome.fallbackUrl;
      if (!mounted) return;
      if (url == null) {
        setState(() {
          _loadingImage = false;
          _imageError = true;
        });
        return;
      }
      setState(() {
        _afterImageUrl = url;
        _loadingImage = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingImage = false;
        _imageError = true;
      });
    }
  }

  Future<void> _checkMilestone() async {
    try {
      final milestone =
          await ref.read(feedbackRepositoryProvider).pendingMilestone();
      if (mounted && milestone != null) {
        setState(() => _pendingMilestone = milestone);
      }
    } catch (_) {
      // לא קריטי — פשוט לא נציג את הכרטיס.
    }
  }

  Future<File> _downloadToTemp(String url, String filename) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      final bytes = await consolidateHttpClientResponseBytes(response);
      final file = File('${Directory.systemTemp.path}/$filename');
      await file.writeAsBytes(bytes);
      return file;
    } finally {
      client.close();
    }
  }

  Future<void> _shareResult() async {
    final url = _afterImageUrl;
    if (url == null || _isSharing) return;
    setState(() => _isSharing = true);
    try {
      final renderId = _data?.outcome.renderId ?? 'shift';
      final file = await _downloadToTemp(url, 'shift_$renderId.jpg');
      if (!mounted) return;
      await Share.shareXFiles([XFile(file.path)], text: 'SHIFT');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('result_screen.share_error'.tr())),
        );
      }
    } finally {
      if (mounted) setState(() => _isSharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text('result_screen.app_title'.tr()),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: data == null
            ? _NoDataView(onBackHome: () => context.go(AppRoutes.home))
            : Column(
                children: [
                  marquee.when(
                    data: (messages) => MarqueeBar(
                      messages: messages.map((m) => m.message).toList(),
                    ),
                    loading: () => const SizedBox.shrink(),
                    error: (_, __) => const SizedBox.shrink(),
                  ),
                  if (_pendingMilestone != null && !_milestoneDismissed)
                    _MilestoneCard(
                      milestone: _pendingMilestone!,
                      onDone: () => setState(() => _milestoneDismissed = true),
                    ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(20),
                      children: [
                        Text(
                          'result_screen.title'.tr(),
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 16),
                        _buildImageArea(data),
                        const SizedBox(height: 24),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed:
                                    _afterImageUrl == null || _isSharing
                                        ? null
                                        : _shareResult,
                                icon: const Icon(Icons.download_outlined),
                                label: Text('result_screen.save_button'.tr()),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed:
                                    _afterImageUrl == null || _isSharing
                                        ? null
                                        : _shareResult,
                                icon: const Icon(Icons.ios_share),
                                label:
                                    Text('result_screen.share_button'.tr()),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.go(AppRoutes.home),
                            child: Text(
                                'result_screen.design_again_button'.tr()),
                          ),
                        ),
                        const SizedBox(height: 32),
                        const Divider(),
                        const SizedBox(height: 16),
                        _RatingArea(source: ReviewSource.resultScreen),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildImageArea(RenderResultData data) {
    if (_loadingImage) {
      return const AspectRatio(
        aspectRatio: 4 / 3,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_imageError || _afterImageUrl == null) {
      return AspectRatio(
        aspectRatio: 4 / 3,
        child: Container(
          decoration: BoxDecoration(
            color: context.palette.accentSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.broken_image_outlined, size: 40),
              const SizedBox(height: 8),
              Text('result_screen.image_error'.tr()),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _resolveAfterImage,
                child: Text('result_screen.retry_button'.tr()),
              ),
            ],
          ),
        ),
      );
    }

    final beforePath = data.beforeLocalImagePath;
    final beforeFile = beforePath != null ? File(beforePath) : null;
    final beforeExists = beforeFile != null && beforeFile.existsSync();

    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: beforeExists
          ? _BeforeAfterSlider(
              beforeImage: Image.file(beforeFile, fit: BoxFit.cover),
              afterImage: Image.network(_afterImageUrl!, fit: BoxFit.cover),
            )
          : AspectRatio(
              aspectRatio: 4 / 3,
              child: Image.network(_afterImageUrl!, fit: BoxFit.cover),
            ),
    );
  }
}

class _NoDataView extends StatelessWidget {
  final VoidCallback onBackHome;
  const _NoDataView({required this.onBackHome});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.image_not_supported_outlined,
                size: 48, color: context.palette.inkFaint),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: onBackHome,
              child: Text('result_screen.design_again_button'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}

/// סליידר השוואה — גוררים אופקית כדי לחשוף יותר/פחות מתמונת ה"לפני" מעל
/// תמונת ה"אחרי". תמיד נע משמאל לימין ויזואלית (כמו הפס הנייד — מוסכם
/// עם ירון שרכיבי תנועה לא חייבים לעקוב אחרי כיוון הקריאה).
class _BeforeAfterSlider extends StatefulWidget {
  final Widget beforeImage;
  final Widget afterImage;

  const _BeforeAfterSlider({
    required this.beforeImage,
    required this.afterImage,
  });

  @override
  State<_BeforeAfterSlider> createState() => _BeforeAfterSliderState();
}

class _BeforeAfterSliderState extends State<_BeforeAfterSlider> {
  double _fraction = 0.5;

  void _updateFraction(double dx, double width) {
    setState(() {
      _fraction = (dx / width).clamp(0.0, 1.0);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 4 / 3,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          return GestureDetector(
            onHorizontalDragUpdate: (details) {
              final box = context.findRenderObject() as RenderBox;
              final local = box.globalToLocal(details.globalPosition);
              _updateFraction(local.dx, width);
            },
            onTapDown: (details) {
              final box = context.findRenderObject() as RenderBox;
              final local = box.globalToLocal(details.globalPosition);
              _updateFraction(local.dx, width);
            },
            child: Stack(
              fit: StackFit.expand,
              children: [
                Positioned.fill(child: widget.afterImage),
                ClipRect(
                  clipper: _LeftClipper(fraction: _fraction),
                  child: widget.beforeImage,
                ),
                Positioned(
                  left: (width * _fraction) - 1,
                  top: 0,
                  bottom: 0,
                  child: Container(width: 2, color: Colors.white),
                ),
                Positioned(
                  left: (width * _fraction) - 16,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.swap_horiz,
                          size: 18, color: Colors.black87),
                    ),
                  ),
                ),
                Positioned(
                  right: 10,
                  top: 10,
                  child: _tag(context, 'result_screen.after_label'.tr()),
                ),
                Positioned(
                  left: 10,
                  top: 10,
                  child: _tag(context, 'result_screen.before_label'.tr()),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _tag(BuildContext context, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text,
          style: const TextStyle(color: Colors.white, fontSize: 11)),
    );
  }
}

class _LeftClipper extends CustomClipper<Rect> {
  final double fraction;
  const _LeftClipper({required this.fraction});

  @override
  Rect getClip(Size size) => Rect.fromLTWH(0, 0, size.width * fraction, size.height);

  @override
  bool shouldReclip(covariant _LeftClipper oldClipper) =>
      oldClipper.fraction != fraction;
}

/// כרטיס אבן-דרך משוב — קטן, לא חוסם, מעל התוכן. מוצג פעם אחת בלבד לכל
/// סף (2/10/20), נקבע ע"י `FeedbackRepository.pendingMilestone()`.
class _MilestoneCard extends ConsumerStatefulWidget {
  final int milestone;
  final VoidCallback onDone;

  const _MilestoneCard({required this.milestone, required this.onDone});

  @override
  ConsumerState<_MilestoneCard> createState() => _MilestoneCardState();
}

class _MilestoneCardState extends ConsumerState<_MilestoneCard> {
  MilestoneSatisfaction? _satisfaction;
  bool? _missingElements;
  final _missingController = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _missingController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final satisfaction = _satisfaction;
    if (satisfaction == null) return;
    setState(() => _sending = true);
    try {
      await ref.read(feedbackRepositoryProvider).submitMilestoneFeedback(
            milestone: widget.milestone,
            satisfaction: satisfaction,
            missingElements: _missingElements ?? false,
            missingElementsText: _missingController.text,
          );
    } catch (_) {
      // לא קריטי — לא חוסמים את המשתמש בגלל כשל בשליחת משוב.
    } finally {
      if (mounted) widget.onDone();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('result_screen.milestone_q1'.tr(),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: Text('result_screen.milestone_very_good'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.veryGood,
                  onSelected: (_) => setState(
                      () => _satisfaction = MilestoneSatisfaction.veryGood),
                ),
                ChoiceChip(
                  label: Text('result_screen.milestone_ok'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.ok,
                  onSelected: (_) =>
                      setState(() => _satisfaction = MilestoneSatisfaction.ok),
                ),
                ChoiceChip(
                  label: Text('result_screen.milestone_not_great'.tr()),
                  selected: _satisfaction == MilestoneSatisfaction.notGreat,
                  onSelected: (_) => setState(
                      () => _satisfaction = MilestoneSatisfaction.notGreat),
                ),
              ],
            ),
            if (_satisfaction != null) ...[
              const SizedBox(height: 16),
              Text('result_screen.milestone_q2'.tr(),
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: Text('result_screen.milestone_yes'.tr()),
                    selected: _missingElements == true,
                    onSelected: (_) =>
                        setState(() => _missingElements = true),
                  ),
                  ChoiceChip(
                    label: Text('result_screen.milestone_no'.tr()),
                    selected: _missingElements == false,
                    onSelected: (_) {
                      setState(() => _missingElements = false);
                      _submit();
                    },
                  ),
                ],
              ),
            ],
            if (_missingElements == true) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _missingController,
                maxLines: 2,
                decoration: InputDecoration(
                  hintText: 'result_screen.milestone_missing_hint'.tr(),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _sending ? null : _submit,
                  child: Text('result_screen.milestone_send'.tr()),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// אזור דירוג קבוע — כוכבים + טקסט חופשי אופציונלי. אפשר לשלוח כמה
/// פעמים שרוצים (בניגוד לכרטיס אבן-הדרך, שחד-פעמי לכל סף).
class _RatingArea extends ConsumerStatefulWidget {
  final ReviewSource source;
  const _RatingArea({required this.source});

  @override
  ConsumerState<_RatingArea> createState() => _RatingAreaState();
}

class _RatingAreaState extends ConsumerState<_RatingArea> {
  int _stars = 0;
  final _textController = TextEditingController();
  bool _sending = false;
  bool _sent = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_stars == 0 || _sending) return;
    setState(() => _sending = true);
    try {
      await ref.read(feedbackRepositoryProvider).submitReview(
            stars: _stars,
            reviewText: _textController.text,
            source: widget.source,
          );
      if (mounted) setState(() => _sent = true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('result_screen.share_error'.tr())),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_sent) {
      return Center(
        child: Text(
          'result_screen.rating_thanks'.tr(),
          style: TextStyle(color: context.palette.inkSoft),
        ),
      );
    }

    return Column(
      children: [
        Text('result_screen.rating_title'.tr(),
            style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(5, (i) {
            final filled = i < _stars;
            return IconButton(
              onPressed: () => setState(() => _stars = i + 1),
              icon: Icon(
                filled ? Icons.star : Icons.star_border,
                color: Theme.of(context).colorScheme.primary,
              ),
            );
          }),
        ),
        if (_stars > 0) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: TextField(
              controller: _textController,
              maxLines: 2,
              decoration: InputDecoration(
                hintText: 'result_screen.rating_hint'.tr(),
                border: const OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _sending ? null : _submit,
              child: Text('result_screen.rating_submit'.tr()),
            ),
          ),
        ],
      ],
    );
  }
}
SHIFTEOF

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
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF

echo "done: recovery_part7 (result screen + processing patch + translations + share_plus)"