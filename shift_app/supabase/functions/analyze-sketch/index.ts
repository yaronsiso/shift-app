// supabase/functions/analyze-sketch/index.ts
//
// Synchronous Edge Function: user's hand-drawn sketch -> OpenAI Vision ->
// structured architectural JSON (the contract for a future 3D engine).
// v6 — user reviewed a 3D render built from a real v4 analysis of a
// precise, grid-based (spreadsheet) floor plan and flagged two real
// problems: (1) the model had hedged on the exact position of an
// internal wall/boundary even though the source drawing is a precise
// geometric grid sketch, not loose handwriting — that specific
// hedging was unwarranted for this input type; (2) the source sketch
// explicitly labels every opening as a window or a door/entrance
// (and, where unlabeled, visibly varies opening width), but nothing
// in the prompt told the model to read/prioritize those labels or to
// use width/sill-height as a fallback — so door vs. window
// classification wasn't reliably grounded in the actual drawing. v6
// adds two targeted rules (12, 13) for exactly these two failure
// modes. It does not touch anything else, including the intentional
// unassigned-area honesty from v5/rule 11.
// v5 — v4 was accepted as functionally correct (room count, labels,
// grid-dimension reading), but 3 repeated runs on the exact same image
// surfaced real LLM run-to-run variance: two runs left a small honest
// gap between totalAreaSqm and the sum of room areas (a *good* sign —
// an ambiguous corridor area not confidently assigned to either
// neighboring room), but one run silently DROPPED an entire room from
// the JSON instead of marking it "unknown". This is data loss, not
// legitimate uncertainty. v5 adds exactly one targeted rule (11) that
// forbids omitting a room entirely — it must still get a JSON entry,
// even a low-confidence "unknown" one. v5 deliberately does NOT touch
// the totalAreaSqm-vs-sum-of-rooms gap behavior — that stays as-is,
// it's desired honesty, not a bug.
// v4 — v3 fully validated room-topology on hand sketches with written
// numeric dimensions (session 17: real crumpled sketch, confirmed
// correct by the user). This round tested a different input format: a
// floor plan drawn on a spreadsheet grid (photographed off a monitor),
// where cells are labeled "מטר" (meter) instead of printed numbers.
// Room identification stayed perfect (3/3 correct Hebrew labels +
// roomType), but dimensions were off by ~15-20% because the model
// estimated proportions instead of counting grid cells (it even said so
// itself in notes). v4 adds one instruction: when a grid is visible and
// labeled with a unit per cell, count cells instead of eyeballing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FLOOR_PLAN_JSON_SCHEMA } from "../_shared/floor_plan_schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const SYSTEM_PROMPT = `
את/ה אדריכל/ית שקוראת שרטוטי יד ותוכניות דירות/בתים בישראל ומחזירה JSON
מדויק לפי הסכמה שניתנה. הקלט יכול להיות שרטוט יד אמיתי (לא הנדסי נקי,
עלול להיות מצולם בזווית, מקופל, עם כתב יד מסובב), או תוכנית שנבנתה
בגיליון אלקטרוני ומצולמת ממסך (עם גריד גלוי, ולעיתים בלי מספרי מידה
מפורשים - רק תווית יחידת מידה שחזורה על כל משבצת).

חוקים קריטיים (הופרו בבדיקות קודמות - שים/י לב מיוחד):

1. אל תמציא/י חדרים. צור/י רשומת room רק לשטח שסגור לחלוטין על ידי קווי
   קיר רציפים (מלבן/פוליגון סגור עם קירות משני הצדדים). אם יש בתוך שטח
   סגור אחד סימון של רהיט (שולחן, כיסאות, מיטה, ארון) - זה עדיין חדר אחד.
   רהיט אינו קיר, ואינו מצדיק חדר נפרד. לדוגמה קונקרטי: אם רואים כתובת
   "שולחן וכסאות" בתוך מה שבבירור חדר שינה - זה שולחן וכסאות *בתוך* חדר
   השינה, ולא מטבח/פינת אוכל/סלון נפרד. אל תסיק/י שיש מטבח או סלון רק כי
   יש רהיט כזה - חפש/י תווית טקסט מפורשת של שם החדר.

2. קביעת roomType/labelHe: קבע/י אותם *רק* לפי אחד מהשניים: (א) תווית
   טקסט בעברית שכתובה בפועל בתוך/סמוך לחדר (למשל "חדר שינה", "מטבח",
   "סלון"), או (ב) סימון אינסטלציה חד-משמעי (אסלה/מקלחון = חדר רחצה).
   אם אין אחד מהשניים - roomType="unknown", labelHe="" (מחרוזת ריקה),
   ו-roomConfidence="low", ותסביר/י ב-notes שלא הצלחת לזהות את התפקוד.
   אל תניח/י שבבית "חייב" להיות סלון או מטבח.

3. חדר רחצה+שירותים משולב: אם בתוך שטח סגור אחד יש גם אסלה וגם מקלחון/
   כיור, בלי קיר מלא עם דלת שמפריד ביניהם - זה חדר אחד ("רחצה
   ושירותים"), לא שני חדרים.

4. קביעת צירי הבניין לפני כל דבר אחר: קבע/י תחילה איזו צלע של המעטפת
   החיצונית היא הארוכה ואיזו הקצרה, **לפי המידות הכתובות בפועל בשרטוט**
   (למשל 580 ס"מ לעומת 390 ס"מ) - לא לפי כיוון הצילום או הסיבוב של
   התמונה (התמונה יכולה להיות מצולמת בזווית, מסובבת, או הפוכה יחסית
   לבניין עצמו). קבע/י את כל שאר הקואורדינטות (origin, walls.start/end)
   ביחס לצירים האמיתיים של הבניין (x לאורך הצלע הארוכה, y לאורך הצלע
   הקצרה) - לא ביחס לכיוון שבו התמונה מצולמת.

5. סריקה שיטתית לכל הקירות הפנימיים - אל תסתפק/י בקיר אחד. עברו/י על
   כל שטח השרטוט בעקביות ומצא/י את **כל** קווי הקיר הפנימיים (קווים
   כפולים/מודגשים שמייצגים קיר, בניגוד לקווי מידה דקים עם חצים ומספרים
   שמסביב לשרטוט). בשרטוט אחד יכולים להיות כמה קירות פנימיים שיוצרים
   יותר משני חדרים (למשל קיר אחד שמפריד שמאל-ימין, ועוד קיר שמפריד את
   אחד הצדדים לשני חלקים קטנים יותר). מספר החדרים הסופי = מספר השטחים
   הסגורים הנפרדים שכל הקירות הפנימיים האלה יוצרים יחד - לא רק מהקיר
   הבולט/הראשון שמצאת.

6. מידת המעטפת הכוללת: בשרטוטים כאלה מופיעות בדרך כלל כמה שורות מידה
   מקבילות על כל צלע (extension lines מקוננות) - למשל שני מספרים סמוכים
   כמו 370 ו-390, או 570 ו-580. תמיד קח/י את שורת המידה **החיצונית
   ביותר** (הרחוקה ביותר מהקיר, הארוכה/החוצה ביותר) כמידת המעטפת הכוללת
   של הבניין (totalAreaSqm). שורת מידה קרובה יותר לקיר מודדת בדרך כלל
   קטע/מרחק חלקי, לא את כל הבניין.

7. סכימת מידות משבצות גריד (רלוונטי לתוכניות שנבנו בגיליון אלקטרוני,
   עם קווי גריד גלויים ואותיות עמודות כמו K,L,M,N...): בתוכניות כאלה כל
   משבצת גריד מסומנת **בנפרד** בגודלה שלה - משבצת "רגילה" מסומנת בתווית
   "מטר" (כלומר 1.0 מ'), ומשבצת שאינה מטר מלא מסומנת במפורש בגודלה
   האמיתי (למשל "חצי מטר" = 0.5 מ', "25 ס"מ" = 0.25 מ'). **אל תניח/י
   שכל המשבצות שוות ואל תעריך/י לפי פרופורציות חזותיות.** במקום זה,
   עברו/י משבצת-משבצת לאורך כל קיר/חדר שאת/ה מודד/ת, קרא/י את התווית
   שכתובה על כל משבצת בנפרד, וסכם/י את הגדלים המפורשים שלה (למשל שלוש
   משבצות "מטר" ואז משבצת "25 ס"מ" = 3.25 מ', לא 4 מ'). קריאה+סכימה
   כזו של תוויות בפועל מדויקת ומהימנה יותר מהערכה חזותית. אם חלק
   מהתוויות לא קריאות - ציין/י זאת ב-notes ותן/י roomConfidence נמוך
   יותר על המידות שנפגעו, במקום להעריך בביטחון מזויף.

8. יחידות: כל המידות בשרטוט הן בסנטימטרים (אלא אם צוין אחרת, כמו במקרה
   הגריד לעיל) - המר/י (370 ס"מ -> 3.70 מ') והחזר/י הכול במטרים.

9. טקסט בעברית: קרא/י תוויות גם אם הן מסובבות 90/180 מעלות (השרטוט
   צולם בזוויות שונות, כולל דף מקופל, או צילום מסך).

10. כנות מעל הכול: תן/י confidence כולל (high/medium/low) ו-roomConfidence
    לכל חדר בנפרד. עדיף חדר אחד גדול עם confidence גבוה מכמה חדרים
    מומצאים עם confidence גבוה מזויף, אבל גם אל תמעיט/י מספר חדרים אם
    יש עדות לקירות פנימיים נוספים - עדיפות ראשונה היא דיוק, שנייה היא
    כנות לגבי אי-ודאות. אם לא בטוח/ה אם משהו הוא חדר נפרד, או אם לא
    הצלחת לספור משבצות במדויק - סמן/י roomConfidence="low" ותסביר/י
    ב-notes, אל תמציא/י ביטחון.

11. איסור מוחלט על השמטת חדר מה-JSON: אחרי שסרקת את כל הקירות הפנימיים
    (חוק 5) ומצאת N שטחים סגורים נפרדים - מערך ה-rooms שאת/ה מחזיר/ה
    **חייב** להכיל בדיוק N רשומות, בלי יוצא מן הכלל. אם מצאת שטח סגור
    שאינך בטוח/ה בתפקודו - זה בדיוק המקרה של roomType="unknown" מחוק 2,
    **לא** מקרה שמצדיק להשמיט אותו לגמרי מהתשובה. לפני שאת/ה מחזיר/ה
    את התשובה הסופית - עברו/י שוב על כל הקירות הפנימיים שמצאת/י (חוק 5)
    וספרו/י שהאזורים הסגורים שהם יוצרים מקבילים אחד-לאחד לרשומות
    שבפועל נמצאות במערך rooms. השמטה מוחלטת של חדר שקיים בשרטוט (במקום
    לתעד אותו כ-unknown/low-confidence) היא הכשל החמור ביותר האפשרי -
    חמור בהרבה מסימון חדר כ-unknown. שימו לב: זה **לא** נוגע לפער
    האפשרי בין totalAreaSqm לסכום שטחי החדרים - פער כזה (למשל שטח מעבר/
    מסדרון לא-ודאי, שהוא רוחב ממשי בין שני חדרים שכנים ולא שייך במובהק
    לאף אחד מהם) הוא כנות רצויה ותקינה לפי חוק 10, ואין לנסות "לתקן"
    או לסגור אותו - הכלל הזה עוסק רק במניעת היעדרות מוחלטת של חדר שלם
    מרשימת ה-rooms.

12. דיוק קווי קיר בשרטוטים גיאומטריים/מבוססי-גריד: כשמקור השרטוט הוא
    ציור גיאומטרי מדויק - קווים ישרים המיושרים לפי קווי גריד, זוויות
    ישרות מובהקות, לא כתב-יד חופשי מתפתל - יש להתייחס למיקום המדויק של
    **כל** קו קיר (כולל קירות פנימיים חלקיים, לא רק המעטפת החיצונית)
    כאמין ומדויק, באותה רמת אמון כמו קריאת משבצות הגריד עצמן (חוק 7).
    אל תוסיפ/י אי-ודאות מלאכותית (roomConfidence/confidence נמוכים,
    ניסוח כמו "אי-ודאות במיקום קו החלוקה" ב-notes) לגבי מיקום קיר
    שמצויר בבירור ובדיוק גיאומטרי, רק בגלל שהחדר שנוצר ממנו יוצא צר או
    לא-שגרתי בגודלו - חדר צר הוא תוצאה לגיטימית של השרטוט, לא סיבה
    להטיל ספק במיקומו. אי-ודאות אמיתית (roomConfidence/confidence
    נמוך) שמורה למקרים שבהם השרטוט עצמו באמת מעורפל (קו לא ברור, זווית
    צילום בעייתית, כתב יד לא קריא) - לא כברירת מחדל סתמית לכל קיר פנימי.
    אם יש בשרטוט סימון גרפי שאינו קו-קיר רגיל (למשל קו מקווקו/מנוקד
    באזור מסוים, בסגנון שונה מקווי הקיר הרציפים והמלאים) - זה כנראה
    מסמן משהו ספציפי (פתח/כניסה/אזור מיוחד) ולא חוסר-ודאות של השרטוט
    עצמו - חפש/י תווית טקסט סמוכה שמסבירה את הסימון (למשל "כניסה") ותעד/י
    אותה בהתאם (כפתח בקיר, עם type מתאים לפי חוק 13), במקום להתעלם ממנה
    או להשאיר את השטח שם לא-ממופה בלי הסבר.

13. סיווג פתחים (type: "door" מול "window"): קודם כול חפש/י תווית טקסט
    שכתובה בפועל ליד/על כל פתח בקיר (למשל "חלון", "דלת", "כניסה") - אם
    יש תווית כזו היא קובעת את ה-type באופן חד-משמעי ("חלון"->"window",
    "דלת"/"כניסה"->"door"), גם אם הרוחב הפיזי של הפתח לא אופייני לסוג
    הזה. **אם בשרטוט מסוים יש תווית מפורשת לכל פתח - יש להשתמש בתוויות
    האלה לכל פתח בלי יוצא מן הכלל, לא רק לחלקם.** כשאין תווית טקסט ליד
    פתח מסוים, הסק/י לפי סימנים גיאומטריים: (א) השוו/י את רוחב הפתח
    לפתחים אחרים באותו קיר/חדר - פתח רחב משמעותית (בדרך כלל בסביבות
    0.7-1.0 מ') הוא לרוב דלת, פתח צר יותר הוא לרוב חלון; (ב) דלת כמעט
    תמיד מתחילה מגובה הרצפה (sillHeight=0), בעוד שלחלון יש בדרך כלל אדן
    מוגבה (sillHeight>0) - זהו רמז נוסף, בנפרד מהרוחב; (ג) פתח בקיר
    פנימי שמפריד בין שני חדרים כמעט תמיד דלת (חלון לא מפריד בין שני
    חדרים פנימיים), בעוד שפתח בקיר חיצוני יכול להיות חלון או דלת/כניסה
    לפי ההקשר. אם גם אחרי כל זה אין די ביטחון בסיווג - בחר/י את הסוג
    הסביר יותר לפי השילוב של הסימנים לעיל ותציין/י זאת ב-notes, אבל אין
    להשמיט את שדה type ואין להמציא ערך שרירותי בלי שום סימן תומך.

החזר/י תשובה שעומדת בדיוק בסכמת ה-JSON שניתנה, ללא טקסט נוסף מעבר לה.
`.trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "unauthorized", detail: "missing bearer token" }, 401);
  }

  let body: { sketchImagePath?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  const sketchImagePath = body.sketchImagePath;
  if (!sketchImagePath || typeof sketchImagePath !== "string") {
    return jsonResponse({ error: "bad_request", detail: "sketchImagePath is required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized", detail: "invalid token" }, 401);
  }
  const userId = userData.user.id;

  if (!sketchImagePath.startsWith(`${userId}/`)) {
    return jsonResponse(
      { error: "forbidden", detail: "sketchImagePath does not belong to this user" },
      403,
    );
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from("sketch_analyses")
    .insert({
      user_id: userId,
      sketch_image_path: sketchImagePath,
      model_used: OPENAI_MODEL,
      status: "processing",
    })
    .select("id")
    .single();

  if (insertError || !insertedRow) {
    return jsonResponse({ error: "internal_error", detail: "failed to create analysis row" }, 500);
  }

  const analysisId = insertedRow.id;

  async function fail(errorMessage: string) {
    await supabase
      .from("sketch_analyses")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", analysisId);
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("renders")
    .createSignedUrl(sketchImagePath, 600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    await fail("failed to create signed url for sketch image");
    return jsonResponse(
      { error: "internal_error", detail: "failed to sign sketch image url", analysisId },
      500,
    );
  }

  const imageUrl = signedUrlData.signedUrl;

  let openaiResponse: Response;
  try {
    openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "נתח/י את שרטוט היד המצורף לפי הכללים והסכמה שקיבלת." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "floor_plan_analysis",
            strict: true,
            schema: FLOOR_PLAN_JSON_SCHEMA,
          },
        },
      }),
    });
  } catch (err) {
    await fail(`connection error calling OpenAI: ${String(err)}`);
    return jsonResponse(
      { error: "internal_error", detail: `connection error: ${String(err)}`, analysisId },
      502,
    );
  }

  if (!openaiResponse.ok) {
    const errorText = await openaiResponse.text();
    await fail(`OpenAI API error: ${openaiResponse.status} ${errorText}`);
    return jsonResponse({ error: "openai_error", detail: errorText, analysisId }, 502);
  }

  const openaiJson = await openaiResponse.json();
  const rawContent = openaiJson?.choices?.[0]?.message?.content;

  if (!rawContent) {
    await fail("OpenAI response missing content");
    return jsonResponse(
      { error: "internal_error", detail: "OpenAI response missing content", analysisId },
      502,
    );
  }

  let result: unknown;
  try {
    result = JSON.parse(rawContent);
  } catch (err) {
    await fail(`failed to parse OpenAI JSON content: ${String(err)}`);
    return jsonResponse(
      { error: "internal_error", detail: "failed to parse model output", analysisId },
      502,
    );
  }

  const usage = openaiJson?.usage ?? {};

  const { error: updateError } = await supabase
    .from("sketch_analyses")
    .update({
      status: "completed",
      result_json: result,
      input_tokens: usage.prompt_tokens ?? null,
      output_tokens: usage.completion_tokens ?? null,
    })
    .eq("id", analysisId);

  if (updateError) {
    return jsonResponse({ error: "internal_error", detail: "failed to save result", analysisId }, 500);
  }

  return jsonResponse({ analysisId, result, usage });
});
