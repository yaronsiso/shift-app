// עיבוד הערות טקסט חופשי — צד שרת בלבד.
//
// האפליקציה כולה בעברית (וגם ערבית ורוסית), אבל מודל התמונה מקבל אנגלית
// בלבד. הערות מובנות (גובה, עצירה לפני הקצה וכו') כבר מנוסחות באנגלית
// באפליקציה בלי שום קריאת רשת. הקובץ הזה מטפל רק בטקסט החופשי.
//
// שים לב לניסוח ההנחיה: אנחנו **לא מבקשים תרגום מילולי**. תרגום מילולי של
// "רק עד גובה מטר" נותן "only up to one meter" — משפט תלוש שהמודל הגרפי לא
// יודע למה לקשר. אנחנו מבקשים ניסוח מחדש כאילוץ מרחבי מפורש.

import type { MaterialItem } from "./dictionary.ts";
import type { Modifier } from "./prompt_engine.ts";

const SYSTEM_PROMPT = `
You convert a renovation customer's free-text note into a single precise
English constraint for an image-generation prompt.

You will be given:
- ITEM: the English description of a material or fixture the customer chose.
- NOTE: the customer's note, written in their own language (Hebrew, Arabic,
  Russian or English).

Rules:
1. Output ONE English clause. No preamble, no explanation, no quotes.
2. Write it as a spatial instruction a renderer can follow: state where the
   material starts and stops, in what orientation, or on which surfaces.
   Convert vague wording into concrete geometry wherever the note allows.
3. Convert all measurements to centimetres and state them explicitly.
4. If the note CONTRADICTS part of the ITEM description, your clause must
   clearly override that part. Phrase it so the override is unambiguous.
5. Never invent materials, colours, fixtures or design elements the customer
   did not mention. Constrain only what the note is about.
6. If the note is unclear, empty, or is not a spatial/material instruction at
   all, output exactly: SKIP

Examples:

ITEM: full-height wall cladding to the ceiling with large 120x240cm tiles in dark tones
NOTE: רק עד גובה מטר מהרצפה, מעל זה צבע לבן
OUTPUT: the wall cladding applied only up to a height of 100 cm from the floor, terminating in a clean horizontal line, with plain white paint on the wall surface above that line

ITEM: large format 120x120cm porcelain floor tiles with minimal grout lines
NOTE: שהריצוף יעצור עשרה סנטימטר לפני סוף הקיר
OUTPUT: the floor tiling stopping 10 cm short of the wall, leaving a clean uncovered margin strip along the wall edge

ITEM: feature wall with evenly spaced vertical oak wood slats
NOTE: רק על הקיר מאחורי הטלוויזיה, לא על כל הקירות
OUTPUT: the oak slat cladding applied only to the single wall behind the television, leaving all other walls unchanged

ITEM: simple flat-profile white polymer skirting baseboard
NOTE: פנלים של 7 סנטימטר
OUTPUT: the skirting baseboard exactly 7 cm in height
`.trim();

/** תקרת אורך על הערת לקוח — מונעת ניצול השדה להזרקת פרומפט ארוך. */
export const MAX_NOTE_LENGTH = 300;

const MODEL = Deno.env.get("NOTE_RESOLVER_MODEL") ??
  "meta/meta-llama-3-70b-instruct";

/**
 * שולח הערה אחת לניסוח מחדש. משתמש באותו חשבון Replicate — כדי שירון
 * לא יצטרך לפתוח חשבון נוסף ולנהל מפתח שני.
 *
 * מחזיר `null` אם ההערה לא ניתנת לניסוח (המודל החזיר SKIP) — במקרה כזה
 * פשוט מתעלמים ממנה במקום להיכשל, כי ההדמיה עדיין תקפה בלעדיה.
 */
async function resolveOne(
  item: MaterialItem,
  rawText: string,
  replicateToken: string,
): Promise<string | null> {
  const note = rawText.trim().slice(0, MAX_NOTE_LENGTH);
  if (!note) return null;

  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      model: MODEL,
      input: {
        system_prompt: SYSTEM_PROMPT,
        prompt: `ITEM: ${item.promptEn}\nNOTE: ${note}\nOUTPUT:`,
        max_tokens: 160,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    // כישלון בעיבוד הערה לא מפיל את כל ההדמיה — מוותרים על ההערה בלבד.
    console.error("note resolver failed", res.status, await res.text());
    return null;
  }

  const body = await res.json();
  const out = Array.isArray(body?.output)
    ? body.output.join("")
    : String(body?.output ?? "");
  const clause = out.trim().replace(/^["']|["']$/g, "");

  if (!clause || clause === "SKIP") return null;
  // אם המודל בכל זאת החזיר טקסט לא-אנגלי — פוסלים.
  if (/[֐-׿؀-ۿЀ-ӿ]/.test(clause)) return null;
  return clause.slice(0, 400);
}

/**
 * מעבד את כל הערות הטקסט החופשי שבבחירות ומחזיר אותן מנוסחות באנגלית.
 * שינויים מובנים עוברים כמו שהם — הם לא דורשים שום קריאת רשת.
 */
export async function resolveFreeTextNotes(
  selections: { itemId: string; modifiers?: Modifier[] }[],
  itemsById: Map<string, MaterialItem>,
  replicateToken: string,
): Promise<{ itemId: string; modifiers?: Modifier[] }[]> {
  const out = [];

  for (const sel of selections) {
    const mods = sel.modifiers ?? [];
    if (!mods.some((m) => m.kind === "freeText")) {
      out.push(sel);
      continue;
    }

    const item = itemsById.get(sel.itemId);
    if (!item) {
      out.push(sel);
      continue;
    }

    const resolvedMods: Modifier[] = [];
    for (const m of mods) {
      if (m.kind !== "freeText") {
        resolvedMods.push(m);
        continue;
      }
      const clause = await resolveOne(item, m.rawText, replicateToken);
      if (clause) resolvedMods.push({ ...m, resolvedEn: clause });
      // אם לא הצליח — ההערה נשמטת, ההדמיה ממשיכה בלעדיה.
    }
    out.push({ ...sel, modifiers: resolvedMods });
  }

  return out;
}
