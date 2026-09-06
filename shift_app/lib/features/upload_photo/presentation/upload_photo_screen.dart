import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../dictionary/data/category_group.dart';
import '../../dictionary/data/room_types_data.dart';
import '../../render_flow/data/render_flow_notifier.dart';

/// מסך 3/5 — "העלה תמונה שתרצה לעצב". המסך היחיד שבו יש מצלמה/גלריה —
/// לפי בקשת ירון (סשן 6), הועבר במפורש הנה ולא למסך הבית. המסך הזה
/// **לא** שולח כלום לשרת בעצמו — הוא רק שומר את נתיב התמונה המקומית
/// ב-[RenderFlowState.localImagePath]; ההעלאה בפועל וקריאת ה-Edge
/// Function (`RenderService.uploadBeforeImage` + `generate`) קורות
/// במסך העיבוד (מסך 4/5), שם יש גם את האנימציה של ~15 השניות.
///
/// ⚠️ **מגבלה ידועה, לא חדשה:** `RenderService.uploadBeforeImage`
/// (שלב 5, `claude/13`) משתמש ב-`dart:io File`, שלא עובד ב-Flutter Web.
/// כלומר בדיקת `flutter run -d web-server` (השיטה שעובדת ב-Codespace)
/// תיתן קומפילציה תקינה ובחירת תמונה תקינה, אבל **השלב שאחרי (עיבוד
/// בפועל) לא יעבוד בדפדפן** — לבדיקה מקצה לקצה צריך מכשיר/אמולטור
/// אמיתי. זו מגבלה שכבר הייתה קיימת מאז שלב 5, לא משהו חדש.
class UploadPhotoScreen extends ConsumerWidget {
  const UploadPhotoScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flow = ref.watch(renderFlowProvider);
    final notifier = ref.read(renderFlowProvider.notifier);
    final locale = context.locale.languageCode;

    final roomType = flow.roomTypeCode;
    if (roomType == null || flow.selectedGroupCodes.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // תיקון סשן 13: לא לנווט הביתה אם המסך הזה כבר לא זה שבחזית —
        // למשל אם הוא שוכב שקט בתחתית המחסנית מתחת למסך העיבוד, ו-
        // renderFlowProvider אופס כי ההגשה כבר הצליחה (ראו processing_screen
        // _run()). בלי הבדיקה הזו, האיפוס גורם למסך הזה להיבנות מחדש עם
        // flow ריק ולקפוץ הביתה — וה-context.go() מוחק את כל המחסנית,
        // כולל את מסך העיבוד שבאמת עדיין עוקב אחרי ההדמיה. זה שורש הבאג
        // "קפיצה למסך הבית" שדווח לאורך הפרויקט.
        if (context.mounted &&
            (ModalRoute.of(context)?.isCurrent ?? true)) {
          context.go(AppRoutes.home);
        }
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    final room = kRoomTypes.firstWhere((r) => r.code == roomType);
    final groups = kCategoryGroups
        .where((g) => flow.selectedGroupCodes.contains(g.code))
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: Text('upload_photo_screen.app_title'.tr()),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _RecapChip(locale == 'he' ? room.labelHe : room.labelEn),
                  for (final g in groups)
                    _RecapChip(locale == 'he' ? g.labelHe : g.labelEn),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                'upload_photo_screen.title'.tr(),
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
              ),
              const SizedBox(height: 4),
              Text(
                'upload_photo_screen.subtitle'.tr(),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: context.palette.inkSoft,
                    ),
              ),
              const SizedBox(height: 20),
              _UploadBox(
                localPath: flow.localImagePath,
                onTap: () => _pickImage(context, notifier),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.onSurface,
                    foregroundColor:
                        Theme.of(context).scaffoldBackgroundColor,
                  ),
                  onPressed: flow.readyForShift
                      ? () => context.push(AppRoutes.processing)
                      : null,
                  child: Text('upload_photo_screen.shift_button'.tr()),
                ),
              ),
              const SizedBox(height: 6),
              Center(
                child: Text(
                  'upload_photo_screen.eta_note'.tr(),
                  style: TextStyle(
                    fontSize: 10.5,
                    color: context.palette.inkFaint,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _pickImage(
    BuildContext context,
    RenderFlowNotifier notifier,
  ) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text('upload_photo_screen.take_photo'.tr()),
              onTap: () => Navigator.of(ctx).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text('upload_photo_screen.choose_gallery'.tr()),
              onTap: () => Navigator.of(ctx).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    final picked = await ImagePicker().pickImage(
      source: source,
      imageQuality: 90,
    );
    if (picked == null) return;
    notifier.setLocalImage(picked.path);
  }
}

class _RecapChip extends StatelessWidget {
  final String label;
  const _RecapChip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: context.palette.surface2,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: context.palette.line),
      ),
      child: Text(label, style: const TextStyle(fontSize: 11.5)),
    );
  }
}

class _UploadBox extends StatelessWidget {
  final String? localPath;
  final VoidCallback onTap;

  const _UploadBox({required this.localPath, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 24),
        decoration: BoxDecoration(
          border: Border.all(color: palette.lineStrong, width: 1.4),
          borderRadius: BorderRadius.circular(16),
          color: palette.surface2,
        ),
        child: Column(
          children: [
            Icon(Icons.add_photo_alternate_outlined,
                size: 30, color: palette.inkFaint),
            const SizedBox(height: 10),
            Text(
              localPath == null
                  ? 'upload_photo_screen.tap_to_pick'.tr()
                  : 'upload_photo_screen.uploaded_ok'.tr(),
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: localPath == null
                    ? Theme.of(context).textTheme.bodyMedium?.color
                    : Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'upload_photo_screen.file_hint'.tr(),
              style: TextStyle(fontSize: 11, color: palette.inkFaint),
            ),
            if (localPath != null && _isLocalFilePath(localPath!)) ...[
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(
                  File(localPath!),
                  height: 90,
                  width: 90,
                  fit: BoxFit.cover,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// תמונת תצוגה מקדימה (`Image.file`) עובדת רק על מובייל/דסקטופ —
  /// לא ב-Web (נתיב שם הוא `blob:`/`http`, לא נתיב קובץ אמיתי אמיתי
  /// שאפשר להעביר ל-`File(...)`).
  bool _isLocalFilePath(String path) =>
      !path.startsWith('blob:') && !path.startsWith('http');
}
