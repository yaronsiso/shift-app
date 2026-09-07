#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p supabase/functions/_shared supabase/functions/generate-render

cat > supabase/functions/_shared/prompt_engine.ts << 'SHIFTEOF1'
// מנוע הפרומפטים — צד שרת.
//
// עד סשן 14 היה זהה בלוגיקה ל-lib/features/prompt_engine/prompt_engine.dart
// שבאפליקציה. **מסשן 14 השניים הופרדו במכוון**: הקובץ הזה עודכן למעבר
// למודלי Gemini image-editing (ראו קבוצת ההערות מתחת ל-imports), אבל
// הגרסה בצד הלקוח לא עודכנה — היא ממילא לא נצרכת בשום מקום בפועל
// (RenderService.submitRender שולח רק roomTypeCode + selections, לא
// פרומפט מוכן; toReplicateInput() ב-Dart הוא קוד מת).
//
// **למה הוא קיים גם כאן:** האפליקציה לא שולחת את הפרומפט המוכן. היא שולחת
// את סוג החדר ואת רשימת מזהי הפריטים, והשרת בונה את הפרומפט בעצמו מהמילון
// שלו. אחרת כל מי שיפרק את האפליקציה יוכל לשלוח פרומפט חופשי כרצונו
// ולהשתמש בחשבון ה-Replicate שלנו לכל מטרה שהיא.
//
// הגרסה הזו (שרת) היא **הקובעת** — מה שנשלח בפועל ל-Replicate.
//
// ============================================================================
// סשן 15 — שני שינויים: (1) מעבר ל-google/nano-banana-2 (ראו index.ts),
// (2) שכתוב מבנה הפרומפט כדי לתקן "המצאת" אביזרים/ריהוט/ציוד שלא נבחרו.
// ============================================================================
// **מה קרה בפועל (7.9.2026):** ירון בחר חדר שינה + מיטה עם גומחת קיר
// מקומרת ופס לד, ולחיצת SHIFT הביאה תוצאה עם מזגן, דוד שמש וצינורות שלא
// היו בתמונה המקורית ולא נבחרו. שורש שני: (א) הוראת השימור הישנה (סשן 14)
// לא כללה שום משפט כללי "אל תוסיף שום דבר אחר" — רק שימור מבנה/פתחים
// ואלמנטים רגולטוריים ספציפיים; (ב) ההוראה ישבה **בסוף** הפרומפט, אחרי
// רשימת הפריטים שנבחרו — למודלי שפה/תמונה מבוססי-הוראה, מה שבא קודם
// מקבל בדרך כלל יותר משקל.
//
// **התיקון, שנבדק ישירות מול Gemini לפני שנכתב כאן (ולא רק תיאוריה):**
// מבנה הפרומפט שונה משרשור שטוח של "חדר + פריטים + הערת שימור בסוף"
// לשלושה בלוקים ברורים, בסדר הזה: (1) איזה חדר; (2) "שנה רק את הבאים,
// ולא כלום מעבר לזה" + רשימת הפריטים שנבחרו; (3) בלוק שימור מפורש וגדול
// שאומר איך שאר כל התמונה (כולל כל ריהוט/אביזר/ציוד קיים שלא הוזכר)
// חייבת להישאר זהה פיקסל-פיקסל, ובנוסף "אל תוסיף שום דבר חדש". ניסוח
// זה תואם גם את ההנחיה הרשמית של גוגל לעריכת תמונות (blog.google,
// "prompting-tips-nano-banana-pro"): לתאר בדיוק מה **משתנה**, לא לבקש
// הוספות — זה עוזר למודל לשמר את שאר הסצנה.

import {
  MATERIALS_BY_ID,
  ROOMS_BY_CODE,
  PROTECTED_ELEMENTS,
  type MaterialItem,
} from "./dictionary.ts";

export const GUIDANCE_SCALE = 7.5;
export const NUM_INFERENCE_STEPS = 50;
export const STRENGTH_SURFACE = 0.55;
export const STRENGTH_CONSTRUCTIVE = 0.65;
// ^ שלושת הקבועים האלה נועדו למודל דיפוזיה קלאסי (adirik/interior-design,
// המודל הישן לפני סשן 14). לאף אחד ממודלי ה-Gemini image-editing (לא
// nano-banana-pro ולא nano-banana-2) אין guidance_scale, num_inference_steps
// או prompt_strength בסכמת הקלט שלהם כלל. השארתי את הקבועים והשדות האלה
// ב-RenderJob ובטבלת renders **רק** לצורך המשכיות/דיבוג של הדמיות ישנות —
// generate-render/index.ts כבר לא שולח אותם ל-Replicate.

const PREFIX_INTERIOR =
  "A high-end photorealistic interior design render of an Israeli";
const PREFIX_EXTERIOR =
  "A high-end photorealistic exterior architectural render of an Israeli";

// נשאר קיים ומחושב כדי שעמודת renders.negative_prompt תמשיך להתמלא
// לצורכי תיעוד/דיבוג בלבד — **לא נשלח יותר ל-Replicate**.
export const NEGATIVE_BASE =
  "changing room structure, moving walls, different window positions, " +
  "distorted perspective, warped geometry, extra windows, extra doors, " +
  "mirror, mirrored, " +
  "blurry, low quality, watermark, text, cartoon, illustration";

// **סשן 15:** בלוק השימור הועבר לבוא **אחרי** תיאור השינוי (לא בסוף כל
// הפרומפט אחרי כל שאר הפרטים כמו בסשן 14), ונוסף לו משפט מפורש שאוסר
// הוספת אביזרים/ריהוט/ציוד חדש. זה הניסוח שנבדק ואומת ישירות מול Gemini
// (7.9.2026) לפני שהוכנס לכאן.
const PRESERVE_BLOCK =
  "Everything else in the photo must remain exactly, pixel-for-pixel " +
  "identical to the original photo — including the room's structure, " +
  "wall positions, window and door placement, camera perspective and " +
  "angle, floor, ceiling, all existing furniture, fixtures, appliances, " +
  "and decor not mentioned above, and every other object visible in the " +
  "original photo. Do not add any new object, furniture, appliance, " +
  "fixture, or equipment of any kind. Do not remove or move anything " +
  "that was not explicitly mentioned above. Do not add extra windows or " +
  "doors. No mirrored or flipped layout.";

const QUALITY_SUFFIX =
  "Photorealistic result, 8k resolution, architectural photography, " +
  "highly detailed, sharp focus, no watermark, no text overlay, no " +
  "illustration or cartoon style.";

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
  const itemTexts: string[] = [];
  const overrides: string[] = [];
  const resolved: RenderJob["resolvedSelections"] = [];
  let hasConstructive = false;

  for (const sel of selections) {
    const item: MaterialItem | undefined = MATERIALS_BY_ID.get(sel.itemId);
    if (!item) throw new PromptBuildError(`פריט לא מוכר: ${sel.itemId}`);

    // **סשן 12:** ההגבלה "פריט הזה זמין רק בחדרים האלה" הוסרה גם כאן,
    // בהתאמה מלאה להחלטה שכבר יושמה בצד הלקוח (סשן 10,
    // MaterialItem.isAvailableIn תמיד מחזירה true) — ירון ביקש במפורש
    // שכל החומרים יהיו זמינים בכל חדר, בלי הגבלה. השדה roomTypes נשאר
    // במודל לתיעוד בלבד, לא נאכף יותר.
    if (item.isConstructive) hasConstructive = true;
    itemTexts.push(item.promptEn);

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

  // **סשן 15 — בלוק 2: "שנה רק את הבאים, ולא כלום מעבר לזה."** זה שינוי
  // המבנה המרכזי — לפני שהיה שרשור שטוח של הפריטים בלי מסגור מפורש
  // שמדגיש שזו רשימה סגורה. הניסוח הזה נבדק ישירות מול Gemini לפני
  // שהוכנס לכאן.
  let changeBlock = `Change ONLY the following, and nothing else: ${itemTexts.join(", ")}.`;
  if (overrides.length) {
    changeBlock +=
      " important, these requirements override the descriptions above: " +
      overrides.join("; ") + ".";
  }

  // **סשן 15 — תיקון קריטי:** נמצא בבדיקה בפועל (7.9.2026) שהפרומפט הישן
  // כלל תמיד, בכל הדמיה, "must remain fully visible and completely
  // unchanged: ... air conditioning unit, water heater and exposed
  // systems" — גם כשאין בכלל מזגן/דוד שמש/צנרת גלויה בתמונה המקורית!
  // המקור: ב-claude/08 שני הפריטים האלה מתויגים "כל החדרים" עם ההערה
  // "אופציונלי — המשתמש מסמן אם ברצונו לשמר" — אבל אף פעם לא נבנה מנגנון
  // סימון כזה בממשק, וה-filter למטה כלל אותם תמיד, בלי תנאי. התוצאה:
  // הפרומפט "משכנע" את המודל שהאלמנטים האלה כבר קיימים בתמונה וחייבים
  // "להישאר גלויים" — והמודל, בהיעדרם בפועל, ממציא אותם כדי לצייתי.
  // עד שייבנה מנגנון סימון אמיתי בממשק (המשתמש מסמן בפועל "יש לי מזגן,
  // שמור עליו"), שני האלמנטים האלה מוצאים מרשימת השימור האוטומטי — הם
  // היחידים שהיו מסומנים "אופציונלי" מלכתחילה; פתחי חלונות ודלתות (וכל
  // אלמנט ספציפי-לחדר כמו יחידת סינון ממ"ד) נשארים, כי הם לא מסומנים
  // "אופציונלי" וקיימים כמעט תמיד בפועל בכל תמונת חדר.
  const NOT_ACTUALLY_UNCONDITIONAL = new Set([
    "air conditioning unit",
    "water heater and exposed systems",
  ]);
  const protectedLabels = PROTECTED_ELEMENTS.filter(
    (p) =>
      (p.roomScopeHe === "כל החדרים" || p.roomScopeHe === room.labelHe) &&
      !NOT_ACTUALLY_UNCONDITIONAL.has(p.labelEn),
  ).map((p) => p.labelEn);

  let preserveBlock = PRESERVE_BLOCK;
  if (protectedLabels.length) {
    preserveBlock +=
      " The following existing elements must remain fully visible and " +
      `completely unchanged: ${protectedLabels.join(", ")}.`;
  }

  // **סשן 15 — סדר הבלוקים החדש (נבדק מול Gemini):** (1) חדר, (2) שינוי
  // מבוקש בלבד, (3) שימור מפורש של כל השאר, (4) איכות. בסשן 14 הכל היה
  // שרשור פסיקים אחד ארוך; עכשיו זה ארבעה בלוקים ברורים שמחוברים ברווח,
  // כל אחד מסתיים בנקודה — קרוב יותר למבנה שגוגל עצמם ממליצים עליו.
  const prompt = [
    `${prefix} ${room.labelEn}.`,
    changeBlock,
    preserveBlock,
    QUALITY_SUFFIX,
  ].join(" ");

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
SHIFTEOF1

cat > supabase/functions/generate-render/index.ts << 'SHIFTEOF2'
// SHIFT — Edge Function ‏`generate-render`
//
// 🔑 **זו הנקודה היחידה במערכת שמחזיקה את מפתח ה-Replicate ואת ספירת
// הקרדיטים.** המפתח לעולם לא נמצא באפליקציה: כל מי שמוריד APK יכול לפרק
// אותו ולחלץ ממנו כל מחרוזת שמוטמעת בקוד.
//
// ============================================================================
// סשן 13 — שינוי ארכיטקטוני: מ"רקע שמחכה ל-Replicate" ל-webhook
// ============================================================================
// **הבעיה שזה פותר (התגלתה בפועל פעמיים — 3.9 ו-6.9.2026, אותה חתימה
// מדויקת: renders.status נשאר 'processing' לנצח, replicate_prediction_id
// ו-error_message נשארים ריקים):**
//
// הגרסה הקודמת (סשן 9) שלחה בקשה ל-Replicate עם `Prefer: wait` וחיכתה לה
// בתוך `EdgeRuntime.waitUntil` — כלומר "תפסה" את ה-worker פתוח כל עוד
// Replicate לא סיים. אבל בתוכנית Free של Supabase יש ל-worker תקציב חיים
// כולל של **150 שניות בלבד**, והתקציב הזה משותף לכל מה שה-worker עשה, לא
// רק לבקשה הנוכחית. ברגע שהתקציב נגמר **באמצע** ההמתנה — Supabase הורגת
// את כל ה-isolate במקום, בלי שום התראה.
//
// **הפתרון:** לא לחכות ל-Replicate בכלל. יוצרים את ה-prediction בלי
// `Prefer: wait`, שומרים את ה-`replicate_prediction_id` בטבלה **מיד**,
// ועונים ללקוח. כש-Replicate יסיימו בפועל, הם עצמם יקראו ל-webhook ייעודי
// (`render-webhook`, פונקציה נפרדת) שמעדכן את הטבלה.
//
// רשת ביטחון נוספת: מיגרציה 0006 מוסיפה `expire_stale_renders()` שרץ
// בתזמון קבוע ו"סוגר" הדמיות שנשארו תקועות מעל 10 דקות.
//
// זרימה עדכנית:
//   1. אימות המשתמש מול ה-JWT שנשלח.
//   2. ולידציה של הקלט (מזהי פריטים בלבד — לא פרומפט מוכן).
//   3. עיבוד הערות טקסט חופשי לאנגלית.
//   4. בניית הפרומפט **בשרת**, מהמילון של השרת.
//   5. צריכת קרדיט אטומית + רישום ההדמיה + קישור חתום לתמונת המקור.
//   6. יצירת ה-prediction ב-Replicate **בלי לחכות לו** + שמירת המזהה שלו.
//   7. מחזירים תשובה ללקוח — renderId + status:"processing".
//   8. (בפונקציה נפרדת, `render-webhook`) — Replicate מודיעים כשמוכן.
//
// פריסה:  supabase functions deploy generate-render
// סודות:  supabase secrets set REPLICATE_API_TOKEN=...

import { createClient } from "jsr:@supabase/supabase-js@2";
import { MATERIALS_BY_ID } from "../_shared/dictionary.ts";
import { buildRenderJob, PromptBuildError } from "../_shared/prompt_engine.ts";
import type { RenderJob, SelectionInput } from "../_shared/prompt_engine.ts";
import {
  MAX_NOTE_LENGTH,
  resolveFreeTextNotes,
} from "../_shared/note_resolver.ts";

// ============================================================================
// סשן 15 — מעבר מ-google/nano-banana-pro ל-google/nano-banana-2
// ============================================================================
// **למה:** ירון דיווח על תוצאות לא-עקביות מול nano-banana-pro (אביזרים/
// ריהוט/ציוד שלא נבחרו הופיעו בתוצאה — מזגן, דוד שמש, צינורות). בדיקה
// שלנו העלתה שני ממצאים:
//   1. גוגל שחררו מודל חדש יותר, `google/nano-banana-2` (Gemini 3.1 Flash
//      Image, 26.2.2026) — מתואר רשמית כמשלב "איכות ברמת Pro עם מהירות/
//      מחיר של Flash" ועם "instruction following חזק יותר לפרומפטים
//      מורכבים". ירון עצמו בדק ישירות מול Gemini וקיבל 10/10 תוצאות
//      מדויקות — כנראה כי אפליקציית Gemini כבר עברה למודל הזה כברירת מחדל.
//   2. גם זול יותר בכל רזולוציה: ב-1K, $0.067 לעומת $0.134 (חצי מחיר).
//   3. יש לו שדה `aspect_ratio` עם ערך מתועד `"match_input_image"` —
//      פותר סופית שאלה פתוחה מסשן 14 (האם יחס-הממדים המקורי נשמר).
// **מה לא השתנה:** כל ארכיטקטורת ה-webhook (סשן 13), זרימת הקרדיטים,
// ה-DB schema. שני המודלים אסינכרוניים ב-Replicate באותה צורה בדיוק.
// **הערה:** לסכמת nano-banana-2 (לפי התיעוד) אין `safety_filter_level`
// ואין `allow_fallback_model` כמו ל-nano-banana-pro — לכן הם לא נשלחים
// יותר בקריאה למטה, כדי לא לשלוח שדות לא-מתועדים למודל.
const REPLICATE_MODEL = "google/nano-banana-2";
const REPLICATE_VERSION = Deno.env.get("REPLICATE_MODEL_VERSION"); // ריק כברירת מחדל

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  roomTypeCode: string;
  selections: SelectionInput[];
  /** נתיב תמונת המקור ב-Storage, בתוך התיקייה של המשתמש. */
  beforeImagePath: string;
  /** שפת הממשק של הלקוח — לתיעוד בלבד. */
  languageCode?: string;
}

/** ולידציה של הקלט לפני שנוגעים בכסף או ברשת. */
function validate(body: unknown): RequestBody {
  if (typeof body !== "object" || body === null) {
    throw new PromptBuildError("גוף בקשה לא תקין");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.roomTypeCode !== "string") {
    throw new PromptBuildError("roomTypeCode חסר");
  }
  if (typeof b.beforeImagePath !== "string" || !b.beforeImagePath) {
    throw new PromptBuildError("beforeImagePath חסר");
  }
  if (!Array.isArray(b.selections) || b.selections.length === 0) {
    throw new PromptBuildError("selections חסר או ריק");
  }
  if (b.selections.length > 40) {
    throw new PromptBuildError("יותר מדי בחירות");
  }

  for (const s of b.selections) {
    if (typeof s?.itemId !== "string") {
      throw new PromptBuildError("selection ללא itemId");
    }
    for (const m of s.modifiers ?? []) {
      if (
        m?.kind === "freeText" &&
        (typeof m.rawText !== "string" || m.rawText.length > MAX_NOTE_LENGTH)
      ) {
        throw new PromptBuildError(
          `הערה חורגת מ-${MAX_NOTE_LENGTH} תווים`,
        );
      }
      // resolvedEn שמגיע מהלקוח נזרק — רק השרת ממלא אותו.
      if (m?.kind === "freeText") delete m.resolvedEn;
    }
  }

  return b as unknown as RequestBody;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const replicateToken = Deno.env.get("REPLICATE_API_TOKEN");
  if (!replicateToken) {
    console.error("REPLICATE_API_TOKEN חסר בסודות הפונקציה");
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // --- 1. אימות ---------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  // לקוח שפועל בזהות המשתמש — כך ש-RLS ו-auth.uid() חלים כרגיל.
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // --- 2. ולידציה ------------------------------------------------------
  let body: RequestBody;
  try {
    body = validate(await req.json());
  } catch (e) {
    return json({ error: "bad_request", detail: String(e) }, 400);
  }

  // התמונה חייבת לשבת בתיקייה של המשתמש עצמו.
  if (!body.beforeImagePath.startsWith(`${userId}/`)) {
    return json({ error: "forbidden_image_path" }, 403);
  }

  let renderId: string | undefined;
  let creditConsumed = false;

  try {
    // --- 3+4. עיבוד הערות ובניית הפרומפט --------------------------------
    console.log(`[${userId}] שלב 1: מתחיל עיבוד הערות ובניית פרומפט`);
    let job: RenderJob;
    try {
      const resolved = await resolveFreeTextNotes(
        body.selections,
        MATERIALS_BY_ID,
        replicateToken,
      );
      job = buildRenderJob(body.roomTypeCode, resolved);
    } catch (e) {
      if (e instanceof PromptBuildError) {
        return json({ error: "bad_selection", detail: e.message }, 400);
      }
      throw e; // שגיאה לא צפויה — תיתפס למטה.
    }
    console.log(`[${userId}] שלב 2: פרומפט נבנה בהצלחה`);

    // --- 5. צריכת קרדיט (אטומית) -----------------------------------------
    const { data: creditRows, error: creditErr } = await supabase
      .rpc("consume_render_credit");

    if (creditErr) {
      throw new Error(`consume_render_credit failed: ${creditErr.message}`);
    }
    console.log(`[${userId}] שלב 3: קרדיט נבדק/נצרך`);

    const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    if (!credit?.allowed) {
      return json({
        error: "quota_exhausted",
        reason: credit?.reason ?? "unknown",
        freeRemaining: credit?.free_remaining ?? 0,
      }, 402); // Payment Required — האפליקציה תפתח Paywall.
    }
    creditConsumed = true;

    // --- רישום ההדמיה לפני הקריאה, כדי שתמיד יהיה למה להחזיר קרדיט -------
    const { data: renderRow, error: insErr } = await supabase
      .from("renders")
      .insert({
        user_id: userId,
        room_type: body.roomTypeCode,
        category: job.prompt.includes("exterior") ? "exterior" : "interior",
        before_image_path: body.beforeImagePath,
        style_selections: job.resolvedSelections,
        prompt: job.prompt,
        negative_prompt: job.negativePrompt,
        prompt_strength: job.promptStrength,
        status: "processing",
        credit_source: credit.reason,
      })
      .select("id")
      .single();

    if (insErr || !renderRow) {
      throw new Error(`render insert failed: ${insErr?.message}`);
    }
    renderId = renderRow.id as string;
    console.log(`[${userId}] שלב 4: רשומת renders נוצרה, id=${renderId}`);

    // --- קישור חתום וזמני לתמונת המקור, כדי ש-Replicate יוכל להוריד
    // אותה מבלי שה-bucket יהיה ציבורי.
    console.log(`[${userId}] שלב 5: יוצר קישור חתום לתמונה`);
    const { data: signed, error: signErr } = await supabase.storage
      .from("renders")
      .createSignedUrl(body.beforeImagePath, 600);

    if (signErr || !signed?.signedUrl) {
      await supabase.from("renders")
        .update({ status: "failed", error_message: String(signErr) })
        .eq("id", renderId);
      await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      return json({ error: "image_url_failed", renderId }, 500);
    }
    console.log(`[${userId}] שלב 6: קישור חתום נוצר בהצלחה`);

    // --- 6. יצירת ה-prediction ב-Replicate — בלי Prefer:wait! -------------
    console.log(`[${userId}] שלב 7: יוצר prediction ב-Replicate (לא חוסם)`);
    let prediction: { id?: string; error?: unknown; status?: string };
    try {
      // מודל רשמי בלי גרסה מוצמדת → /v1/models/{owner}/{name}/predictions.
      // אם בכל זאת מוגדר REPLICATE_MODEL_VERSION → נתיב ה-/v1/predictions
      // הקלאסי עם version בגוף הבקשה.
      const replicateUrl = REPLICATE_VERSION
        ? "https://api.replicate.com/v1/predictions"
        : `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;
      const webhookUrl =
        `${supabaseUrl}/functions/v1/render-webhook?renderId=${renderId}`;
      const res = await fetch(replicateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(REPLICATE_VERSION ? { version: REPLICATE_VERSION } : {}),
          input: {
            prompt: job.prompt,
            image_input: [signed.signedUrl],
            output_format: "png",
            // **סשן 15:** "match_input_image" הוא ערך מתועד רשמית בסכמת
            // nano-banana-2 — שומר על יחס-הממדים של תמונת המקור בדיוק.
            aspect_ratio: "match_input_image",
            // אין guidance_scale/num_inference_steps/negative_prompt/
            // prompt_strength/safety_filter_level/allow_fallback_model —
            // אף אחד מהם לא בסכמת הקלט של nano-banana-2.
          },
          webhook: webhookUrl,
          webhook_events_filter: ["completed"],
        }),
      });

      prediction = await res.json();
      console.log(
        `[${userId}] שלב 8: Replicate החזיר ok=${res.ok}, status=${res.status}, prediction.id=${prediction?.id}`,
      );

      if (!res.ok || !prediction?.id) {
        await supabase.from("renders")
          .update({
            status: "failed",
            error_message: `replicate_create_failed: ${JSON.stringify(prediction).slice(0, 400)}`,
          })
          .eq("id", renderId);
        await supabase.rpc("refund_render_credit", { p_render_id: renderId });
        return json({ error: "replicate_error", renderId }, 502);
      }
    } catch (e) {
      await supabase.from("renders")
        .update({
          status: "failed",
          error_message: `replicate_unreachable: ${String(e)}`.slice(0, 500),
        })
        .eq("id", renderId);
      await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      return json({ error: "replicate_unreachable", renderId }, 502);
    }

    // --- שומרים את מזהה ה-prediction **מיד**.
    await supabase.from("renders")
      .update({ replicate_prediction_id: prediction.id })
      .eq("id", renderId);
    console.log(`[${userId}] שלב 9: replicate_prediction_id נשמר, ${prediction.id}`);

    // --- 7. עונים ללקוח --------------------------------------------------
    return json({
      renderId,
      status: "processing",
      freeRemaining: credit.free_remaining,
      creditSource: credit.reason,
      protectedElements: job.protectedLabels,
      promptStrength: job.promptStrength,
    });
  } catch (e) {
    // --- רשת הביטחון: כל שגיאה לא צפויה מגיעה לכאן ---
    const detail = e instanceof Error ? `${e.message}` : String(e);
    console.error("generate-render: uncaught error", detail, e);

    if (renderId) {
      try {
        await supabase.from("renders")
          .update({
            status: "failed",
            error_message: `internal: ${detail}`.slice(0, 500),
          })
          .eq("id", renderId);
      } catch (updateErr) {
        console.error("failed to mark render as failed", updateErr);
      }
    }

    if (creditConsumed && renderId) {
      try {
        await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      } catch (refundErr) {
        console.error("failed to refund credit", refundErr);
      }
    }

    return json({ error: "internal_error", detail, renderId }, 500);
  }
});
SHIFTEOF2

echo ""
echo "✅ שני הקבצים עודכנו: prompt_engine.ts (ניסוח משוכתב + תיקון מזגן/דוד שמש) + generate-render/index.ts (מודל: nano-banana-2)."
echo "מריץ פריסה ל-generate-render..."
~/sbcli/supabase functions deploy generate-render

echo ""
echo "✅✅ פריסה הושלמה בהצלחה — אם אתה רואה את השורה הזו, זה סימן וודאי שהקוד החדש עלה. ✅✅"
echo "עכשיו תריץ הדמיה חדשה מהאפליקציה, ואז תבדוק ב-Table Editor > renders את עמודת ה-prompt של השורה החדשה — היא אמורה להתחיל ב-'Change ONLY the following'."
echo "לוגים: https://supabase.com/dashboard/project/iywhxmuzvincfmezijtv/functions/generate-render/logs"
