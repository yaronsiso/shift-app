// מנוע הפרומפטים — צד שרת.
//
// זהה בלוגיקה ל-lib/features/prompt_engine/prompt_engine.dart שבאפליקציה.
//
// **למה הוא קיים גם כאן:** האפליקציה לא שולחת את הפרומפט המוכן. היא שולחת
// את סוג החדר ואת רשימת מזהי הפריטים, והשרת בונה את הפרומפט בעצמו מהמילון
// שלו. אחרת כל מי שיפרק את האפליקציה יוכל לשלוח פרומפט חופשי כרצונו
// ולהשתמש בחשבון ה-Replicate שלנו לכל מטרה שהיא.
//
// הגרסה שבאפליקציה משמשת לתצוגה מקדימה למשתמש בלבד. **הגרסה הזו היא
// הקובעת.**

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

const PREFIX_INTERIOR =
  "A high-end photorealistic interior design render of an Israeli";
const PREFIX_EXTERIOR =
  "A high-end photorealistic exterior architectural render of an Israeli";
const SUFFIX = "8k resolution, architectural photography, highly detailed";

export const NEGATIVE_BASE =
  "changing room structure, moving walls, different window positions, " +
  "distorted perspective, warped geometry, extra windows, extra doors, " +
  "mirror, mirrored, " +
  "blurry, low quality, watermark, text, cartoon, illustration";

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

    // הפריט חייב להיות רלוונטי לחדר שנבחר — מונע פרומפטים חסרי היגיון
    // כמו "אסלה תלויה" בחזית הבית.
    if (!item.roomTypes.includes(roomTypeCode)) {
      throw new PromptBuildError(
        `הפריט "${sel.itemId}" אינו זמין בסוג החדר "${roomTypeCode}"`,
      );
    }

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
  segments.push(SUFFIX);

  const prompt = segments.join(", ");

  // רשת ביטחון אחרונה: המודל מקבל אנגלית בלבד.
  if (HEBREW.test(prompt) || ARABIC.test(prompt) || CYRILLIC.test(prompt)) {
    throw new PromptBuildError(
      "הפרומפט מכיל טקסט שאינו אנגלית — לא נשלח למודל.",
    );
  }

  return {
    prompt,
    negativePrompt: NEGATIVE_BASE,
    promptStrength: hasConstructive ? STRENGTH_CONSTRUCTIVE : STRENGTH_SURFACE,
    guidanceScale: GUIDANCE_SCALE,
    numInferenceSteps: NUM_INFERENCE_STEPS,
    protectedLabels: PROTECTED_ELEMENTS.filter(
      (p) => p.roomScopeHe === "כל החדרים" || p.roomScopeHe === room.labelHe,
    ).map((p) => p.labelEn),
    hasConstructiveChange: hasConstructive,
    resolvedSelections: resolved,
  };
}
