#!/usr/bin/env bash
set -e

echo "== שלב 1: נועל גרסת מודל מדויקת ל-Replicate =="
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
//
// סשן 8: adirik/interior-design הוא מודל קהילתי (לא רשמי) בלי גרסת "latest"
// מסומנת — קריאה דרך /v1/models/{owner}/{name}/predictions (בלי version)
// מחזירה 404. חייבים לנעול גרסה מדויקת ולקרוא ל-/v1/predictions הקלאסי.
// ברירת המחדל למטה היא מחרוזת ה-version המדויקת שמופיעה בדוגמת ה-HTTP
// הרשמית בעמוד replicate.com/adirik/interior-design (אומת ידנית ב-3.9.2026
// אחרי שהגרסה הקודמת חדלה לעבוד) — אפשר לדרוס אותה בעתיד עם הסוד
// REPLICATE_MODEL_VERSION בלי לגעת בקוד, אם Replicate יפרסמו גרסה חדשה.
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
      // סשן 8: ל-Replicate יש שתי דרכים ליצור prediction: (1) POST
      // /v1/predictions + שדה "version" מדויק, או (2) POST
      // /v1/models/{owner}/{name}/predictions בלי version (רק לגרסת "latest"
      // מסומנת — לא קיימת אצל adirik/interior-design, ניסינו וקיבלנו 404).
      // REPLICATE_VERSION תמיד מוגדר עכשיו (ברירת מחדל קבועה למעלה בקובץ),
      // אז בפועל תמיד נבחר ב-(1); ה-fallback ל-(2) נשאר כרשת ביטחון בלבד
      // למקרה שמישהו ינקה את הערך הזה בטעות בעתיד.
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

echo "✅ הקובץ עודכן."

echo ""
echo "== שלב 2: שמירת השינוי ב-git =="
cd /workspaces/shift-app
git add shift_app_stage5/supabase/functions/generate-render/index.ts
git commit -m "fix(replicate): pin exact model version for adirik/interior-design

The version-less /v1/models/{owner}/{name}/predictions endpoint (tried in
the previous fix) returns 404 for this model -- it's a community model
with no version marked as \"latest\", so that shortcut doesn't work for it
(it does work for official models like the note_resolver's llama one).

Got the exact working version string straight from the model's own HTTP
example on replicate.com/adirik/interior-design and set it as the default
for REPLICATE_VERSION, so we always call the classic /v1/predictions
endpoint with a pinned version -- exactly the same shape that produced the
successful Aug 27 test renders. Still overridable via the
REPLICATE_MODEL_VERSION secret if Replicate ever publishes a new version.

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
  echo "תריץ בנפרד:"
  echo ""
  echo "    ~/sbcli/supabase login"
  echo ""
  echo "ואז שוב:"
  echo ""
  echo "    ~/sbcli/supabase functions deploy generate-render --project-ref iywhxmuzvincfmezijtv --use-api"
  echo ""
fi
