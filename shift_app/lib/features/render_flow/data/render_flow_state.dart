import 'package:flutter/foundation.dart';

import '../../prompt_engine/prompt_engine.dart';

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

  /// סשן 10 — תיקון קריטי (חוזר למסך בית ריק אחרי צילום): סריאליזציה
  /// ל-JSON פשוט (Map/List/String/bool בלבד) שאפשר לקודד עם `jsonEncode`
  /// ולשמור ב-SharedPreferences. ראו render_flow_notifier.dart להסבר
  /// המלא על הבאג ועל התיקון.
  Map<String, dynamic> toJson() {
    return {
      'roomTypeCode': roomTypeCode,
      'selectedGroupCodes': selectedGroupCodes.toList(),
      'selections': selections.values.map((s) => s.toJson()).toList(),
      'localImagePath': localImagePath,
    };
  }

  /// שחזור ממה ש-[toJson] שמר. **סלחני מאוד בכוונה:** כל שדה חסר/פגום
  /// גורם להתעלמות שקטה ממנו (במקום זריקת חריגה) — המטרה של כל המנגנון
  /// הזה היא בדיוק למנוע איבוד מידע וקריסה, אז שגיאת שחזור לא אמורה
  /// בעצמה לגרום לתקלה. פריט ששוחזר עם מזהה שכבר לא קיים במילון (למשל
  /// אחרי עדכון גרסה) פשוט נשמט על ידי [MaterialSelection.tryFromJson].
  static RenderFlowState fromJson(Map<String, dynamic> json) {
    try {
      final selectionsJson = json['selections'];
      final selections = <String, MaterialSelection>{};
      if (selectionsJson is List) {
        for (final raw in selectionsJson) {
          if (raw is! Map) continue;
          final sel =
              MaterialSelection.tryFromJson(Map<String, dynamic>.from(raw));
          if (sel != null) selections[sel.item.id] = sel;
        }
      }
      final groupsJson = json['selectedGroupCodes'];
      return RenderFlowState(
        roomTypeCode: json['roomTypeCode'] as String?,
        selectedGroupCodes: groupsJson is List
            ? groupsJson.map((e) => e.toString()).toSet()
            : const {},
        selections: selections,
        localImagePath: json['localImagePath'] as String?,
      );
    } catch (_) {
      return const RenderFlowState();
    }
  }
}
