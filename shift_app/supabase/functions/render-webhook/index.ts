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

