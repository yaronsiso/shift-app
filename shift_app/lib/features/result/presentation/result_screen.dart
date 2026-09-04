import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
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
/// דרך גיליון השיתוף של המערכת), כפתור "עיצוב נוסף לחדר הזה", קישור
/// לגלריה האישית (סשן 9), ואזור דירוג קבוע. אם יש אבן-דרך משוב ממתינה
/// (2/10/20 הדמיות) — כרטיס קטן ולא חוסם מוצג מעל התוכן.
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
///
/// **סשן 9:** נוסף כפתור "לצפייה בכל ההדמיות שלי" שמוביל לגלריה האישית
/// (`AppRoutes.gallery`) — כל ההדמיות שהצליחו של המשתמש נשמרות שם
/// אוטומטית, בלי שום פעולה נוספת נדרשת ממנו.
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
      // צוברים את כל ה-chunks מהתגובה בעצמנו — פשוט ואמין, בלי תלות
      // בעזרי Flutter שיכולים להשתנות בין גרסאות SDK.
      final chunks = await response.toList();
      final bytes = chunks.expand((chunk) => chunk).toList();
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
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => context.push(AppRoutes.gallery),
                            child: Text(
                                'result_screen.view_gallery_button'.tr()),
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
