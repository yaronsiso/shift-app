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

  // --- 3+4. עיבוד הערות ובניית הפרומפט --------------------------------
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
    console.error("prompt build failed", e);
    return json({ error: "prompt_build_failed" }, 500);
  }

  // --- 5. צריכת קרדיט (אטומית) -----------------------------------------
  const { data: creditRows, error: creditErr } = await supabase
    .rpc("consume_render_credit");

  if (creditErr) {
    console.error("consume_render_credit failed", creditErr);
    return json({ error: "credit_check_failed" }, 500);
  }

  const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
  if (!credit?.allowed) {
    return json({
      error: "quota_exhausted",
      reason: credit?.reason ?? "unknown",
      freeRemaining: credit?.free_remaining ?? 0,
    }, 402); // Payment Required — האפליקציה תפתח Paywall.
  }

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
    console.error("render insert failed", insErr);
    return json({ error: "render_record_failed" }, 500);
  }
  const renderId = renderRow.id as string;

  const fail = async (code: string, detail?: string, status = 502) => {
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
  const { data: signed, error: signErr } = await supabase.storage
    .from("renders")
    .createSignedUrl(body.beforeImagePath, 600);

  if (signErr || !signed?.signedUrl) {
    return await fail("image_url_failed", String(signErr), 500);
  }

  let prediction;
  try {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        ...(REPLICATE_VERSION
          ? { version: REPLICATE_VERSION }
          : { model: REPLICATE_MODEL }),
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

    if (!res.ok) {
      return await fail("replicate_error", await res.text());
    }
    prediction = await res.json();
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
});
