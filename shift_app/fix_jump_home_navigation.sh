#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

cat > lib/features/upload_photo/presentation/upload_photo_screen.dart << 'SHIFTEOF_UPLOAD'
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
SHIFTEOF_UPLOAD

cat > lib/features/design_studio/presentation/design_studio_screen.dart << 'SHIFTEOF_DESIGN'
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/route_names.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../dictionary/data/category_group.dart';
import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../dictionary/data/room_types_data.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render_flow/data/render_flow_notifier.dart';

/// מסך 2/5 — "בחירת חומרים". רק קבוצות-העל שנבחרו במסך הבית מופיעות
/// כטאבים; לכל טאב — רשימת פריטים מהמילון, מקובצת לפי **קטגוריה ← תת-
/// קטגוריה** (סשן 10 — ראו למטה), לא רשת שטוחה אחת מעורבבת. לכל
/// פריט **נבחר** אפשר להוסיף הערה חופשית (`FreeTextNote`) — מתועדת כמו
/// שהיא, ומעובדת לאילוץ באנגלית בשרת רק בזמן היצירה עצמה
/// (note_resolver.ts, שלב 5). **אין כאן צילום תמונה** — זה עבר במפורש
/// למסך נפרד לפי בקשת ירון (ראו home_screen.dart).
///
/// **סשן 10 — שני שינויים לפי משוב ירון:**
/// 1. הפריטים הזמינים בכל קבוצת-על **כבר לא מסוננים לפי סוג החדר** —
///    `MaterialItem.isAvailableIn` תמיד מחזירה `true` כעת (ראו
///    material_item.dart). "לא צריך להיות מתוייג כלום... הכל צריך
///    להיות פתוח לו... בכל חדר וחדר לא להגביל אנשים."
/// 2. הרשת השטוחה הוחלפה בחלוקה היררכית קטגוריה ← תת-קטגוריה, עם
///    כותרת לכל רמה — למשל בתוך "רהיטים": "מיטות", "מראות", "יחידת
///    טלוויזיה" וכו' כל אחת בנפרד, ולא כל הרהיטים מעורבבים ברשת אחת.
class DesignStudioScreen extends ConsumerStatefulWidget {
  const DesignStudioScreen({super.key});

  @override
  ConsumerState<DesignStudioScreen> createState() =>
      _DesignStudioScreenState();
}

class _DesignStudioScreenState extends ConsumerState<DesignStudioScreen> {
  String? _activeGroupCode;

  @override
  Widget build(BuildContext context) {
    final flow = ref.watch(renderFlowProvider);
    final notifier = ref.read(renderFlowProvider.notifier);
    final marquee = ref.watch(marqueeMessagesProvider);
    final locale = context.locale.languageCode;

    final roomType = flow.roomTypeCode;
    if (roomType == null || flow.selectedGroupCodes.isEmpty) {
      // הגעה למסך הזה בלי לעבור קודם דרך מסך הבית (למשל רענון ידני) —
      // אין ממה לבנות את הטאבים, חוזרים למסך הבית.
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

    final groups = kCategoryGroups
        .where((g) => flow.selectedGroupCodes.contains(g.code))
        .toList();
    if (groups.isEmpty) {
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

    if (_activeGroupCode == null ||
        !groups.any((g) => g.code == _activeGroupCode)) {
      _activeGroupCode = groups.first.code;
    }
    final activeGroup =
        groups.firstWhere((g) => g.code == _activeGroupCode);

    final items =
        CategoryGroups.itemsForRoomAndGroup(roomType, activeGroup.code);
    final sections = _groupByCategoryAndSubcategory(items);

    return Scaffold(
      appBar: AppBar(title: Text('design_studio_screen.app_title'.tr())),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'design_studio_screen.title'.tr(),
                    style:
                        Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                            ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _subtitle(roomType, groups, locale),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: context.palette.inkSoft,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 40,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                scrollDirection: Axis.horizontal,
                itemCount: groups.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final g = groups[i];
                  final selected = g.code == activeGroup.code;
                  return ChoiceChip(
                    label: Text(locale == 'he' ? g.labelHe : g.labelEn),
                    selected: selected,
                    onSelected: (_) =>
                        setState(() => _activeGroupCode = g.code),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: sections.isEmpty
                  ? Center(
                      child: Text(
                        'design_studio_screen.no_items'.tr(),
                        style: TextStyle(color: context.palette.inkFaint),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      itemCount: sections.length,
                      itemBuilder: (context, i) {
                        final section = sections[i];
                        return _CategorySection(
                          section: section,
                          locale: locale,
                          notifier: notifier,
                          isSelected: notifier.isSelected,
                          hasNoteFor: (id) =>
                              flow.selections[id]?.hasModifiers ?? false,
                          onNoteTap: (item) =>
                              _editNote(context, ref, item, locale),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: flow.hasSelections
                      ? () => context.push(AppRoutes.uploadPhoto)
                      : null,
                  child: Text('design_studio_screen.continue_button'.tr()),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// **סשן 10:** מקבץ את הפריטים הזמינים לפי `category` ואז לפי
  /// `subcategory` בתוכה, בסדר ההופעה המקורי במילון (לא ממוין מחדש) —
  /// כך שהסדר הקיים והמכוון של המילון (claude/08) נשמר, רק מוצג
  /// בצורה היררכית ברורה במקום רשת שטוחה אחת מעורבבת. `Map` הרגיל של
  /// Dart שומר על סדר הכנסה, אז מספיק לעבור על `items` פעם אחת.
  List<_CategoryBlock> _groupByCategoryAndSubcategory(
    List<MaterialItem> items,
  ) {
    final byCategory = <String, Map<String, List<MaterialItem>>>{};
    for (final item in items) {
      final bySub = byCategory.putIfAbsent(item.category, () => {});
      bySub.putIfAbsent(item.subcategory, () => []).add(item);
    }
    return byCategory.entries
        .map(
          (catEntry) => _CategoryBlock(
            category: catEntry.key,
            subcategories: catEntry.value.entries
                .map(
                  (subEntry) => _SubcategoryBlock(
                    subcategory: subEntry.key,
                    items: subEntry.value,
                  ),
                )
                .toList(),
          ),
        )
        .toList();
  }

  String _subtitle(
    String roomType,
    List<CategoryGroup> groups,
    String locale,
  ) {
    final room = kRoomTypes.firstWhere((r) => r.code == roomType);
    final roomLabel = locale == 'he' ? room.labelHe : room.labelEn;
    final groupLabels =
        groups.map((g) => locale == 'he' ? g.labelHe : g.labelEn).join(', ');
    return '$roomLabel · $groupLabels';
  }

  Future<void> _editNote(
    BuildContext context,
    WidgetRef ref,
    MaterialItem item,
    String locale,
  ) async {
    final notifier = ref.read(renderFlowProvider.notifier);
    final current = ref.read(renderFlowProvider).selections[item.id];
    String? existingText;
    if (current != null) {
      for (final mod in current.modifiers) {
        if (mod is FreeTextNote) {
          existingText = mod.rawText;
          break;
        }
      }
    }
    final controller = TextEditingController(text: existingText ?? '');

    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                locale == 'he' ? item.labelHe : item.labelEn,
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 4),
              Text(
                'design_studio_screen.note_hint'.tr(),
                style: TextStyle(
                  color: ctx.palette.inkSoft,
                  fontSize: 12.5,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'design_studio_screen.note_field_hint'.tr(),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    final text = controller.text.trim();
                    notifier.setItemModifiers(
                      item.id,
                      text.isEmpty ? const [] : [FreeTextNote(text)],
                    );
                    Navigator.of(ctx).pop();
                  },
                  child: Text('design_studio_screen.note_save'.tr()),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// קטגוריה מפורטת אחת (למשל "ריהוט") וכל תתי-הקטגוריות שבתוכה, בהקשר
/// קבוצת-העל הפעילה (סשן 10).
class _CategoryBlock {
  final String category;
  final List<_SubcategoryBlock> subcategories;
  const _CategoryBlock({required this.category, required this.subcategories});
}

/// תת-קטגוריה אחת (למשל "מיטות") וכל הפריטים שבתוכה.
class _SubcategoryBlock {
  final String subcategory;
  final List<MaterialItem> items;
  const _SubcategoryBlock({required this.subcategory, required this.items});
}

/// כותרת קטגוריה + כל תתי-הקטגוריות שלה, כל אחת עם כותרת-משנה ורשת
/// פריטים משלה. לא גוללת בעצמה — היא חלק מ-`ListView` חיצוני אחד.
class _CategorySection extends StatelessWidget {
  final _CategoryBlock section;
  final String locale;
  final RenderFlowNotifier notifier;
  final bool Function(String itemId) isSelected;
  final bool Function(String itemId) hasNoteFor;
  final void Function(MaterialItem item) onNoteTap;

  const _CategorySection({
    required this.section,
    required this.locale,
    required this.notifier,
    required this.isSelected,
    required this.hasNoteFor,
    required this.onNoteTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Text(
          section.category,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        for (final sub in section.subcategories) ...[
          const SizedBox(height: 10),
          Text(
            sub.subcategory,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: context.palette.inkSoft,
                ),
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.92,
            ),
            itemCount: sub.items.length,
            itemBuilder: (context, i) {
              final item = sub.items[i];
              final selected = isSelected(item.id);
              final hasNote = selected && hasNoteFor(item.id);
              return _MaterialCard(
                item: item,
                selected: selected,
                hasNote: hasNote,
                locale: locale,
                onTap: () => notifier.toggleItem(item),
                onNoteTap: selected ? () => onNoteTap(item) : null,
              );
            },
          ),
        ],
      ],
    );
  }
}

class _MaterialCard extends StatelessWidget {
  final MaterialItem item;
  final bool selected;
  final bool hasNote;
  final String locale;
  final VoidCallback onTap;
  final VoidCallback? onNoteTap;

  const _MaterialCard({
    required this.item,
    required this.selected,
    required this.hasNote,
    required this.locale,
    required this.onTap,
    required this.onNoteTap,
  });

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final palette = context.palette;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? primary : palette.line,
            width: selected ? 2 : 1,
          ),
        ),
        padding: const EdgeInsets.all(10),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: selected ? palette.accentSoft : palette.surface2,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: selected
                        ? Icon(Icons.check_circle, color: primary, size: 22)
                        : null,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  locale == 'he' ? item.labelHe : item.labelEn,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ),
            if (onNoteTap != null)
              Positioned(
                top: 0,
                right: locale == 'he' ? null : 0,
                left: locale == 'he' ? 0 : null,
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: onNoteTap,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardTheme.color,
                      shape: BoxShape.circle,
                      border: Border.all(color: palette.line),
                    ),
                    child: Icon(
                      hasNote ? Icons.edit_note : Icons.note_add_outlined,
                      size: 16,
                      color: hasNote ? primary : palette.inkFaint,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
SHIFTEOF_DESIGN

echo "✅ שני הקבצים עודכנו: upload_photo_screen.dart, design_studio_screen.dart. עכשיו: flutter analyze, ואז flutter build apk --debug."
