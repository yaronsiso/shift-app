#!/usr/bin/env bash
set -e

echo "== שלב 1: מתקן את קריאת ה-API ל-Replicate =="
cd /workspaces/shift-app/shift_app_stage5

cat > supabase/functions/generate-render/index.ts << 'TS_EOF'
// SHIFT — Edge Function ‏`generate-render`
//
// ‏🔑 **זו הנקודה היחידה במערכת שמחזיקה את מפתח ה-Replicate ואת ספירת
// הקרדיטים.** המפתח לעולם לא נמצא באפליקציה: כל מי שמוריד APK יכול לפרק
// אותו ולחלץ ממנו כל מחרוזת שמוטמעת בקוד.
//
// זרימה:
//   1. אימות המשתמש מול ה-JWT שנשלח.
//   2. ולידציה של הקלט (מזהי פריטים בלבד — לא פרומפט מוכן).
//   3. עיבוד הערות טקסט חופשי לאנגלית.
//   4. בניית הפרומפט **בשרת**, מהמילון של השרת.
//   5. צריכת קרדיט אטומית.
//   6. קריאה ל-Replicate.
//   7. שמירת התוצאה; בכישלון — החזר קרדיט.
//
// פריסה:  supabase functions deploy generate-render
// סודות:  supabase secrets set REPLICATE_API_TOKEN=...
//
// סשן 8: תוקן באג קריטי — כשל בלתי-צפוי (לא אחת מהשגיאות המוכרות למעלה)
// היה משאיר רשומה תקועה לנצח על status="processing" בלי שום error_message,
// כי שום דבר לא היה עוטף את השלבים "צריכת קרדיט → רישום ההדמיה → יצירת
// קישור חתום" ברשת ביטחון. עכשיו כל מה שאחרי הוולידציה עטוף ב-try/catch
// חיצוני אחד: כל שגיאה לא צפויה תירשם ביומן, תסמן את הרשומה כ-failed עם
// פירוט השגיאה האמיתי, ותחזיר קרדיט אם כבר נצרך — כדי שלעולם לא נישאר
// שוב בלי לדעת מה קרה.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { MATERIALS_BY_ID } from "../_shared/dictionary.ts";
import { buildRenderJob, PromptBuildError } from "../_shared/prompt_engine.ts";
import type { SelectionInput } from "../_shared/prompt_engine.ts";
import {
  MAX_NOTE_LENGTH,
  resolveFreeTextNotes,
} from "../_shared/note_resolver.ts";

// המודל שננעל בשלב 3. ראו claude/07.
const REPLICATE_MODEL = "adirik/interior-design";
const REPLICATE_VERSION = Deno.env.get("REPLICATE_MODEL_VERSION") ?? "";

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

  // --- 1. אימות ---------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  // לקוח שפועל בזהות המשתמש — כך ש-RLS ו-auth.uid() חלים כרגיל.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
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

  // --- מכאן ואילך: רשת ביטחון אחת סביב כל השלבים שנוגעים בכסף/ברשת -----
  // אם משהו לא צפוי ייזרק בכל שלב שלמטה (ולא נתפס כבר ספציפית), הוא
  // ייתפס ב-catch החיצוני, יירשם ביומן, יסמן את הרשומה כנכשלת (אם כבר
  // נוצרה), ויחזיר קרדיט (אם כבר נצרך) — במקום להשאיר הכל תקוע.
  let renderId: string | undefined;
  let creditConsumed = false;

  try {
    // --- 3+4. עיבוד הערות ובניית הפרומפט --------------------------------
    console.log(`[${userId}] שלב 1: מתחיל עיבוד הערות ובניית פרומפט`);
    let job;
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

    const fail = async (code: string, detail?: string, status = 502) => {
      console.log(`[${userId}] נכשל בקוד ${code}: ${detail}`);
      await supabase.from("renders")
        .update({ status: "failed", error_message: detail ?? code })
        .eq("id", renderId);
      // החזר קרדיט — הכישלון אינו באשמת המשתמש.
      await supabase.rpc("refund_render_credit", { p_render_id: renderId });
      return json({ error: code, detail, renderId }, status);
    };

    // --- 6. קריאה ל-Replicate --------------------------------------------
    // כתובת חתומה וזמנית לתמונת המקור, כדי ש-Replicate יוכל להוריד אותה
    // מבלי שה-bucket יהיה ציבורי.
    console.log(`[${userId}] שלב 5: יוצר קישור חתום לתמונה`);
    const { data: signed, error: signErr } = await supabase.storage
      .from("renders")
      .createSignedUrl(body.beforeImagePath, 600);

    if (signErr || !signed?.signedUrl) {
      return await fail("image_url_failed", String(signErr), 500);
    }
    console.log(`[${userId}] שלב 6: קישור חתום נוצר בהצלחה`);

    let prediction;
    try {
      console.log(`[${userId}] שלב 7: שולח בקשה ל-Replicate...`);
      // סשן 8: ל-Replicate יש שתי דרכים שונות ליצור prediction, ואסור לערבב
      // ביניהן:
      //   1) POST /v1/predictions + שדה "version" (hash מדויק של גרסת מודל).
      //   2) POST /v1/models/{owner}/{name}/predictions בלי version בכלל —
      //      Replicate מריץ אוטומטית את הגרסה העדכנית ביותר של המודל.
      // הקוד הישן שלח ל-(1) עם שדה "model" (לא "version") כשלא היה
      // REPLICATE_MODEL_VERSION מוגדר — Replicate דוחה את זה עכשיו בפירוש
      // (422: "version is required" + "Additional property model is not
      // allowed"). זו בדיוק השגיאה שגילינו בבדיקה האחרונה. עוברים ל-(2)
      // כברירת מחדל — אין יותר צורך לנהל hash של גרסה בכלל — ושומרים את
      // (1) כאפשרות מפורשת אם מישהו כן ירצה לנעול גרסה ספציפית בעתיד.
      const replicateUrl = REPLICATE_VERSION
        ? "https://api.replicate.com/v1/predictions"
        : `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;
      const res = await fetch(replicateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          ...(REPLICATE_VERSION ? { version: REPLICATE_VERSION } : {}),
          input: {
            image: signed.signedUrl,
            prompt: job.prompt,
            negative_prompt: job.negativePrompt,
            prompt_strength: job.promptStrength,
            guidance_scale: job.guidanceScale,
            num_inference_steps: job.numInferenceSteps,
          },
        }),
      });

      console.log(`[${userId}] שלב 8: קיבל תשובה מ-Replicate, ok=${res.ok}, status=${res.status}`);
      if (!res.ok) {
        return await fail("replicate_error", await res.text());
      }
      prediction = await res.json();
      console.log(`[${userId}] שלב 9: JSON נפרס, prediction.status=${prediction?.status}`);
    } catch (e) {
      return await fail("replicate_unreachable", String(e));
    }

    if (prediction?.status === "failed" || prediction?.error) {
      return await fail("generation_failed", String(prediction?.error ?? ""));
    }

    const outputUrl = Array.isArray(prediction?.output)
      ? prediction.output[0]
      : prediction?.output;

    if (!outputUrl) {
      return await fail("no_output", "המודל לא החזיר תמונה");
    }

    // --- 7. שמירת התוצאה --------------------------------------------------
    // מורידים את התמונה ל-Storage שלנו: הקישור של Replicate פג אחרי זמן קצר.
    let afterPath: string | null = null;
    try {
      const imgRes = await fetch(outputUrl);
      if (imgRes.ok) {
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        afterPath = `${userId}/${renderId}.png`;
        const { error: upErr } = await supabase.storage
          .from("renders")
          .upload(afterPath, bytes, {
            contentType: "image/png",
            upsert: true,
          });
        if (upErr) {
          console.error("upload failed", upErr);
          afterPath = null;
        }
      }
    } catch (e) {
      console.error("could not persist output image", e);
    }

    await supabase.from("renders").update({
      status: "succeeded",
      after_image_path: afterPath,
      replicate_prediction_id: prediction?.id ?? null,
    }).eq("id", renderId);

    return json({
      renderId,
      afterImagePath: afterPath,
      // גיבוי זמני למקרה שההעלאה ל-Storage נכשלה.
      outputUrl: afterPath ? null : outputUrl,
      freeRemaining: credit.free_remaining,
      creditSource: credit.reason,
      protectedElements: job.protectedLabels,
      promptStrength: job.promptStrength,
    });
  } catch (e) {
    // --- רשת הביטחון: כל שגיאה לא צפויה מגיעה לכאן -----------------------
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
TS_EOF

cat > supabase/functions/_shared/note_resolver.ts << 'NR_EOF'
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

  // סשן 8: אותו תיקון כמו ב-generate-render/index.ts — Replicate דוחה
  // עכשיו שדה "model" בגוף הבקשה ל-/v1/predictions. קוראים דרך
  // /v1/models/{owner}/{name}/predictions במקום, בלי version בכלל.
  const res = await fetch(
    `https://api.replicate.com/v1/models/${MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          system_prompt: SYSTEM_PROMPT,
          prompt: `ITEM: ${item.promptEn}\nNOTE: ${note}\nOUTPUT:`,
          max_tokens: 160,
          temperature: 0.1,
        },
      }),
    },
  );

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
NR_EOF

echo "✅ הקבצים עודכנו."

echo ""
echo "== שלב 2: שמירת השינוי ב-git =="
cd /workspaces/shift-app
git add shift_app_stage5/supabase/functions/generate-render/index.ts shift_app_stage5/supabase/functions/_shared/note_resolver.ts
git commit -m "fix(replicate): call /v1/models/{owner}/{name}/predictions instead of /v1/predictions with a bare model field

The diagnostic logging from the previous deploy found the real root cause:
Replicate's API now rejects our request with 422 'version is required' +
'Additional property model is not allowed'. We were POSTing to
/v1/predictions with a \"model\" field in the body when no
REPLICATE_MODEL_VERSION secret was set -- but that endpoint only accepts a
pinned \"version\" hash, never a bare model name. Since no version secret
was ever configured, every real invocation hit this and got killed by the
platform before any of our own error handling could run (which also
explains why nothing showed up in Replicate's own prediction history).

Fix: call POST /v1/models/{owner}/{name}/predictions instead, which runs
the latest published version of the named model directly, with no version
hash to track or configure at all. Applied to both generate-render (the
image model) and note_resolver (the free-text note rewriting model), which
had the identical bug.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W3TMFTUyNnBNVSFhLxGn9F" || echo "(אין שינוי חדש לשמור — ממשיכים)"
git push origin main
echo "✅ נשמר ונדחף ל-GitHub."

echo ""
echo "== שלב 3: פריסת הפונקציה המעודכנת ל-Supabase =="
cd /workspaces/shift-app/shift_app_stage5

if [ ! -x ~/sbcli/supabase ]; then
  echo "מוריד את כלי ה-CLI של Supabase..."
  mkdir -p ~/sbcli
  curl -sL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz -C ~/sbcli
fi

~/sbcli/supabase --version

echo ""
echo "מנסה לפרוס..."
if ~/sbcli/supabase functions deploy generate-render --project-ref iywhxmuzvincfmezijtv --use-api; then
  echo ""
  echo "✅✅✅ הפונקציה נפרסה בהצלחה! אפשר לבקש מאמא לנסות שוב פעם אחת."
else
  echo ""
  echo "⚠️  הפריסה נכשלה — כנראה צריך להתחבר מחדש ל-Supabase CLI."
  echo "תריץ את הפקודה הזו בנפרד:"
  echo ""
  echo "    ~/sbcli/supabase login"
  echo ""
  echo "ואז תריץ שוב את הפקודה הזו:"
  echo ""
  echo "    ~/sbcli/supabase functions deploy generate-render --project-ref iywhxmuzvincfmezijtv --use-api"
  echo ""
fi
