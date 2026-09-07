#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app
mkdir -p supabase/functions/_shared
mkdir -p supabase/functions/generate-render

cat > supabase/functions/_shared/prompt_engine.ts << 'SHIFTEOF_PROMPTENGINE'
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
// הפרומפט הראשי: PRESERVE_BASE (מבנה/זוויות/בלי הוספת פתחים) ו-
// QUALITY_SUFFIX (איכות/בלי watermark/בלי קריקטורה). ה-constant הישן
// NEGATIVE_BASE נשאר קיים ומחושב כדי שעמודת renders.negative_prompt תמשיך
// להתמלא לצורכי תיעוד/דיבוג — אבל **הוא לא נשלח יותר ל-Replicate**.
export const NEGATIVE_BASE =
  "changing room structure, moving walls, different window positions, " +
  "distorted perspective, warped geometry, extra windows, extra doors, " +
  "mirror, mirrored, " +
  "blurry, low quality, watermark, text, cartoon, illustration";

const PRESERVE_BASE =
  "the room's structure, wall positions, window and door placement, and " +
  "camera perspective must stay exactly identical to the original photo; " +
  "do not add extra windows or doors; no mirrored or flipped layout";

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
SHIFTEOF_PROMPTENGINE

cat > supabase/functions/generate-render/index.ts << 'SHIFTEOF_GENERATERENDER'
// SHIFT — Edge Function ‏`generate-render`
//
// 🔑 **זו הנקודה היחידה במערכת שמחזיקה את מפתח ה-Replicate ואת ספירת
// הקרדיטים.** המפתח לעולם לא נמצא באפליקציה: כל מי שמוריד APK יכול לפרק
// אותו ולחלץ ממנו כל מחרוזת שמוטמעת בקוד.
//
// ============================================================================
// סשן 13 — שינוי ארכיטקטוני שני: מ"רקע שמחכה ל-Replicate" ל-webhook
// ============================================================================
// **הבעיה שזה פותר (התגלתה בפועל פעמיים — 3.9 ו-6.9.2026, אותה חתימה
// מדויקת: renders.status נשאר 'processing' לנצח, replicate_prediction_id
// ו-error_message נשארים ריקים):**
//
// הגרסה הקודמת (סשן 9) שלחה בקשה ל-Replicate עם `Prefer: wait` וחיכתה לה
// בתוך `EdgeRuntime.waitUntil` — כלומר "תפסה" את ה-worker פתוח כל עוד
// Replicate לא סיים. אבל בתוכנית Free של Supabase יש ל-worker תקציב חיים
// כולל של **150 שניות בלבד** (`https://supabase.com/docs/guides/functions/limits`),
// והתקציב הזה משותף לכל מה שה-worker עשה, לא רק לבקשה הנוכחית. ברגע
// שהתקציב נגמר **באמצע** ההמתנה — Supabase הורגת את כל ה-isolate במקום,
// בלי שום התראה, בלי שה-`try`/`catch` שלנו מקבל אפילו הזדמנות לרוץ. זה
// בדיוק ההסבר לחתימה שראינו: שום דבר לא הספיק להירשם, כי שום קוד לא
// הספיק לרוץ.
//
// **הפתרון:** לא לחכות ל-Replicate בכלל. יוצרים את ה-prediction בלי
// `Prefer: wait` (Replicate מחזירים תשובה תוך שבריר שנייה עם `id` בלבד —
// אומת מול `https://replicate.com/changelog/2024-10-09-synchronous-api`),
// שומרים את ה-`replicate_prediction_id` בטבלה **מיד**, ועונים ללקוח.
// שום עיבוד רקע לא נשאר תלוי בזמן החיים של ה-worker הזה יותר. כש-
// Replicate יסיימו בפועל (כמה זמן שזה ייקח), הם עצמם יקראו ל-webhook
// ייעודי (`render-webhook`, פונקציה נפרדת) שמעדכן את הטבלה — לא אנחנו
// מחכים להם, הם "מתקשרים חזרה" אלינו.
//
// רשת ביטחון נוספת (למקרה הנדיר שה-webhook עצמו לא יגיע מסיבה כלשהי):
// מיגרציה 0006 מוסיפה `expire_stale_renders()` שרץ בתזמון קבוע ו"סוגר"
// הדמיות שנשארו תקועות מעל 10 דקות.
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
// סשן 14 — מעבר מ-adirik/interior-design ל-google/nano-banana-pro
// ============================================================================
// **למה:** בדיקות ישירות שירון עשה מול Nano Banana (Pro) על תמונות אמיתיות
// של הבית שלו (ראו claude/36) הראו רמת נאמנות, שימור מבנה/זווית ויכולת
// לבצע כמה שינויים מורכבים בו-זמנית שגבוהה משמעותית ממה ש-adirik/
// interior-design (מודל דיפוזיה קהילתי) נתן. אחרי אישור מפורש של ירון
// (6.9.2026, "נלך על ננו בננה פרו") — זה המודל הנעול החדש.
//
// **מה השתנה בפועל בקריאה ל-Replicate (למטה):**
//   - `image` (מחרוזת בודדת) → `image_input` (מערך של עד 14 תמונות; כאן
//     תמיד תמונה אחת: [signedUrl]).
//   - `negative_prompt` / `prompt_strength` / `guidance_scale` /
//     `num_inference_steps` — כולם מושגים ספציפיים למודלי דיפוזיה, ול-
//     Nano Banana Pro אין אותם בסכמת הקלט בכלל. ה"נגטיב" תורגם להוראת
//     שימור בתוך הפרומפט עצמו — ראו PRESERVE_BASE/QUALITY_SUFFIX ב-
//     _shared/prompt_engine.ts. שדות אלה עדיין מחושבים ונשמרים ב-DB
//     (renders.negative_prompt / prompt_strength) לתיעוד בלבד — לא
//     מצורפים יותר ל-input למטה.
//   - נוסף `safety_filter_level: "block_only_high"` — הרמה הכי פחות
//     מגבילה שהמודל תומך בה. תמונות בית אמיתיות (חדרי ילדים, אנשים
//     שנקלעו לפריים) לא אמורות להיחסם בטעות; חוסם רק תוכן ברמת חומרה
//     גבוהה.
//   - **לא נשלח `aspect_ratio` בכוונה.** לפי בדיקת התיעוד של Replicate
//     ל-Nano Banana Pro (llms.txt הרשמי + מדריכי API של גוגל ל-Gemini
//     image editing): כשמדובר בעריכת-תמונה (יש image_input) ומשמיטים את
//     aspect_ratio, המודל אמור לשמר את יחס-הממדים של תמונת המקור
//     אוטומטית — בדיוק ההתנהגות שירון ראה וביקש ב-Gemini ישירות. **טרם
//     אומת בפועל מול ה-API האמיתי** (אין גישת רשת ל-api.replicate.com
//     מסביבת הענן הזו) — זו הבדיקה הראשונה שצריך להריץ ב-Codespace.
//     אם התוצאה חוזרת בפרופורציה שגויה/חתוכה: ראשית לבדוק בעמוד ה-API
//     של המודל ב-Replicate (לשונית "API") מה הערך המדויק לאופציה
//     "match input image" ברשימת aspect_ratio, ולהוסיף אותו כאן במפורש.
//
// **מה לא השתנה בכלל:** כל ארכיטקטורת ה-webhook (סשן 13), זרימת הקרדיטים,
// ה-DB schema, החתימה של render-webhook. Nano Banana Pro הוא עדיין מודל
// אסינכרוני ב-Replicate (יוצר prediction, מחזיר מיד, קורא ל-webhook
// כשמוכן) — בדיוק כמו adirik, אין צורך בשינוי שם.
//
// **מודל רשמי של גוגל (לא קהילתי כמו adirik) — ככל הנראה יש לו גרסת
// "latest" תקנית**, ולכן ברירת המחדל כאן היא לקרוא בלי version מוצמד
// (endpoint /v1/models/{owner}/{name}/predictions). אם זה נכשל (404/422)
// בבדיקה הראשונה ב-Codespace — אפשר להצמיד גרסה מדויקת דרך הסוד
// REPLICATE_MODEL_VERSION (בדיוק כפי שהיה נחוץ ל-adirik), והקוד למטה
// כבר תומך בשני המקרים.
const REPLICATE_MODEL = "google/nano-banana-pro";
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
    // בלי הכותרת הזו, Replicate מחזירים תשובה תוך שבריר שנייה עם `id`
    // בלבד (סטטוס "starting"), ומודיעים לנו על הסיום דרך ה-webhook
    // (`render-webhook`, פונקציה נפרדת) — ראו ההסבר המלא בראש הקובץ.
    // ה-webhook_events_filter מבקש הודעה **רק** כשהעבודה הסתיימה (הצליחה
    // או נכשלה) — לא על כל עדכון ביניים.
    console.log(`[${userId}] שלב 7: יוצר prediction ב-Replicate (לא חוסם)`);
    let prediction: { id?: string; error?: unknown; status?: string };
    try {
      // מודל רשמי בלי גרסה מוצמדת → /v1/models/{owner}/{name}/predictions.
      // אם בכל זאת מוגדר REPLICATE_MODEL_VERSION (ראו הערה למעלה) → נתיב
      // ה-/v1/predictions הקלאסי עם version בגוף הבקשה, בדיוק כמו ב-adirik.
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
            safety_filter_level: "block_only_high",
            // aspect_ratio נמנע בכוונה — ראו ההסבר המלא למעלה. אין guidance_scale/
            // num_inference_steps/negative_prompt/prompt_strength — Nano Banana
            // Pro לא תומך בהם.
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

    // --- שומרים את מזהה ה-prediction **מיד** — גם אם שום דבר אחר לא
    // יקרה יותר, לפחות יש לנו עקבה מלאה למה שקרה (לצורך דיבוג עתידי,
    // ולצורך ההתאמה מול ה-webhook כשהוא יגיע).
    await supabase.from("renders")
      .update({ replicate_prediction_id: prediction.id })
      .eq("id", renderId);
    console.log(`[${userId}] שלב 9: replicate_prediction_id נשמר, ${prediction.id}`);

    // --- 7. עונים ללקוח --------------------------------------------------
    // שום עיבוד רקע לא ממתין יותר לאחר השורה הזו — הפונקציה הזו מסתיימת
    // כאן. Replicate יקראו ל-render-webhook כשהתמונה תהיה מוכנה (או
    // כשתיכשל), לא משנה כמה זמן זה ייקח.
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
SHIFTEOF_GENERATERENDER

echo ""
echo "✅ שני הקבצים נכתבו בהצלחה:"
echo "   supabase/functions/_shared/prompt_engine.ts"
echo "   supabase/functions/generate-render/index.ts"
echo ""
echo "עכשיו פורסים:"
echo "   ~/sbcli/supabase functions deploy generate-render"
