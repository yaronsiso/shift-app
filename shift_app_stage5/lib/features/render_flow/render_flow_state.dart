import 'package:flutter/foundation.dart';

import '../../dictionary/data/material_item.dart';
import '../../dictionary/data/note_modifier.dart';

/// המצב החי שנצבר לאורך מסכים 1-3 (בית → חומרים → העלאת תמונה), לפני
/// שנשלחת בקשת ההדמיה בפועל דרך RenderService (שלב 5). מתאפס אחרי כל
/// הדמיה (מוצלחת או לא) כדי שהמחזור הבא יתחיל נקי.
@immutable
class RenderFlowState {
  /// קוד סוג החדר שנבחר במסך הבית (למשל 'living', 'mamad').
  final String? roomTypeCode;

  /// קודי קבוצות-העל שנבחרו במסך הבית ('color', 'furniture', 'materials',
  /// 'lighting', 'garden', 'more').
  final Set<String> selectedGroupCodes;

  /// הבחירות בפועל ממסך החומרים, לפי מזהה פריט (MaterialItem.id).
  final Map<String, MaterialSelection> selections;

  /// נתיב מקומי לתמונה שנבחרה במסך העלאת התמונה (לפני העלאה ל-Storage).
  final String? localImagePath;

  const RenderFlowState({
    this.roomTypeCode,
    this.selectedGroupCodes = const {},
    this.selections = const {},
    this.localImagePath,
  });

  bool get hasRoomAndGroups => roomTypeCode != null && selectedGroupCodes.isNotEmpty;

  bool get hasSelections => selections.isNotEmpty;

  /// true = כל התנאים להצגת כפתור ה-SHIFT מתקיימים (מסך 3).
  bool get readyForShift => hasRoomAndGroups && hasSelections && localImagePath != null;

  List<MaterialSelection> get selectionsList => selections.values.toList();

  RenderFlowState copyWith({
    String? roomTypeCode,
    Set<String>? selectedGroupCodes,
    Map<String, MaterialSelection>? selections,
    String? localImagePath,
  }) {
    return RenderFlowState(
      roomTypeCode: roomTypeCode ?? this.roomTypeCode,
      selectedGroupCodes: selectedGroupCodes ?? this.selectedGroupCodes,
      selections: selections ?? this.selections,
      localImagePath: localImagePath ?? this.localImagePath,
    );
  }
}
