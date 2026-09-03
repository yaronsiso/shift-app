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
/// כטאבים; לכל טאב — רשת פריטים מהמילון (מסוננים לפי סוג החדר). לכל
/// פריט **נבחר** אפשר להוסיף הערה חופשית (`FreeTextNote`) — מתועדת כמו
/// שהיא, ומעובדת לאילוץ באנגלית בשרת רק בזמן היצירה עצמה
/// (note_resolver.ts, שלב 5). **אין כאן צילום תמונה** — זה עבר במפורש
/// למסך נפרד לפי בקשת ירון (ראו home_screen.dart).
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
        if (context.mounted) context.go(AppRoutes.home);
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    final groups = kCategoryGroups
        .where((g) => flow.selectedGroupCodes.contains(g.code))
        .toList();
    if (groups.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go(AppRoutes.home);
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
              child: items.isEmpty
                  ? Center(
                      child: Text(
                        'design_studio_screen.no_items'.tr(),
                        style: TextStyle(color: context.palette.inkFaint),
                      ),
                    )
                  : GridView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        mainAxisSpacing: 12,
                        crossAxisSpacing: 12,
                        childAspectRatio: 0.92,
                      ),
                      itemCount: items.length,
                      itemBuilder: (context, i) {
                        final item = items[i];
                        final selected = notifier.isSelected(item.id);
                        final hasNote = selected &&
                            (flow.selections[item.id]?.hasModifiers ?? false);
                        return _MaterialCard(
                          item: item,
                          selected: selected,
                          hasNote: hasNote,
                          locale: locale,
                          onTap: () => notifier.toggleItem(item),
                          onNoteTap: selected
                              ? () => _editNote(context, ref, item, locale)
                              : null,
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
                Text(
                  item.subcategory,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: palette.inkFaint),
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
