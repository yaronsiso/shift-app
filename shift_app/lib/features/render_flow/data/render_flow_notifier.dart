import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';
import '../../prompt_engine/prompt_engine.dart';
import 'render_flow_state.dart';

/// מנהל את [RenderFlowState] לאורך מסכים 1-3. חי ב-`ProviderScope` הראשי
/// (לא `autoDispose`) כדי שהמצב ישרוד ניווט בין המסכים; מאופס במפורש
/// (`reset()`) אחרי שהדמיה נשלחה בהצלחה או כשחוזרים למסך הבית מחדש.
class RenderFlowNotifier extends StateNotifier<RenderFlowState> {
  RenderFlowNotifier() : super(const RenderFlowState());

  /// בחירת סוג חדר במסך הבית. מאפס את שאר הבחירות — הן תלויות בחדר
  /// (קבוצות-על זמינות, ופריטים בתוכן), אז בחירת חדר אחר מתחילה מחדש.
  void selectRoomType(String code) {
    state = RenderFlowState(roomTypeCode: code);
  }

  /// הפעלה/כיבוי של קבוצת-על אחת (צבע/רהיטים/חומרי בנייה/תאורה/גינה/ועוד).
  void toggleGroup(String groupCode) {
    final next = Set<String>.from(state.selectedGroupCodes);
    if (!next.remove(groupCode)) next.add(groupCode);
    state = state.copyWith(selectedGroupCodes: next);
  }

  /// הפעלה/כיבוי של פריט בודד במסך החומרים.
  void toggleItem(MaterialItem item) {
    final next = Map<String, MaterialSelection>.from(state.selections);
    if (next.containsKey(item.id)) {
      next.remove(item.id);
    } else {
      next[item.id] = MaterialSelection(item: item);
    }
    state = state.copyWith(selections: next);
  }

  bool isSelected(String itemId) => state.selections.containsKey(itemId);

  /// עדכון השינויים (הערה מיוחדת) על פריט שכבר נבחר. לא עושה כלום אם
  /// הפריט לא נבחר — קודם צריך `toggleItem`.
  void setItemModifiers(String itemId, List<NoteModifier> modifiers) {
    final existing = state.selections[itemId];
    if (existing == null) return;
    final next = Map<String, MaterialSelection>.from(state.selections);
    next[itemId] = MaterialSelection(item: existing.item, modifiers: modifiers);
    state = state.copyWith(selections: next);
  }

  /// שמירת התמונה שנבחרה במסך העלאת התמונה.
  void setLocalImage(String localPath) {
    state = state.copyWith(localImagePath: localPath);
  }

  /// איפוס מלא — אחרי שליחת הדמיה (הצלחה או כישלון), או חזרה למסך הבית.
  void reset() {
    state = const RenderFlowState();
  }
}

final renderFlowProvider =
    StateNotifierProvider<RenderFlowNotifier, RenderFlowState>(
  (ref) => RenderFlowNotifier(),
);
