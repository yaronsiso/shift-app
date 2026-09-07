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
/// כטאבים.
///
/// **סשן 15 (המשך 3) — נוספה רמת ביניים של תתי-קטגוריות (בקשת ירון,
/// אחרי שסידרנו את הבאגים מהבדיקה על המכשיר: "נעבור קטגוריה קטגוריה
/// ונשנה את כל הצורה של זה"):** במקום להציג ישר את כל תתי-הקטגוריות
/// של הקבוצה הפעילה מוערמות זו מתחת לזו על מסך אחד גולל, כל טאב (קבוצת-
/// על, למשל "רהיטים") פותח קודם **רשימת תתי-קטגוריות** (למשל "מיטות",
/// "שידות", "ספות"...) — ורק לחיצה על תת-קטגוריה ספציפית פותחת את
/// רשימת הפריטים בתוכה. תתי-הקטגוריות **הרלוונטיות לסוג החדר שנבחר
/// מוצגות ראשונות**, ואחריהן כל השאר — שום דבר לא מוסתר, רק מסודר לפי
/// רלוונטיות (ראו `CategoryGroups.subcategoriesForRoomAndGroup` ב-
/// category_group.dart). זה בדיוק המנגנון שירון תיאר: "לחדר שינה
/// שהקטגוריות שנפתחות ראשונות על ריהוט אמורות להיות מיטות... ואחרי זה
/// כל שאר הדברים".
///
/// לכל פריט **נבחר** אפשר להוסיף הערה חופשית (`FreeTextNote`) — מתועדת
/// כמו שהיא, ומעובדת לאילוץ באנגלית בשרת רק בזמן היצירה עצמה
/// (note_resolver.ts, שלב 5). **אין כאן צילום תמונה** — זה עבר במפורש
/// למסך נפרד לפי בקשת ירון (ראו home_screen.dart).
///
/// **סשן 10 (עדיין בתוקף):** הפריטים הזמינים בכל קבוצת-על **לא מסוננים
/// לפי סוג החדר** — `MaterialItem.isAvailableIn` תמיד מחזירה `true`
/// (ראו material_item.dart). זה לא השתנה בסשן 15 — סוג החדר משפיע רק
/// על **סדר ההצגה**, לא על מה שמוצג.
class DesignStudioScreen extends ConsumerStatefulWidget {
  const DesignStudioScreen({super.key});

  @override
  ConsumerState<DesignStudioScreen> createState() =>
      _DesignStudioScreenState();
}

class _DesignStudioScreenState extends ConsumerState<DesignStudioScreen> {
  String? _activeGroupCode;

  /// "category|subcategory" של תת-הקטגוריה הפתוחה כרגע, או null אם
  /// עדיין מציגים את רשימת תתי-הקטגוריות של הקבוצה הפעילה (סשן 15).
  String? _activeSubcategoryKey;

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
        // ראו ההסבר המלא למעלה.
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
      _activeSubcategoryKey = null;
    }
    final activeGroup =
        groups.firstWhere((g) => g.code == _activeGroupCode);

    final subcategories =
        CategoryGroups.subcategoriesForRoomAndGroup(roomType, activeGroup.code);
    SubcategorySummary? activeSubcategory;
    if (_activeSubcategoryKey != null) {
      for (final s in subcategories) {
        if ('${s.category}|${s.subcategory}' == _activeSubcategoryKey) {
          activeSubcategory = s;
          break;
        }
      }
      // תת-הקטגוריה שהייתה פתוחה כבר לא קיימת בקבוצה הזו (למשל אחרי
      // מעבר טאב) — חוזרים לרשימת תתי-הקטגוריות במקום למסך ריק.
      if (activeSubcategory == null) _activeSubcategoryKey = null;
    }

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
                    onSelected: (_) => setState(() {
                      _activeGroupCode = g.code;
                      _activeSubcategoryKey = null;
                    }),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: activeSubcategory != null
                  ? _SubcategoryItemsView(
                      subcategory: activeSubcategory,
                      locale: locale,
                      notifier: notifier,
                      isSelected: notifier.isSelected,
                      hasNoteFor: (id) =>
                          flow.selections[id]?.hasModifiers ?? false,
                      onNoteTap: (item) =>
                          _editNote(context, ref, item, locale),
                      onBack: () =>
                          setState(() => _activeSubcategoryKey = null),
                    )
                  : subcategories.isEmpty
                      ? Center(
                          child: Text(
                            'design_studio_screen.no_items'.tr(),
                            style: TextStyle(color: context.palette.inkFaint),
                          ),
                        )
                      : _SubcategoryListView(
                          subcategories: subcategories,
                          locale: locale,
                          isSelected: notifier.isSelected,
                          onTap: (s) => setState(() =>
                              _activeSubcategoryKey =
                                  '${s.category}|${s.subcategory}'),
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

/// **סשן 15 (המשך 3).** רשימת "כרטיסי" תתי-קטגוריה של הקבוצה הפעילה —
/// המסך שנפתח כשבוחרים למשל "רהיטים". תתי-קטגוריות רלוונטיות לחדר
/// שנבחר (`SubcategorySummary.relevant`) מגיעות כבר ממוינות ראשונות
/// מ-`CategoryGroups.subcategoriesForRoomAndGroup` — כאן רק מציגים,
/// כולל תג "מומלץ לחדר שלך" על אלה הרלוונטיות.
class _SubcategoryListView extends StatelessWidget {
  final List<SubcategorySummary> subcategories;
  final String locale;
  final bool Function(String itemId) isSelected;
  final void Function(SubcategorySummary subcategory) onTap;

  const _SubcategoryListView({
    required this.subcategories,
    required this.locale,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.35,
      ),
      itemCount: subcategories.length,
      itemBuilder: (context, i) {
        final s = subcategories[i];
        final selectedCount =
            s.items.where((item) => isSelected(item.id)).length;
        return _SubcategoryCard(
          subcategory: s,
          locale: locale,
          selectedCount: selectedCount,
          onTap: () => onTap(s),
        );
      },
    );
  }
}

class _SubcategoryCard extends StatelessWidget {
  final SubcategorySummary subcategory;
  final String locale;
  final int selectedCount;
  final VoidCallback onTap;

  const _SubcategoryCard({
    required this.subcategory,
    required this.locale,
    required this.selectedCount,
    required this.onTap,
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
            color: selectedCount > 0 ? primary : palette.line,
            width: selectedCount > 0 ? 2 : 1,
          ),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            if (subcategory.relevant)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: palette.accentSoft,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: palette.accentSoftLine),
                ),
                child: Text(
                  'design_studio_screen.recommended_badge'.tr(),
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: primary,
                  ),
                ),
              )
            else
              const SizedBox(height: 19),
            const Spacer(),
            Text(
              subcategory.subcategory,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  'design_studio_screen.subcategory_item_count'
                      .tr(args: ['${subcategory.items.length}']),
                  style: TextStyle(
                    fontSize: 12,
                    color: palette.inkFaint,
                  ),
                ),
                if (selectedCount > 0) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.check_circle, size: 14, color: primary),
                  const SizedBox(width: 2),
                  Text(
                    '$selectedCount',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: primary,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// **סשן 15 (המשך 3).** רשימת הפריטים בתוך תת-קטגוריה אחת שנבחרה —
/// כותרת + חץ חזרה לרשימת תתי-הקטגוריות, ואז רשת הפריטים (אותו כרטיס
/// פריט כמו קודם, `_MaterialCard`, בלי שינוי בלוגיקת הבחירה/ההערות).
class _SubcategoryItemsView extends StatelessWidget {
  final SubcategorySummary subcategory;
  final String locale;
  final RenderFlowNotifier notifier;
  final bool Function(String itemId) isSelected;
  final bool Function(String itemId) hasNoteFor;
  final void Function(MaterialItem item) onNoteTap;
  final VoidCallback onBack;

  const _SubcategoryItemsView({
    required this.subcategory,
    required this.locale,
    required this.notifier,
    required this.isSelected,
    required this.hasNoteFor,
    required this.onNoteTap,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    final isRtl = locale == 'he' || locale == 'ar';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 20, 8),
          child: Row(
            children: [
              IconButton(
                icon: Icon(isRtl ? Icons.arrow_forward : Icons.arrow_back),
                tooltip: 'design_studio_screen.back_to_categories'.tr(),
                onPressed: onBack,
              ),
              Expanded(
                child: Text(
                  subcategory.subcategory,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.92,
            ),
            itemCount: subcategory.items.length,
            itemBuilder: (context, i) {
              final item = subcategory.items[i];
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
        ),
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
</content>
