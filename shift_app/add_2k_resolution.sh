#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

mkdir -p supabase/functions/generate-render

cat > supabase/functions/generate-render/index.ts << 'SHIFTEOF'
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
            // **סשן 15 (המשך, אחרי אישור ירון על התוצאה הראשונה):** ברירת
            // המחדל (1K) יצאה קצת רכה/לא חדה. 2K עולה ~50% יותר ($0.101
            // לעומת $0.067 ב-1K) אבל נותנת חדות משמעותית יותר — ירון אישר
            // את הפשרה הזו במפורש. אם יתברר שגם 2K לא מספיק חד — 4K קיים
            // כאופציה ($0.151), עדיין זול מ-nano-banana-pro ב-1K ($0.134).
            resolution: "2K",
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
SHIFTEOF

echo ""
echo "✅ generate-render/index.ts עודכן (resolution: 2K). מריץ פריסה..."
~/sbcli/supabase functions deploy generate-render

echo ""
echo "✅✅ פריסה הושלמה בהצלחה — עכשיו תריץ הדמיה חדשה ותבדוק את החדות. ✅✅"
