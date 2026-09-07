#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p supabase/functions/_shared

cat > supabase/functions/_shared/prompt_engine.ts << 'SHIFTEOF'
// מנוע הפרומפטים — צד שרת.
//
// עד סשן 14 היה זהה בלוגיקה ל-lib/features/prompt_engine/prompt_engine.dart
// שבאפליקציה. **מסשן 14 השניים הופרדו במכוון**: הקובץ הזה עודכן למעבר
// ל-Nano Banana Pro (ראו קבוצת ההערות מתחת ל-imports), אבל הגרסה בצד
// הלקוח לא עודכנה — היא ממילא לא נצרכת בשום מקום בפועל
// (RenderService.submitRender שולח רק roomTypeCode + selections, לא
// פרומפט מוכן; toReplicateInput() ב-Dart הוא קוד מת). לפני שנוגעים שוב
// בגרסת הלקוח (או משתמשים בה לתצוגה מקדימה אמיתית למשתמש) — צריך קודם
// לעדכן אותה ואת test/prompt_engine_test.dart בהתאם לשינוי כאן (בייחוד
// הבדיקה שבודקת שהמילה "window" לא מופיעה כשלא נבחר פריט רלוונטי —
// היא כבר לא נכונה לגרסה כאן, ראו ההסבר על PRESERVE_BASE למטה).
//
// **למה הוא קיים גם כאן:** האפליקציה לא שולחת את הפרומפט המוכן. היא שולחת
// את סוג החדר ואת רשימת מזהי הפריטים, והשרת בונה את הפרומפט בעצמו מהמילון
// שלו. אחרת כל מי שיפרק את האפליקציה יוכל לשלוח פרומפט חופשי כרצונו
// ולהשתמש בחשבון ה-Replicate שלנו לכל מטרה שהיא.
//
// הגרסה הזו (שרת) היא **הקובעת** — מה שנשלח בפועל ל-Replicate.
//
// ============================================================================
// סשן 15 — תיקון "המצאת" אביזרים/ריהוט/ציוד שלא נבחרו (מזגן, דוד שמש,
// צינורות וכו' הופיעו בתוצאה בלי שנבחרו) — ראו PRESERVE_BASE למטה.
// ============================================================================
// שורש הבעיה: PRESERVE_BASE (מסשן 14) כיסתה רק מבנה/קירות/חלונות/דלתות/
// זווית מצלמה + אלמנטים רגולטוריים ספציפיים (protectedLabels) — לא היה
// אף משפט כללי שאומר למודל לא להוסיף שום דבר אחר. במודל הישן (adirik)
// prompt_strength/guidance_scale ריסנו חלק מ"ההמצאות" האלה כפרמטר טכני;
// ל-Nano Banana Pro אין את הפרמטרים האלה בכלל (ראו למטה), אז השכבה הזו
// נעלמה עם המעבר בלי שפיצינו עליה בניסוח הפרומפט. נבדק בפועל 7.9.2026 —
// ירון בחר חדר שינה + מיטה עם גומחה מקומרת ופס לד, וקיבל תוצאה עם מזגן,
// דוד שמש וצינורות שלא היו בתמונה המקורית ולא נבחרו.

import {
  MATERIALS_BY_ID,
  ROOMS_BY_CODE,
  PROTECTED_ELEMENTS,
  type MaterialItem,
} from "./dictionary.ts";

// ============================================================================
// סשן 14 — מעבר ל-Nano Banana Pro (google/nano-banana-pro ב-Replicate)
// ============================================================================
// שלושת הקבועים האלה (GUIDANCE_SCALE / NUM_INFERENCE_STEPS / STRENGTH_*)
// נועדו למודל דיפוזיה קלאסי (adirik/interior-design). ל-Nano Banana Pro
// (מודל Gemini רב-מודלי) **אין** guidance_scale, num_inference_steps או
// prompt_strength בסכמת הקלט שלו כלל — הוא לא עובד ב"חוזק החלה" גרדואלי
// אלא מפרש את כל הפרומפט כהוראה טקסטואלית אחת. השארתי את הקבועים והשדות
// האלה ב-RenderJob ובטבלת renders (בהמשך הקובץ ובקוד ה-Edge Function)
// **רק** לצורך המשכיות/דיבוג של הדמיות ישנות — `generate-render/index.ts`
// כבר לא שולח אותם ל-Replicate. אין לצרף אותם לקריאה למודל החדש.
export const GUIDANCE_SCALE = 7.5;
export const NUM_INFERENCE_STEPS = 50;
export const STRENGTH_SURFACE = 0.55;
export const STRENGTH_CONSTRUCTIVE = 0.65;

const PREFIX_INTERIOR =
  "A high-end photorealistic interior design render of an Israeli";
const PREFIX_EXTERIOR =
  "A high-end photorealistic exterior architectural render of an Israeli";

// **סשן 14:** ל-Nano Banana Pro אין שדה `negative_prompt` נפרד (זה מושג
// שרלוונטי רק למודלי דיפוזיה כמו Stable Diffusion) — יש רק שדה `prompt`
// אחד, וההוראה למודל להימנע ממשהו צריכה להיות מנוסחת בחיוב בתוך אותו
// טקסט. לכן ה"נגטיב" הישן תורגם כאן לשני חלקים שמצטרפים ל-segments של
// הפרומפט הראשי: PRESERVE_BASE (מבנה/זוויות/בלי הוספת פתחים, **וכעת גם
// בלי הוספת אביזרים/ריהוט/ציוד חדש — סשן 15**) ו-QUALITY_SUFFIX
// (איכות/בלי watermark/בלי קריקטורה). ה-constant הישן NEGATIVE_BASE נשאר
// קיים ומחושב כדי שעמודת renders.negative_prompt תמשיך להתמלא לצורכי
// תיעוד/דיבוג — אבל **הוא לא נשלח יותר ל-Replicate**.
export const NEGATIVE_BASE =
  "changing room structure, moving walls, different window positions, " +
  "distorted perspective, warped geometry, extra windows, extra doors, " +
  "mirror, mirrored, " +
  "blurry, low quality, watermark, text, cartoon, illustration";

// **סשן 15:** נוספו שתי הוראות חדשות בסוף (אחרי "no mirrored or flipped
// layout") — זה כל השינוי בקובץ הזה. הכל אחרי זה זהה לסשן 14.
const PRESERVE_BASE =
  "the room's structure, wall positions, window and door placement, and " +
  "camera perspective must stay exactly identical to the original photo; " +
  "do not add extra windows or doors; no mirrored or flipped layout; " +
  "do not add any new furniture, decor, appliances, fixtures, or equipment " +
  "beyond what is explicitly described above; every other object already " +
  "present in the original photo that is not explicitly changed above must " +
  "remain exactly as it is, in its original position and appearance";

const QUALITY_SUFFIX =
  "photorealistic result, 8k resolution, architectural photography, " +
  "highly detailed, sharp focus, no watermark, no text overlay, no " +
  "illustration or cartoon style";

/** שינוי מובנה שהלקוח ביקש. מנוסח באנגלית באפליקציה, ומאומת כאן. */
export type StructuredModifier =
  | { kind: "heightLimit"; cm: number; aboveTreatmentEn?: string }
  | { kind: "stopShortOfEdge"; cm: number; edgeEn: string }
  | { kind: "partialCoverage"; scopeEn: string }
  | { kind: "layoutDirection"; directionEn: string };

/** הערת טקסט חופשי — מגיעה בשפת הלקוח ומעובדת כאן. */
export interface FreeTextModifier {
  kind: "freeText";
  rawText: string;
  /** ממולא ע"י note_resolver לפני בניית הפרומפט. */
  resolvedEn?: string;
}

export type Modifier = StructuredModifier | FreeTextModifier;

export interface SelectionInput {
  itemId: string;
  modifiers?: Modifier[];
}

export interface RenderJob {
  prompt: string;
  negativePrompt: string;
  promptStrength: number;
  guidanceScale: number;
  numInferenceSteps: number;
  protectedLabels: string[];
  hasConstructiveChange: boolean;
  /** הפריטים שנבחרו, לשמירה ב-renders.style_selections. */
  resolvedSelections: {
    id: string;
    labelHe: string;
    promptEn: string;
    modifiers: string[];
  }[];
}

export class PromptBuildError extends Error {}

const EDGE_WHITELIST = new Set([
  "the wall",
  "the end of the wall",
  "the doorway",
  "the ceiling",
]);

const SCOPE_WHITELIST = new Set([
  "to a single feature wall",
  "to the lower half of the wall",
  "to the upper half of the wall",
  "to the shower area",
  "to the wall behind the furniture",
]);

const DIRECTION_WHITELIST = new Set([
  "in a horizontal orientation",
  "in a vertical orientation",
  "in a diagonal orientation",
  "in a herringbone pattern",
]);

/**
 * מנסח שינוי מובנה כאילוץ באנגלית.
 *
 * הערכים המילוליים מאומתים מול רשימה סגורה. הלקוח לא יכול להזריק טקסט
 * חופשי דרך שדה "מובנה" ולעקוף את שכבת העיבוד של ההערות.
 */
function constraintFromStructured(m: StructuredModifier): string {
  switch (m.kind) {
    case "heightLimit": {
      if (!Number.isInteger(m.cm) || m.cm < 1 || m.cm > 500) {
        throw new PromptBuildError(`גובה לא תקין: ${m.cm}`);
      }
      const base =
        `applied only up to a height of ${m.cm} cm from the floor, ` +
        `with a clean horizontal termination line at that height`;
      if (!m.aboveTreatmentEn) return base;
      if (m.aboveTreatmentEn.length > 120) {
        throw new PromptBuildError("aboveTreatmentEn ארוך מדי");
      }
      return `${base}, and ${m.aboveTreatmentEn} above that line`;
    }
    case "stopShortOfEdge": {
      if (!Number.isInteger(m.cm) || m.cm < 1 || m.cm > 200) {
        throw new PromptBuildError(`מרחק לא תקין: ${m.cm}`);
      }
      if (!EDGE_WHITELIST.has(m.edgeEn)) {
        throw new PromptBuildError(`קצה לא מוכר: ${m.edgeEn}`);
      }
      return (
        `stopping ${m.cm} cm short of ${m.edgeEn}, ` +
        `leaving a clean uncovered margin along that edge`
      );
    }
    case "partialCoverage": {
      if (!SCOPE_WHITELIST.has(m.scopeEn)) {
        throw new PromptBuildError(`טווח כיסוי לא מוכר: ${m.scopeEn}`);
      }
      return `applied ${m.scopeEn} only, leaving the remaining surfaces unchanged`;
    }
    case "layoutDirection": {
      if (!DIRECTION_WHITELIST.has(m.directionEn)) {
        throw new PromptBuildError(`כיוון לא מוכר: ${m.directionEn}`);
      }
      return `laid ${m.directionEn}`;
    }
  }
}

function describeHe(m: Modifier): string {
  switch (m.kind) {
    case "heightLimit":
      return `עד גובה ${m.cm} ס"מ`;
    case "stopShortOfEdge":
      return `לעצור ${m.cm} ס"מ לפני הקצה`;
    case "partialCoverage":
      return "כיסוי חלקי";
    case "layoutDirection":
      return "כיוון הנחה";
    case "freeText":
      return m.rawText;
  }
}

const HEBREW = /[֐-׿]/;
const ARABIC = /[؀-ۿ]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * בונה את בקשת הרינדור מבחירות המשתמש.
 *
 * הערות טקסט חופשי חייבות להגיע עם `resolvedEn` כבר ממולא — ראו
 * note_resolver.ts. הפונקציה נכשלת אחרת, במקום לשלוח למודל טקסט
 * שהוא לא מבין.
 */
export function buildRenderJob(
  roomTypeCode: string,
  selections: SelectionInput[],
): RenderJob {
  const room = ROOMS_BY_CODE.get(roomTypeCode);
  if (!room) throw new PromptBuildError(`סוג חדר לא מוכר: ${roomTypeCode}`);
  if (!selections.length) throw new PromptBuildError("לא נבחר אף פריט");
  if (selections.length > 40) {
    throw new PromptBuildError("יותר מדי בחירות בבקשה אחת");
  }

  const prefix = room.isExterior ? PREFIX_EXTERIOR : PREFIX_INTERIOR;
  const segments: string[] = [`${prefix} ${room.labelEn}`];
  const overrides: string[] = [];
  const resolved: RenderJob["resolvedSelections"] = [];
  let hasConstructive = false;

  for (const sel of selections) {
    const item: MaterialItem | undefined = MATERIALS_BY_ID.get(sel.itemId);
    if (!item) throw new PromptBuildError(`פריט לא מוכר: ${sel.itemId}`);

    // **סשן 12:** ההגבלה "פריט הזה זמין רק בחדרים האלה" הוסרה גם כאן,
    // בהתאמה מלאה להחלטה שכבר יושמה בצד הלקוח (סשן 10,
    // MaterialItem.isAvailableIn תמיד מחזירה true) — ירון ביקש במפורש
    // שכל החומרים יהיו זמינים בכל חדר, בלי הגבלה. עד לתיקון הזה השרת
    // עדיין אכף את ההגבלה הישנה בזמן שהלקוח כבר לא, מה שגרם לכל בקשה
    // "לא שגרתית" (למשל פריט חומרי-בניין במרפסת) להיכשל עם 400
    // ("הקרדיט לא נוצל, נסה שוב") — למרות שהלקוח עצמו הרשה למשתמש
    // לבחור אותה. השדה roomTypes נשאר במודל לתיעוד בלבד, לא נאכף יותר.
    if (item.isConstructive) hasConstructive = true;
    segments.push(item.promptEn);

    const modsHe: string[] = [];
    for (const mod of sel.modifiers ?? []) {
      let clause: string;
      if (mod.kind === "freeText") {
        if (!mod.resolvedEn || !mod.resolvedEn.trim()) {
          throw new PromptBuildError(
            `הערת טקסט חופשי לפריט "${sel.itemId}" טרם עובדה`,
          );
        }
        clause = mod.resolvedEn.trim();
      } else {
        clause = constraintFromStructured(mod);
      }
      overrides.push(clause);
      modsHe.push(describeHe(mod));
    }

    resolved.push({
      id: item.id,
      labelHe: item.labelHe,
      promptEn: item.promptEn,
      modifiers: modsHe,
    });
  }

  if (overrides.length) {
    segments.push(
      "important, these requirements override the descriptions above: " +
        overrides.join("; "),
    );
  }

  // **סשן 14:** האלמנטים המוגנים (למשל יחידת סינון של ממ"ד — ראו claude/07
  // ו-claude/21) עוברים עכשיו כהוראת שימור מפורשת *בתוך* הפרומפט עצמו,
  // ולא רק כמטא-דאטה שמוחזרת ללקוח (protectedLabels למטה עדיין מוחזר,
  // לתאימות ולמסך הסיכום — אבל עד כה שום קוד לא באמת "שיחזר" אלמנט לפי
  // הרשימה הזו אחרי היצירה; זו הפעם הראשונה שהיא בפועל משפיעה על
  // התוצאה). בכוונה **צר**: רק אלמנטים רגולטוריים/מבניים קבועים, לא כל
  // חפץ בפריים — ראו הכיול המפורט ב-claude/36 (בדיקות ישירות מול ירון,
  // 6.9.2026): סחיפה קוסמטית של פרטים לא-קשורים (שלט טלוויזיה, סידור)
  // היא זניחה ותוקנת בקלות בהערת המשך; מה שבאמת קריטי הוא לא להעלים
  // בשקט אלמנט שיש לו משמעות תקנית/מקצועית.
  const protectedLabels = PROTECTED_ELEMENTS.filter(
    (p) => p.roomScopeHe === "כל החדרים" || p.roomScopeHe === room.labelHe,
  ).map((p) => p.labelEn);

  const preserveParts = [PRESERVE_BASE];
  if (protectedLabels.length) {
    preserveParts.push(
      "the following existing elements must remain fully visible and " +
        `completely unchanged: ${protectedLabels.join(", ")}`,
    );
  }
  segments.push(`important, preserve exactly: ${preserveParts.join("; ")}`);
  segments.push(QUALITY_SUFFIX);

  const prompt = segments.join(", ");

  // רשת ביטחון אחרונה: המודל מקבל אנגלית בלבד.
  if (HEBREW.test(prompt) || ARABIC.test(prompt) || CYRILLIC.test(prompt)) {
    throw new PromptBuildError(
      "הפרומפט מכיל טקסט שאינו אנגלית — לא נשלח למודל.",
    );
  }

  return {
    prompt,
    // שני השדות הבאים לא נשלחים יותר ל-Replicate (ראו ההסבר למעלה) —
    // נשארים רק כרישום ל-DB, לתאימות עם עמודות renders הקיימות.
    negativePrompt: NEGATIVE_BASE,
    promptStrength: hasConstructive ? STRENGTH_CONSTRUCTIVE : STRENGTH_SURFACE,
    guidanceScale: GUIDANCE_SCALE,
    numInferenceSteps: NUM_INFERENCE_STEPS,
    protectedLabels,
    hasConstructiveChange: hasConstructive,
    resolvedSelections: resolved,
  };
}
SHIFTEOF

echo ""
echo "✅ prompt_engine.ts עודכן (תיקון: לא להמציא ריהוט/אביזרים/ציוד חדש)."
echo "מריץ פריסה ל-generate-render..."
~/sbcli/supabase functions deploy generate-render

echo ""
echo "✅ פריסה הושלמה. אפשר לבדוק הדמיה חדשה מהאפליקציה."
echo "לוגים: https://supabase.com/dashboard/project/iywhxmuzvincfmezijtv/functions/generate-render/logs"
