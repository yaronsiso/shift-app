import 'package:flutter_test/flutter_test.dart';

import 'package:shift_app/features/dictionary/data/materials_data.dart';
import 'package:shift_app/features/dictionary/data/room_types_data.dart';
import 'package:shift_app/features/dictionary/data/note_modifier.dart';
import 'package:shift_app/features/prompt_engine/prompt_engine.dart';

void main() {
  group('שלמות המילון', () {
    test('אין מזהים כפולים', () {
      final ids = kMaterials.map((m) => m.id).toList();
      expect(ids.toSet().length, ids.length);
    });

    test('לכל פריט יש פרומפט אנגלי לא ריק', () {
      for (final m in kMaterials) {
        expect(m.promptEn.trim(), isNotEmpty, reason: 'פריט ${m.id}');
      }
    });

    test('כל סוגי החדרים שמוזכרים בפריטים קיימים בטבלת סוגי החדרים', () {
      final valid = kRoomTypes.map((r) => r.code).toSet();
      for (final m in kMaterials) {
        for (final rt in m.roomTypes) {
          expect(valid.contains(rt), isTrue,
              reason: 'פריט ${m.id} מפנה לסוג חדר לא מוכר: $rt');
        }
      }
    });

    test('אין טקסט עברי בשדה הפרומפט — המודל מקבל אנגלית בלבד', () {
      final hebrew = RegExp(r'[֐-׿]');
      for (final m in kMaterials) {
        expect(hebrew.hasMatch(m.promptEn), isFalse, reason: 'פריט ${m.id}');
      }
    });
  });

  group('גזירת prompt_strength', () {
    test('בחירות משטח בלבד → 0.55', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite', 'floor_parquet_oak_natural'],
      );
      expect(job.promptStrength, PromptEngine.strengthSurface);
      expect(job.hasConstructiveChange, isFalse);
    });

    test('בחירה קונסטרוקטיבית אחת מספיקה כדי להעלות ל-0.65', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite', 'ceiling_floating_led'],
      );
      expect(job.promptStrength, PromptEngine.strengthConstructive);
      expect(job.hasConstructiveChange, isTrue);
    });
  });

  group('בניית הפרומפט', () {
    test('הפרומפט מכיל רק את מה שהמשתמש בחר', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'living',
        itemIds: ['paint_offwhite'],
      );
      // המשתמש לא נגע באלומיניום ופתחים — אסור שהמילה תופיע.
      expect(job.prompt.toLowerCase().contains('window'), isFalse);
      expect(job.prompt.toLowerCase().contains('door'), isFalse);
    });

    test('חדר חוץ מקבל תבנית פרומפט חיצונית', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'yard',
        itemIds: ['fence_alu_black'],
      );
      expect(job.prompt.startsWith('A high-end photorealistic exterior'), isTrue);
    });

    test('ממ"ד נועל את אלמנטי הבטיחות', () {
      final job = PromptEngine.buildFromIds(
        roomTypeCode: 'mamad',
        itemIds: ['paint_offwhite'],
      );
      expect(job.protectedLabels, contains('MAMAD air filtration unit'));
      expect(job.protectedLabels,
          contains('MAMAD blast-resistant steel window'));
    });

    test('בחירה ריקה נכשלת מפורשות', () {
      expect(
        () => PromptEngine.buildFromIds(roomTypeCode: 'living', itemIds: []),
        throwsArgumentError,
      );
    });
  });

  group('שינויים לבקשת הלקוח', () {
    test('הגבלת גובה נכנסת כהוראת-על בסוף, לא ליד הפריט', () {
      final item = PromptEngine.itemById('bath_cladding_dark')!;
      final job = PromptEngine.build(
        roomTypeCode: 'bathroom',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              HeightLimit(100,
                  aboveTreatmentHe: 'צבע לבן',
                  aboveTreatmentEn: 'plain white paint'),
            ],
          ),
        ],
      );

      // תיאור הפריט המקורי נשאר שלם.
      expect(job.prompt.contains(item.promptEn), isTrue);
      // ההוראה המכריעה מופיעה אחריו.
      expect(job.prompt.contains('these requirements override'), isTrue);
      expect(job.prompt.contains('up to a height of 100 cm'), isTrue);
      // ומופיעה אחרי תיאור הפריט, לא לפניו.
      expect(job.prompt.indexOf('override'),
          greaterThan(job.prompt.indexOf(item.promptEn)));
    });

    test('עצירה לפני הקצה — המקרה של ריצוף שנעצר 10 ס"מ מהקיר', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final job = PromptEngine.build(
        roomTypeCode: 'living',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              StopShortOfEdge(10, edge: EdgeReference.wallEnd),
            ],
          ),
        ],
      );
      expect(job.prompt.contains('stopping 10 cm short of the end of the wall'),
          isTrue);
    });

    test('הסיכום ללקוח מוצג בעברית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final sel = MaterialSelection(
        item: item,
        modifiers: const [StopShortOfEdge(10)],
      );
      expect(sel.summaryHe(), contains('לעצור 10 ס"מ לפני הקיר'));
    });

    test('טקסט חופשי שלא עובד בשרת נכשל במקום להישלח בעברית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      expect(
        () => PromptEngine.build(
          roomTypeCode: 'living',
          selections: [
            MaterialSelection(
              item: item,
              modifiers: const [FreeTextNote('שהריצוף יעצור לפני הקיר')],
            ),
          ],
        ),
        throwsStateError,
      );
    });

    test('טקסט חופשי שעובד בשרת נכנס באנגלית', () {
      final item = PromptEngine.itemById('floor_porcelain_120x120')!;
      final job = PromptEngine.build(
        roomTypeCode: 'living',
        selections: [
          MaterialSelection(
            item: item,
            modifiers: const [
              FreeTextNote(
                'שהריצוף יעצור לפני הקיר',
                resolvedEn: 'the floor tiling stopping short of the wall',
              ),
            ],
          ),
        ],
      );
      final hebrew = RegExp(r'[֐-׿]');
      expect(hebrew.hasMatch(job.prompt), isFalse,
          reason: 'אסור שעברית תגיע למודל');
    });
  });
}
