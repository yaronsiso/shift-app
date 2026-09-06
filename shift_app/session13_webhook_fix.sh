#!/usr/bin/env bash
# SHIFT — סשן 13: תיקון שורש לבאג "הדמיה תקועה" (חלק 2, בצד השרת).
#
# מה זה עושה:
#   1. מחליף לגמרי את supabase/functions/generate-render/index.ts —
#      במקום לחכות ל-Replicate בתוך הפונקציה (מה שגרם לתקיעה על
#      תוכנית Free של Supabase, שם לפונקציה יש רק 150 שניות חיים
#      בסך הכל), הפונקציה עכשיו רק *מתחילה* את העבודה ועונה מיד.
#   2. יוצר פונקציה חדשה supabase/functions/render-webhook/index.ts —
#      Replicate עצמם יקראו לה כשהתמונה מוכנה.
#
# איך מריצים: להדביק את התוכן הזה לקובץ .sh חדש ב-VS Code (בתוך
# ה-Codespace), לשמור (Ctrl+S פעם אחת), ואז בטרמינל להריץ עם נתיב מלא:
#   bash /workspaces/shift-app/shift_app/session13_webhook_fix.sh
#
# ⚠️ אחרי שהסקריפט רץ, יש עוד 3 שלבים ידניים (מיגרציית SQL, סוד חדש,
# ופריסה) — הם מפורטים בהודעה בצ'אט, לא כאן.
set -e
cd /workspaces/shift-app/shift_app

mkdir -p supabase/functions/render-webhook

cat > supabase/functions/generate-render/index.ts << 'SHIFTEOF'
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

// המודל שננעל בשלב 3. ראו claude/07.
//
// סשן 8: adirik/interior-design הוא מודל קהילתי (לא רשמי) בלי גרסת "latest"
// מסומנת — קריאה דרך /v1/models/{owner}/{name}/predictions (בלי version)
// מחזירה 404. חייבים לנעול גרסה מדויקת ולקרוא ל-/v1/predictions הקלאסי.
const REPLICATE_MODEL = "adirik/interior-design";
const REPLICATE_VERSION = Deno.env.get("REPLICATE_MODEL_VERSION") ??
  "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";

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
      const replicateUrl = "https://api.replicate.com/v1/predictions";
      const webhookUrl =
        `${supabaseUrl}/functions/v1/render-webhook?renderId=${renderId}`;
      const res = await fetch(replicateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: REPLICATE_VERSION,
          input: {
            image: signed.signedUrl,
            prompt: job.prompt,
            negative_prompt: job.negativePrompt,
            prompt_strength: job.promptStrength,
            guidance_scale: job.guidanceScale,
            num_inference_steps: job.numInferenceSteps,
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
SHIFTEOF

cat > supabase/functions/render-webhook/index.ts << 'SHIFTEOF'
// SHIFT — Edge Function ‏`render-webhook`
//
// **חדש בסשן 13.** פונקציה ציבורית (בלי אימות JWT של סופאבייס — ראו
// `--no-verify-jwt` בפריסה למטה) ש-Replicate קוראים לה ישירות כשההדמיה
// שהם מייצרים הסתיימה (הצליחה או נכשלה). זה מחליף את ההמתנה החוסמת
// הישנה בתוך `generate-render` — ראו ההסבר המלא בראש הקובץ ההוא.
//
// **אבטחה:** מכיוון שזה נתיב ציבורי (חייב להיות, אחרת Replicate לא
// יכולים לקרוא לו), חובה לוודא שהבקשה **באמת** הגיעה מ-Replicate ולא
// מכל אחד אחר באינטרנט שמנחש את הכתובת. Replicate חותמים כל webhook
// בפורמט תואם-Svix (שלוש כותרות: webhook-id / webhook-timestamp /
// webhook-signature) — מאומת מול המדריך הרשמי:
// https://replicate.com/docs/topics/webhooks/verify-webhook
//
// פריסה (שימו לב לדגל, קריטי):
//   supabase functions deploy render-webhook --no-verify-jwt
// סודות נדרשים (חדש): REPLICATE_WEBHOOK_SECRET — ראו הוראות בסקריפט
// ההרצה שמלווה את הקוד הזה (fetch_webhook_secret.sh) להשגתו.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function text(body: string, status = 200) {
  return new Response(body, { status, headers: CORS });
}

/** השוואה שלא "בורחת" מוקדם — מקטינה (לא מבטלת לגמרי) חשיפה לתזמון. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * מאמת חתימת webhook תואמת-Svix של Replicate.
 * שלבים מדויקים לפי https://replicate.com/docs/topics/webhooks/verify-webhook
 */
async function verifyReplicateSignature(params: {
  webhookId: string;
  webhookTimestamp: string;
  signatureHeader: string;
  rawBody: string;
  signingSecret: string; // כולל את התחילית "whsec_"
}): Promise<{ ok: boolean; reason?: string }> {
  const { webhookId, webhookTimestamp, signatureHeader, rawBody, signingSecret } = params;

  // הגנת החזרה (replay) — דוחים חתימות ישנות/עתידיות מדי מ-5 דקות.
  const ts = Number(webhookTimestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  if (!signingSecret.startsWith("whsec_")) {
    return { ok: false, reason: "malformed_secret" };
  }
  const secretBytes = base64ToBytes(signingSecret.slice("whsec_".length));

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = bytesToBase64(digest);

  // הכותרת יכולה להכיל כמה חתימות מופרדות ברווח, כל אחת "v1,<base64>".
  const candidates = signatureHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  const matched = candidates.some((c) => safeEqual(c, expected));
  return matched ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return text("method_not_allowed", 405);

  const webhookSecret = Deno.env.get("REPLICATE_WEBHOOK_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!webhookSecret || !serviceRoleKey || !supabaseUrl) {
    console.error("render-webhook: סוד חסר (REPLICATE_WEBHOOK_SECRET / SUPABASE_SERVICE_ROLE_KEY)");
    return text("server_misconfigured", 500);
  }

  const renderId = new URL(req.url).searchParams.get("renderId");
  if (!renderId) return text("missing_render_id", 400);

  const webhookId = req.headers.get("webhook-id") ?? "";
  const webhookTimestamp = req.headers.get("webhook-timestamp") ?? "";
  const webhookSignature = req.headers.get("webhook-signature") ?? "";
  const rawBody = await req.text();

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.error(`[${renderId}] render-webhook: כותרות חתימה חסרות`);
    return text("missing_signature_headers", 401);
  }

  const verified = await verifyReplicateSignature({
    webhookId,
    webhookTimestamp,
    signatureHeader: webhookSignature,
    rawBody,
    signingSecret: webhookSecret,
  });
  if (!verified.ok) {
    console.error(`[${renderId}] render-webhook: חתימה לא תקינה (${verified.reason})`);
    return text("invalid_signature", 401);
  }

  let prediction: ReplicatePrediction;
  try {
    prediction = JSON.parse(rawBody);
  } catch {
    return text("bad_json", 400);
  }

  // לקוח עם ה-service role — פועל בלי RLS, כי אין כאן משתמש מחובר (זו
  // קריאה מ-Replicate, לא מהאפליקציה). בשימוש רק בתוך הפונקציה הזו.
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: row, error: fetchErr } = await supabase
    .from("renders")
    .select("id, user_id, status, replicate_prediction_id")
    .eq("id", renderId)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[${renderId}] render-webhook: שגיאה בשליפת השורה`, fetchErr);
    return text("db_error", 500);
  }
  if (!row) {
    console.error(`[${renderId}] render-webhook: הדמיה לא נמצאה`);
    // 200 בכוונה — אין טעם ש-Replicate ינסו שוב, השורה לא תופיע לעולם.
    return text("render_not_found", 200);
  }

  // אידמפוטנטיות: אם כבר טופלה (למשל webhook שנשלח פעמיים, או שרשת
  // הביטחון expire_stale_renders כבר סגרה אותה קודם) — לא עושים כלום שוב.
  if (row.status === "succeeded" || row.status === "failed" || row.status === "refunded") {
    return text("already_finalized", 200);
  }

  if (row.replicate_prediction_id && prediction.id &&
      row.replicate_prediction_id !== prediction.id) {
    console.error(
      `[${renderId}] render-webhook: אי-התאמת prediction id (שורה=${row.replicate_prediction_id}, webhook=${prediction.id})`,
    );
    return text("prediction_id_mismatch", 200);
  }

  const userId = row.user_id as string;

  const closeAsFailed = async (reason: string) => {
    console.log(`[${renderId}] render-webhook: סוגר כנכשל — ${reason}`);
    const { error: rpcErr } = await supabase.rpc("expire_or_fail_render", {
      p_render_id: renderId,
      p_reason: reason.slice(0, 500),
    });
    if (rpcErr) console.error(`[${renderId}] expire_or_fail_render נכשל`, rpcErr);
  };

  if (prediction.status !== "succeeded") {
    await closeAsFailed(
      `replicate_${prediction.status ?? "unknown"}: ${JSON.stringify(prediction.error ?? "").slice(0, 300)}`,
    );
    return text("ok", 200);
  }

  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!outputUrl || typeof outputUrl !== "string") {
    await closeAsFailed("no_output");
    return text("ok", 200);
  }

  // --- שמירת התוצאה ל-Storage שלנו (הקישור של Replicate פג אחרי זמן קצר) --
  try {
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) {
      await closeAsFailed(`output_download_failed: HTTP ${imgRes.status}`);
      return text("ok", 200);
    }
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const afterPath = `${userId}/${renderId}.png`;
    const { error: upErr } = await supabase.storage
      .from("renders")
      .upload(afterPath, bytes, { contentType: "image/png", upsert: true });

    if (upErr) {
      console.error(`[${renderId}] render-webhook: העלאה ל-Storage נכשלה`, upErr);
      await closeAsFailed(`storage_upload_failed: ${upErr.message}`.slice(0, 500));
      return text("ok", 200);
    }

    await supabase.from("renders").update({
      status: "succeeded",
      after_image_path: afterPath,
      replicate_prediction_id: prediction.id ?? row.replicate_prediction_id,
    }).eq("id", renderId);

    console.log(`[${renderId}] render-webhook: הדמיה הסתיימה בהצלחה`);
    return text("ok", 200);
  } catch (e) {
    console.error(`[${renderId}] render-webhook: שגיאה לא צפויה בשמירת התוצאה`, e);
    await closeAsFailed(`internal_error: ${String(e)}`.slice(0, 500));
    return text("ok", 200);
  }
});

SHIFTEOF
echo "✅ שני קבצי ה-Edge Function נכתבו. עכשיו תמשיך לפי ההוראות בצאט (SQL + סוד + פריסה)."
