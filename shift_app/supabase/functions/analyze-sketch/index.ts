// supabase/functions/analyze-sketch/index.ts
//
// Synchronous Edge Function: user's hand-drawn sketch/floor plan -> OpenAI
// Vision -> structured architectural JSON (the contract for the 3D engine).
//
// v15 (session 20, 10.9.2026, same day as v14) -- v14 added a Pass 0
// ("scope") step and three new rules (17/18/19: real building-envelope
// tracing instead of forced rectangles, a dedicated stairs[] array, a
// specialElements[] catch-all) on top of v13's topology-fixed validator.
// Deployed and tested live on the same complex professional floor plan,
// three identical-input runs:
//
//   - FIXED: every run's buildingEnvelope now contains a real diagonal
//     vertex matching the drawing's actual diagonal wall, and in 2/3 runs
//     that diagonal carried through into an actual room's wall (not forced
//     to a rectangle).
//   - FIXED: stairs appeared in all 3 runs as a genuinely separate object,
//     never folded into a room/wall, with unmeasurable numeric fields
//     honestly null instead of invented.
//   - IMPROVED BUT NOT SOLVED: totalAreaSqm and room count still varied
//     across identical-input runs (70.2/57.2/56.7 sqm model-reported;
//     73.99/56.63/50.38 sqm code-computed; 7/8/8 rooms) -- narrower than
//     v13's 58.8-101.32 sqm spread, but still real instability.
//   - NEW PROBLEM FOUND: in one run, a corner of the building envelope
//     (near the diagonal vertex) was not covered by ANY room's own wall
//     polygon -- the envelope "knew" that area belonged to the building,
//     but no room was mapped to it. v14's validator never checked this
//     (it only checks each room's own topology, and totalAreaSqm-vs-
//     computed-area, not envelope-coverage-vs-room-union).
//
// v15 targets the still-open problem (area/room-count instability) with a
// structural change ChatGPT's original review also recommended: splitting
// the single "do everything" geometry call into two narrower calls instead
// of trying the full 5-6 stage pipeline (which would also need real image
// cropping -- a new, untestable-from-here Deno dependency -- and was
// judged too large a leap to ship blind). The hypothesis: one call
// juggling envelope + N rooms + every wall's openings + stairs + special
// elements simultaneously has more room for the model to "drift" between
// identical-input runs than two narrower calls would.
//
//   Pass 1A ("geometry"): given the image (and Pass 0's scope guidance,
//   same as v14), identify ONLY buildingEnvelope + rooms + walls
//   (coordinates/thickness/height). openings/stairs/specialElements are
//   explicitly required to stay empty in this pass. Keeps v13/v14's
//   accumulating corrective-retry loop, now including a new room-coverage-
//   gap check (rooms' own polygon-area sum vs. the envelope's polygon
//   area -- a large shortfall is retry-worthy, same mechanism as the
//   existing totalAreaSqm-vs-computed check).
//
//   Pass 1B ("openings"): given the SAME image again, plus Pass 1A's
//   confirmed geometry presented as the model's own prior answer, fill in
//   only: each wall's openings, stairs[], specialElements[], and
//   (rarely) a corrected totalAreaSqm. The prompt is explicit and
//   repeated that the given geometry is fixed and must come back
//   unchanged. A NEW validator (validateGeometryDrift) checks exactly
//   that after each attempt -- comparing Pass 1A's and Pass 1B's
//   buildingEnvelope/room/wall coordinates -- and treats any drift as a
//   retry-worthy issue with its own corrective retry loop, mirroring the
//   existing pattern rather than inventing a new one.
//
// This roughly doubles worst-case OpenAI calls per analysis (up to 3
// geometry attempts + 3 openings attempts + 1 scope call = 7, versus v14's
// up to 4) -- a real cost/latency tradeoff, accepted deliberately as a
// smaller, verifiable step rather than jumping straight to the full
// multi-pass + real-image-crop architecture. floor_plan_schema.ts is
// UNCHANGED from v14 -- both new passes reuse the exact same
// FLOOR_PLAN_JSON_SCHEMA, just with different system prompts steering
// which fields each pass is responsible for.
//
// Real image cropping (Pass 0 physically cutting the image, not just
// describing regions in text) is still NOT implemented, for the same
// reason as v14: it requires a Deno image-processing dependency that
// cannot be tested from this sandbox (no network access to Supabase/
// OpenAI here). If this two-call split still doesn't stabilize
// area/room-count enough, that remains the next candidate step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DRAWING_SCOPE_JSON_SCHEMA,
  FLOOR_PLAN_JSON_SCHEMA,
} from "../_shared/floor_plan_schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const MAX_ANALYSIS_ATTEMPTS = 3;

// Relative difference above which the model's own totalAreaSqm claim and
// our geometrically-computed area are considered a real mismatch worth a
// corrective retry, rather than ordinary rounding/estimation noise.
const AREA_MISMATCH_RELATIVE_THRESHOLD = 0.15;

// v15: relative shortfall above which "sum of each room's own polygon
// area" being smaller than "the building envelope's own polygon area" is
// considered a likely missed room/area rather than a legitimate small
// unassigned gap (e.g. an undefined hallway sliver, which rule 11
// explicitly allows as honest). Deliberately looser than the
// area-mismatch threshold above: real buildings can have some genuinely
// unassigned space, and this check must not pressure the model into
// inventing a room just to close an honest gap.
const ROOM_COVERAGE_GAP_RELATIVE_THRESHOLD = 0.2;

const SCOPE_SYSTEM_PROMPT = `
את/ה עוזר/ת שממיין/ת דף סריקה/צילום של שרטוט אדריכלי, **לפני** כל ניתוח
אדריכלי בפועל. המשימה שלך היא צרה ומוגדרת: לזהות היכן בתוך התמונה נמצאת
תוכנית הקומה הראשית (ה-floor plan עצמו - הקירות, החדרים, הפתחים של
הבית/הדירה), ולהבדיל אותה מכל דבר אחר שמופיע על אותו דף/תמונה ושאינו
חלק מגיאומטריית הבית.

לדפי שרטוט מקצועיים יש לעיתים קרובות, מתחת או לצד תוכנית הקומה הראשית,
פרטי בנייה/חתכים/פריסות נוספים - למשל פרט מוגדל של חדר רחצה, חתך של
קיר, פריסת חזית של אלמנט בודד. אלה **אינם** חלק מתוכנית הקומה ואסור
שהגיאומטריה שלהם תיכנס כחדרים נוספים בניתוח הבא.

סימנים טיפוסיים לפרט/חתך נפרד (לא תוכנית קומה): כיתוב כמו "חתך", "פרט",
"מ.ד. חתך", מספור/אותיות של חתך (א-א, ב-ב), קנה מידה שונה מהתוכנית
הראשית, מסגרת/גבול גרפי נפרד סביב הציור, תוכן שחוזר על עצמו (כמה גרסאות
של אותו חדר/אלמנט מזוויות שונות).

החזר/י אך ורק:
1. mainFloorPlanBboxPct - תיבה מלבנית (באחוזים מגודל התמונה המלאה, 0-100
   בכל ציר, כאשר 0,0 היא הפינה השמאלית-עליונה) שמכילה את כל תוכנית הקומה
   הראשית ורק אותה.
2. excludedRegions - רשימת תיבות (באותו פורמט אחוזים) של אזורים שזיהית
   כפרטים/חתכים/ציורים נפרדים שאינם חלק מתוכנית הקומה, כל אחת עם reason
   קצר בעברית שמסביר למה סומן כך.
3. scopeConfidence - מספר בין 0 ל-1 שמבטא כמה את/ה בטוח/ה בזיהוי הזה.

אם כל הדף הוא תוכנית קומה אחת בלבד, בלי שום פרט/חתך נוסף - mainFloorPlanBboxPct
מכסה את כל התמונה (0,0 עד 100,100) ו-excludedRegions הוא מערך ריק. אל
תנתח/י חדרים, קירות, מידות או פתחים בשלב הזה - זה נעשה בשלב נפרד אחר-כך.
`.trim();

const GEOMETRY_SYSTEM_PROMPT = `
את/ה אדריכל/ית שקוראת שרטוטי יד ותוכניות דירות/בתים בישראל ומחזירה JSON
מדויק לפי הסכמה שניתנה. הקלט יכול להיות שרטוט יד אמיתי (לא הנדסי נקי,
עלול להיות מצולם בזווית, מקופל, עם כתב יד מסובב), או תוכנית שנבנתה
בגיליון אלקטרוני ומצולמת ממסך (עם גריד גלוי, ולעיתים בלי מספרי מידה
מפורשים - רק תווית יחידת מידה שחזורה על כל משבצת), או תוכנית אדריכלית
מקצועית ומורכבת.

בשלב הזה (v15: שלב גיאומטריה בלבד) המשימה שלך מצומצמת בכוונה: לזהות את
מעטפת הבניין החיצונית, לחלק אותה לחדרים, ולקבוע את מיקום/מידות כל קיר
במדויק. **אל תזהה/י בשלב הזה פתחים (דלתות/חלונות), גרם מדרגות, או
אלמנטים מיוחדים - זה נעשה בשלב נפרד לאחר מכן**, כדי שתוכל/י להתרכז אך
ורק בגיאומטריה בלי להיסח על ידי פרטים אחרים. לכן: בכל wall שאת/ה
מחזיר/ה, שדה openings **חייב** להיות מערך ריק ([]). מערכי stairs
ו-specialElements ברמת התשובה כולה **חייבים** להיות ריקים ([]) גם הם.
למרות הצמצום הזה, totalAreaSqm עדיין חייב להיות הערכה כנה ומדויקת שלך
לשטח הכולל (ר' חוק 6 למטה) - זה עדיין חלק מהמשימה של השלב הזה.

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
   של הבניין. שים/י לב: totalAreaSqm שאת/ה מחזיר/ה הוא הערכה שלך בלבד
   לצורך ביקורת-עצמית - הקוד שקורא לך מחשב את השטח הסופי בעצמו מתוך
   buildingEnvelope/הקואורדינטות, ולא מסתמך על המספר הזה. עדיין חשוב
   שתחשב/י אותו בכנות ובדיוק (לא לנחש/לעגל סתם), כי פער גדול בינו לבין
   השטח המחושב מהגיאומטריה שסיפקת יגרום לבקשת תיקון.

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

17. אל תניח/י שצלע של מעטפת חיצונית או של חדר היא בהכרח אופקית או
    אנכית (זווית 0/90/180/270 מעלות ביחס לצירי הבניין). קבע/י את מיקום
    כל קיר **לפי הגיאומטריה הנראית בפועל בשרטוט**. אם קו במעטפת או בקיר
    פנימי יוצר זווית שאינה 0/90/180/270 מעלות (למשל פינה חתוכה/אלכסונית,
    כמו שקורה לפעמים בפינת מבנה) - יש להחזיר אותו כקיר אלכסוני עם
    start/end אמיתיים שמשקפים את הזווית בפועל, ואסור "ליישר" אותו למלבן
    לצורך נוחות או כי רוב שאר הבית מלבני. לפני שאת/ה בונה rooms בכלל,
    עברו/י תחילה על המעטפת החיצונית השלמה של הבניין וזהו/זהי כל שינוי
    כיוון שלה (buildingEnvelope.vertices - רשימת הפינות של המעטפת החיצונית
    לפי הסדר, כולל פינות לא-ישרות/אלכסוניות אם יש כאלה) - **לפני** שאת/ה
    מתחיל/ה לחלק את הפנים לחדרים. אם את/ה לא מצליח/ה לעקוב אחרי מעטפת
    רציפה שלמה (למשל חלק מהמעטפת לא ברור בתמונה) - buildingEnvelope
    יכול להיות null, זו כנות תקינה, עדיף מניחוש.

הקלט למשימה זו עשוי לכלול, בתחילת ההודעה, טקסט שמציין אילו אזורים
בתמונה זוהו כתוכנית הקומה הראשית ואילו זוהו כפרטים/חתכים נפרדים
(שיוצרו בשלב מקדים נפרד). אם טקסט כזה מופיע - **אסור** לכלול בניתוח שלך
(rooms/walls/stairs/specialElements/buildingEnvelope) שום גיאומטריה
שמקורה באזורים שסומנו כפרטים/חתכים נפרדים, גם אם היא נראית לך רלוונטית
- הם כבר סוננו במכוון בשלב קודם. אם לא הופיע טקסט כזה - נתח/י את כל
התמונה כרגיל.

החזר/י תשובה שעומדת בדיוק בסכמת ה-JSON שניתנה, ללא טקסט נוסף מעבר לה.
`.trim();

const OPENINGS_SYSTEM_PROMPT = `
את/ה אדריכל/ית שקוראת שרטוטי יד ותוכניות דירות/בתים בישראל ומחזירה JSON
מדויק לפי הסכמה שניתנה. הקלט יכול להיות שרטוט יד אמיתי (לא הנדסי נקי,
עלול להיות מצולם בזווית, מקופל, עם כתב יד מסובב), או תוכנית שנבנתה
בגיליון אלקטרוני ומצולמת ממסך (עם גריד גלוי, ולעיתים בלי מספרי מידה
מפורשים - רק תווית יחידת מידה שחזורה על כל משבצת), או תוכנית אדריכלית
מקצועית ומורכבת.

בשלב הזה (v15: שלב פתחים/מדרגות/אלמנטים) קיבלת גיאומטריה שכבר אושרה
בשלב קודם - מעטפת הבניין, כל החדרים, וכל הקירות עם מיקומם/מידותיהם
המדויקים - מוצגת בפנייך כתשובה קודמת שלך (assistant) בשיחה. **הגיאומטריה
הזו קבועה לחלוטין ואסור לשנות אותה בשום צורה**: אסור לשנות קואורדינטה
(start/end), thicknessM או heightM של אף wall; אסור לשנות origin,
widthM, lengthM, heightM, floorMaterial או id של אף room; אסור לשנות את
buildingEnvelope.vertices; ואסור להוסיף, להסיר או למזג rooms. המשימה
שלך היחידה עכשיו:
(א) לעבור שיטתית על כל קיר בכל חדר ולמלא את מערך ה-openings שלו לפי
    הראיות שבשרטוט (ר' חוקים 13-16 למטה);
(ב) למלא את מערך stairs אם יש גרם מדרגות בשרטוט (ר' חוק 18);
(ג) למלא את מערך specialElements לאלמנטים שאינם room/wall/opening/stairs
    ולא זוהו כרהיט רגיל (ר' חוק 19);
(ד) לעדכן את totalAreaSqm רק אם התגלה שהוא לא תאם את הגיאומטריה שכבר
    ניתנה - נדיר, כי הגיאומטריה כבר עברה בדיקת-תאימות בשלב הקודם.
החזר/י את כל האובייקט מחדש: עם הגיאומטריה **בדיוק** כפי שניתנה לך (אותם
buildingEnvelope/rooms/walls, אות ID, אותם מספרים), ורק openings לכל
קיר (וstairs, וspecialElements, ולעיתים נדירות totalAreaSqm) מתווספים/
מתעדכנים.

חוקים קריטיים (הופרו בבדיקות קודמות - שים/י לב מיוחד):

8. יחידות: כל המידות בשרטוט הן בסנטימטרים (אלא אם צוין אחרת, כמו במקרה
   הגריד לעיל) - המר/י (370 ס"מ -> 3.70 מ') והחזר/י הכול במטרים.

9. טקסט בעברית: קרא/י תוויות גם אם הן מסובבות 90/180 מעלות (השרטוט
   צולם בזוויות שונות, כולל דף מקופל, או צילום מסך).

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

14. סריקה שיטתית לכל אורך כל קיר לאיתור פתחים - לא רק קירות פנימיים
    (חוק 5), אלא **כל** קיר, כולל קירות חיצוניים: עברו/י על כל האורך של
    כל קיר בעקביות, מקצה לקצה, וחפש/י שני סוגי סימנים לפתח: (א) תווית
    טקסט סמוכה לקיר (חלון/דלת/כניסה/פתח), או (ב) סימון גרפי שמפר את
    רציפות קו הקיר הרגיל (קו מקווקו/מנוקד, תיבה קטנה מצוירת על הקיר,
    הפסקה בקו הקיר הרציף) - ראו גם חוק 12 לגבי סימונים גרפיים חריגים.
    אל תעצר/י אחרי שמצאת פתח אחד או שניים על קיר - המשיכ/י לסרוק עד
    סוף הקיר, בדיוק כמו שחוק 5 דורש למצוא **את כל** הקירות הפנימיים ולא
    רק את הבולט ביותר. קיר שיש עליו סימן פתח כלשהו (טקסט או גרפי) חייב
    לקבל רשומת opening תואמת ב-JSON; סגירת הקיר כמלא/רציף למרות סימן
    כזה היא טעות. קיר בלי אף סימן פתח - openings: [] (מערך ריק), זה
    תקין ואין להמציא פתח שאין לו שום עדות בשרטוט.

15. מיקום מדויק של פתח על קיר (distanceFromStart): ברגע שזיהית שיש פתח
    (חוק 14), קבע/י את מיקומו המדויק לאורך הקיר **באותה שיטת ספירת-
    משבצות-גריד שמתוארת בחוק 7** - כלומר ספרו/י את המשבצות מתחילת הקיר
    (הנקודה start) עד למיקום הפתח, וסכמו/י את הגדלים המפורשים הכתובים
    על כל משבצת בדרך (מטר/חצי מטר/25 ס"מ וכו', בדיוק כמו בחישוב אורך
    קיר כולל) - **אל תעריכ/י מרחק לפי מיקום חזותי משוער על הקיר.** אותו
    עיקרון חל גם על width של הפתח עצמו - ספרו/י כמה משבצות הפתח תופס
    ואל תנחשו לפי רוחב "טיפוסי" של דלת/חלון. אם אין גריד גלוי בקטע
    הרלוונטי של השרטוט (למשל שרטוט-יד חופשי) - רק אז אפשר להעריך לפי
    מיקום יחסי על הקיר, ויש לציין ב-notes שמדובר בהערכה ולתת
    roomConfidence מתאים (לא גבוה) לפתח הספציפי הזה. **חשוב באותה
    מידה - קושי במדידה המדויקת אינו אף פעם עילה להשמטת הפתח כליל:**
    ייתכן שהגריד קיים אבל התווית באזור הפתח הספציפי לא קריאה, חלקית,
    מוסתרת, או שהתמונה מטושטשת שם - במקרים כאלה בדיוק כמו במקרה של
    "אין גריד", יש לרשום את הפתח עם ההערכה הסבירה ביותר שאפשר לתת
    (ולא לדלג עליו), ולתעד ב-notes שזו הערכה בגלל קושי קריאה. חוק 14
    כבר קבע שכל קיר עם סימן פתח (טקסטואלי או גרפי) חייב רשומת opening
    - קושי במדידה המדויקת של אותו פתח (בניגוד לספק לגבי **קיומו**, שהוא
    מקרה שונה) אינו מבטל את החובה הזו. השמטת פתח שזוהה כקיים, רק בגלל
    שהמדידה המדויקת שלו לא ודאית, היא אותה טעות בדיוק שחוק 11 אוסר
    ברמת החדר - השמטה מוחלטת במקום תיעוד עם ביטחון נמוך.

16. זיהוי כל פתח **בנפרד**, לפי הראיה הממוקמת בדיוק באותו מיקום שלו -
    לא לפי חלוקה כללית של "מה יש בערך על הקיר הזה": כשיש על קיר אחד (או
    על קירות סמוכים) יותר מסימן פתח אחד, אסור לקבוע קודם "אילו סוגים
    בסך הכול קיימים כאן" ואז לנחש/להתאים איזה סוג שייך לאיזה מיקום. יש
    לקבוע type ו-distanceFromStart לכל פתח בנפרד, אך ורק לפי הראיה
    (תווית טקסט או סימון גרפי) שנמצאת ממש באותו מיקום שלו. אם יש תווית
    "חלון" צמודה לפתח מסוים - הפתח **באותו מיקום עצמו** הוא type="window",
    גם אם יש פתח אחר קרוב שמסומן כדלת/כניסה - אסור "להחליף" ביניהם או
    לשייך את התווית לפתח הלא-נכון. באותו אופן: אם כמה פתחים בשרטוט
    מסומנים **באותו סימון גרפי חריג וייחודי** שלא מופיע במקום אחר
    בשרטוט (למשל אותו סגנון קו מקווקו בצבע מסוים, השונה מסימוני הפתחים
    האחרים) - וידוע ה-type של אחד מהם בוודאות גבוהה (למשל יש לו תווית
    "כניסה" צמודה) - יש להחיל את אותו type **גם** על שאר הפתחים המסומנים
    באותה שיטה גרפית זהה בדיוק, כי העובדה ששניהם משתמשים באותו סימון
    חריג היא ראיה אמיתית לזהות משותפת, לא ניחוש. סתירה מפורשת (תווית
    שונה הצמודה לאחד מהם ספציפית) גוברת על כלל העקביות הזה. אסור לקבוע
    type באופן שרירותי/מעורפל לפתח שאין לו לא תווית ולא סימון גרפי
    ברור באותו מיקום - זהו בדיוק המקרה של חוק 14: אם אין שום ראיה
    (טקסטואלית או גרפית) באותו מיקום עצמו, אין פתח שם כלל.

18. מדרגות הן אובייקט נפרד לגמרי, לעולם לא room ולעולם לא עוד wall בתוך
    room. אם מזוהה גרם מדרגות בשרטוט - הוסף/הוסיפי רשומה למערך stairs
    (לא למערך rooms) עם המיקום, הכיוון (אם ברור), הרוחב, ופרטי המדרגות
    עצמן (מספר מדרגות, עומק/גובה מדרגה בודדת) ככל שהם קריאים בשרטוט. אם
    מספר המדרגות/המידות המדויקות אינם קריאים בבירור - השאר/י את השדה
    המתאים null (steps.count וכו') ותן/י confidence נמוך, **אל תמציא/י
    מספר** רק כדי למלא שדה. שטח שתפוס ע"י גרם מדרגות אינו חלק משטח
    אף room שכן/סמוך אליו.

19. אלמנטים שאינם room/wall/opening/stairs וגם לא רהיט רגיל בתוך חדר
    (למשל עמוד, נישה, אלמנט בנוי לא-מזוהה, או כל דבר שאת/ה רואה בבירור
    בשרטוט אבל לא בטוח/ה מה תפקידו) - תעד/י אותם במערך specialElements
    עם תיאור חופשי קצר בעברית ומיקום משוער, במקום להתעלם מהם או "לדחוס"
    אותם בכוח לתוך room/wall שלא מתאים להם.

הקלט למשימה זו עשוי לכלול, בתחילת ההודעה, טקסט שמציין אילו אזורים
בתמונה זוהו כתוכנית הקומה הראשית ואילו זוהו כפרטים/חתכים נפרדים
(שיוצרו בשלב מקדים נפרד). אם טקסט כזה מופיע - **אסור** לכלול בניתוח שלך
(rooms/walls/stairs/specialElements/buildingEnvelope) שום גיאומטריה
שמקורה באזורים שסומנו כפרטים/חתכים נפרדים, גם אם היא נראית לך רלוונטית
- הם כבר סוננו במכוון בשלב קודם. אם לא הופיע טקסט כזה - נתח/י את כל
התמונה כרגיל.

החזר/י תשובה שעומדת בדיוק בסכמת ה-JSON שניתנה, ללא טקסט נוסף מעבר לה.
`.trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- geometry helpers (code, not the model, computes area) ---------------

interface PointLike {
  x?: unknown;
  y?: unknown;
}

function isValidPoint(p: unknown): p is { x: number; y: number } {
  const point = p as PointLike;
  return typeof point?.x === "number" && typeof point?.y === "number" &&
    Number.isFinite(point.x) && Number.isFinite(point.y);
}

// Shoelace formula. Expects a simple polygon, vertices in order (either
// winding direction - the abs() below makes the sign irrelevant).

function polygonAreaSqm(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1] ?? points[0];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Derives a room's own polygon area from its walls' start/end points. Not
// all rooms are guaranteed to have their walls listed in walk order (v13
// fixed the validator to not require that), so this walks the wall graph
// (matching v13's topology check) to build an ordered vertex loop instead
// of just taking wall order at face value. Returns 0 if the walls don't
// form one clean closed loop (the validator will have already flagged
// that as an issue in that case).

function roomPolygonAreaSqm(walls: unknown): number {
  const wallArr = Array.isArray(walls) ? walls : [];
  const pointKey = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const edges: Array<[string, string]> = [];
  const coordByKey = new Map<string, { x: number; y: number }>();

  for (const w of wallArr) {
    const wall = w as { start?: unknown; end?: unknown };
    if (!isValidPoint(wall?.start) || !isValidPoint(wall?.end)) return 0;
    const start = wall.start as { x: number; y: number };
    const end = wall.end as { x: number; y: number };
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    coordByKey.set(startKey, start);
    coordByKey.set(endKey, end);
    edges.push([startKey, endKey]);
  }

  if (edges.length < 3) return 0;

  const adjacency = new Map<string, string[]>();
  for (const [a, b] of edges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }

  const startKey = edges[0][0];
  const orderedKeys: string[] = [startKey];
  let previousKey: string | null = null;
  let currentKey = startKey;

  for (let step = 0; step < edges.length; step++) {
    const neighbors = adjacency.get(currentKey) ?? [];
    const nextKey = neighbors.find((n) => n !== previousKey) ?? neighbors[0];
    if (!nextKey) return 0;
    if (nextKey === startKey && orderedKeys.length === edges.length) break;
    orderedKeys.push(nextKey);
    previousKey = currentKey;
    currentKey = nextKey;
  }

  const points = orderedKeys
    .map((k) => coordByKey.get(k))
    .filter((p): p is { x: number; y: number } => p !== undefined);

  if (points.length !== edges.length) return 0;
  return polygonAreaSqm(points);
}

// v15: factored out of computeAreaSqm so the room-coverage-gap check
// below can independently compare "sum of each room's own polygon area"
// against "the envelope's own polygon area" (computeAreaSqm itself still
// prefers the envelope figure when available - this helper is what lets
// the validator get BOTH numbers rather than only whichever one
// computeAreaSqm happened to pick).
function roomsSumAreaSqm(rooms: unknown): number {
  const roomArr = Array.isArray(rooms) ? rooms : [];
  let sum = 0;
  for (const room of roomArr) {
    const roomObj = room as { walls?: unknown };
    sum += roomPolygonAreaSqm(roomObj?.walls);
  }
  return sum;
}

function computeAreaSqm(result: unknown): number {
  const r = result as {
    buildingEnvelope?: { vertices?: unknown };
    rooms?: unknown;
  };

  const envelopeVertices = r?.buildingEnvelope?.vertices;
  if (Array.isArray(envelopeVertices) && envelopeVertices.length >= 3) {
    const validPoints = envelopeVertices.filter(isValidPoint) as Array<
      { x: number; y: number }
    >;
    if (validPoints.length === envelopeVertices.length) {
      const area = polygonAreaSqm(validPoints);
      if (area > 0) return Math.round(area * 100) / 100;
    }
  }

  return Math.round(roomsSumAreaSqm(r?.rooms) * 100) / 100;
}

// --- validator (extends v13/v14's topology + area/envelope checks) -------

function validateFloorPlanResult(result: unknown): string[] {
  const issues: string[] = [];
  const r = result as { rooms?: unknown; totalAreaSqm?: unknown };
  const rooms = Array.isArray(r?.rooms) ? r.rooms : [];

  if (rooms.length === 0) {
    issues.push("no rooms in result");
    return issues;
  }

  for (const room of rooms) {
    const roomObj = room as {
      id?: unknown;
      labelHe?: unknown;
      roomType?: unknown;
      heightM?: unknown;
      walls?: unknown;
    };
    const roomLabel = String(roomObj?.id ?? roomObj?.labelHe ?? "room");

    if (roomObj?.roomType === "unknown") {
      issues.push(`${roomLabel}: roomType is unknown`);
    }
    if (roomObj?.heightM === 0) {
      issues.push(`${roomLabel}: heightM is 0`);
    }

    const walls = Array.isArray(roomObj?.walls) ? roomObj.walls : [];
    if (walls.length < 3) {
      issues.push(`${roomLabel}: fewer than 3 walls`);
      continue;
    }

    const segmentKeys = new Set<string>();
    const pointKey = (p: { x?: unknown; y?: unknown }) => `${p?.x},${p?.y}`;
    const touchesByPoint = new Map<string, number[]>();
    let sawInvalidCoord = false;

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i] as {
        heightM?: unknown;
        openings?: unknown;
        start?: { x?: unknown; y?: unknown };
        end?: { x?: unknown; y?: unknown };
      };

      if (wall?.heightM === 0) {
        issues.push(`${roomLabel}: wall ${i} heightM is 0`);
      }

      const openings = Array.isArray(wall?.openings) ? wall.openings : [];
      for (const opening of openings) {
        const o = opening as { height?: unknown; width?: unknown };
        if (o?.height === 0 || o?.width === 0) {
          issues.push(`${roomLabel}: wall ${i} has a zero-size opening`);
        }
      }

      if (
        typeof wall?.start?.x !== "number" || typeof wall?.start?.y !== "number" ||
        typeof wall?.end?.x !== "number" || typeof wall?.end?.y !== "number"
      ) {
        issues.push(`${roomLabel}: wall ${i} has missing/non-numeric coordinates`);
        sawInvalidCoord = true;
        continue;
      }

      const startKey = pointKey(wall.start);
      const endKey = pointKey(wall.end);
      if (startKey === endKey) {
        issues.push(`${roomLabel}: wall ${i} has zero length (start equals end)`);
        continue;
      }

      const forwardKey = `${startKey}|${endKey}`;
      const reverseKey = `${endKey}|${startKey}`;
      if (segmentKeys.has(forwardKey) || segmentKeys.has(reverseKey)) {
        issues.push(`${roomLabel}: duplicate/reversed wall segment at index ${i}`);
      }
      segmentKeys.add(forwardKey);

      for (const key of [startKey, endKey]) {
        const list = touchesByPoint.get(key) ?? [];
        list.push(i);
        touchesByPoint.set(key, list);
      }
    }

    if (sawInvalidCoord) continue;

    // Every corner must be touched by exactly 2 wall endpoints: degree 1 is
    // a dead end (a real gap in the boundary), degree 3+ is a stray branch.
    for (const [point, wallIdxs] of touchesByPoint) {
      if (wallIdxs.length !== 2) {
        issues.push(
          `${roomLabel}: corner (${point}) is touched by ${wallIdxs.length} wall endpoint(s) ` +
            `instead of 2 (${wallIdxs.length < 2 ? "gap in the boundary" : "branching walls"})`,
        );
      }
    }

    // All of a room's walls must form a single connected loop, not, e.g.,
    // two separate closed shapes that individually pass the corner check.
    if (walls.length >= 3 && touchesByPoint.size > 0) {
      const visited = new Set<number>();
      const stack = [0];
      visited.add(0);
      while (stack.length > 0) {
        const wallIdx = stack.pop()!;
        const wall = walls[wallIdx] as { start?: { x?: unknown; y?: unknown }; end?: { x?: unknown; y?: unknown } };
        for (const key of [pointKey(wall?.start ?? {}), pointKey(wall?.end ?? {})]) {
          for (const neighborIdx of touchesByPoint.get(key) ?? []) {
            if (!visited.has(neighborIdx)) {
              visited.add(neighborIdx);
              stack.push(neighborIdx);
            }
          }
        }
      }
      if (visited.size !== walls.length) {
        issues.push(
          `${roomLabel}: walls do not form a single connected loop ` +
            `(${walls.length - visited.size} wall(s) disconnected from the rest)`,
        );
      }
    }
  }

  // v14: buildingEnvelope sanity check (only if provided - null is fine).
  const envelope = (result as { buildingEnvelope?: { vertices?: unknown } })
    ?.buildingEnvelope;
  if (envelope != null) {
    const vertices = Array.isArray(envelope.vertices) ? envelope.vertices : [];
    if (vertices.length < 3) {
      issues.push("buildingEnvelope: fewer than 3 vertices (not a valid polygon)");
    } else {
      const invalidVertex = vertices.some((v) => !isValidPoint(v));
      if (invalidVertex) {
        issues.push("buildingEnvelope: has missing/non-numeric vertex coordinates");
      }
    }
  }

  // v15: room-coverage-gap check. Session 20's live test on the
  // professional floor plan found a case where buildingEnvelope correctly
  // traced a real diagonal corner, but no room's own wall polygon reached
  // that corner - the envelope "knew" the area belonged to the building,
  // but it was not mapped to any room. Compares the envelope's own
  // polygon area against the independent sum of each room's own polygon
  // area (not against computeAreaSqm's result, which would already
  // prefer the envelope figure and mask this exact gap). Deliberately
  // looser than the totalAreaSqm-vs-computed check above (rule 11 allows
  // a genuinely unassigned sliver, e.g. an undefined hallway, as honest -
  // this check's own corrective message leaves room for that answer
  // rather than demanding an invented room).
  if (envelope != null) {
    const envelopeVertices2 = Array.isArray(envelope.vertices) ? envelope.vertices : [];
    const validEnvelopePoints = envelopeVertices2.filter(isValidPoint) as Array<
      { x: number; y: number }
    >;
    if (
      validEnvelopePoints.length >= 3 &&
      validEnvelopePoints.length === envelopeVertices2.length
    ) {
      const envelopeArea = polygonAreaSqm(validEnvelopePoints);
      const roomsArea = roomsSumAreaSqm(rooms);
      if (envelopeArea > 0) {
        const uncoveredFraction = (envelopeArea - roomsArea) / envelopeArea;
        if (uncoveredFraction > ROOM_COVERAGE_GAP_RELATIVE_THRESHOLD) {
          issues.push(
            `rooms cover only ~${Math.round((roomsArea / envelopeArea) * 100)}% of the building ` +
              `envelope's area (envelope ${envelopeArea.toFixed(2)} sqm vs. sum of room areas ` +
              `${roomsArea.toFixed(2)} sqm) - double-check whether a whole enclosed room/area inside ` +
              `the envelope was missed (rules 5+11); if the remaining area is a genuine unassigned ` +
              `space (e.g. an undefined hallway/passage between rooms, per rule 11) that is fine, but ` +
              `verify that is really the case rather than a missed room`,
          );
        }
      }
    }
  }

  // v14: model's own totalAreaSqm vs. geometrically computed area. A large
  // mismatch is exactly the kind of thing session 20 found (58.8 / 81.56 /
  // 101.32 sqm on identical input) and is worth a targeted corrective
  // retry, same as a topology issue.
  const modelReportedArea = typeof r?.totalAreaSqm === "number" ? r.totalAreaSqm : null;
  if (modelReportedArea !== null && modelReportedArea > 0) {
    const computedArea = computeAreaSqm(result);
    if (computedArea > 0) {
      const relativeDiff = Math.abs(computedArea - modelReportedArea) / computedArea;
      if (relativeDiff > AREA_MISMATCH_RELATIVE_THRESHOLD) {
        issues.push(
          `totalAreaSqm (${modelReportedArea}) differs from the area computed from the ` +
            `geometry you provided (${computedArea.toFixed(2)}) by more than ` +
            `${Math.round(AREA_MISMATCH_RELATIVE_THRESHOLD * 100)}% - re-check that ` +
            `buildingEnvelope/room walls and totalAreaSqm describe the same building`,
        );
      }
    }
  }

  return issues;
}

// --- v15: geometry-drift check (Pass 1A vs Pass 1B) ------------------------
//
// Both GEOMETRY_SYSTEM_PROMPT and OPENINGS_SYSTEM_PROMPT explicitly tell
// the model never to change buildingEnvelope/room/wall coordinates once
// the geometry pass has produced them. This is the check that verifies
// that actually held after each openings-pass attempt, so a violation
// becomes a targeted corrective retry (same mechanism as a topology
// issue) instead of silently shipping drifted geometry to the app.

interface RoomLike {
  id?: unknown;
  origin?: { x?: unknown; y?: unknown };
  widthM?: unknown;
  lengthM?: unknown;
  heightM?: unknown;
  floorMaterial?: unknown;
  walls?: unknown;
}

function round2(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// A wall's identity for drift comparison, independent of start/end
// direction (v13 already established that wall order/direction within a
// room isn't meaningful - only the set of segments is).
function wallGeometryKey(wall: unknown): string | null {
  const w = wall as { start?: unknown; end?: unknown; thicknessM?: unknown; heightM?: unknown };
  if (!isValidPoint(w?.start) || !isValidPoint(w?.end)) return null;
  const s = w.start as { x: number; y: number };
  const e = w.end as { x: number; y: number };
  const a = `${round2(s.x)},${round2(s.y)}`;
  const b = `${round2(e.x)},${round2(e.y)}`;
  const [p, q] = a <= b ? [a, b] : [b, a];
  return `${p}|${q}|${round2(w.thicknessM)}|${round2(w.heightM)}`;
}

function envelopeVerticesKey(envelope: unknown): string {
  const e = envelope as { vertices?: unknown } | null;
  if (e == null) return "null";
  const vertices = Array.isArray(e.vertices) ? e.vertices : [];
  return vertices
    .map((v) =>
      isValidPoint(v)
        ? `${round2((v as { x: number }).x)},${round2((v as { y: number }).y)}`
        : "?"
    )
    .join(";");
}

function validateGeometryDrift(geometryResult: unknown, openingsResult: unknown): string[] {
  const issues: string[] = [];
  const g = geometryResult as { buildingEnvelope?: unknown; rooms?: unknown };
  const o = openingsResult as { buildingEnvelope?: unknown; rooms?: unknown };

  if (envelopeVerticesKey(g?.buildingEnvelope) !== envelopeVerticesKey(o?.buildingEnvelope)) {
    issues.push(
      "buildingEnvelope changed between the geometry pass and the openings pass - " +
        "it must be returned exactly as given",
    );
  }

  const geometryRooms = Array.isArray(g?.rooms) ? (g.rooms as RoomLike[]) : [];
  const openingsRooms = Array.isArray(o?.rooms) ? (o.rooms as RoomLike[]) : [];
  const geometryById = new Map(geometryRooms.map((r) => [String(r?.id), r]));
  const openingsById = new Map(openingsRooms.map((r) => [String(r?.id), r]));

  for (const id of geometryById.keys()) {
    if (!openingsById.has(id)) {
      issues.push(`room ${id} was present in the geometry pass but is missing from the openings pass`);
    }
  }
  for (const id of openingsById.keys()) {
    if (!geometryById.has(id)) {
      issues.push(`room ${id} was not present in the geometry pass but was invented in the openings pass`);
    }
  }

  for (const [id, gRoom] of geometryById) {
    const oRoom = openingsById.get(id);
    if (!oRoom) continue;

    const gOrigin = gRoom.origin as { x?: unknown; y?: unknown } | undefined;
    const oOrigin = oRoom.origin as { x?: unknown; y?: unknown } | undefined;
    if (
      round2(gOrigin?.x) !== round2(oOrigin?.x) ||
      round2(gOrigin?.y) !== round2(oOrigin?.y) ||
      round2(gRoom.widthM) !== round2(oRoom.widthM) ||
      round2(gRoom.lengthM) !== round2(oRoom.lengthM) ||
      round2(gRoom.heightM) !== round2(oRoom.heightM) ||
      (gRoom.floorMaterial ?? null) !== (oRoom.floorMaterial ?? null)
    ) {
      issues.push(
        `room ${id}: origin/widthM/lengthM/heightM/floorMaterial changed between the geometry ` +
          `and openings passes`,
      );
    }

    const gWalls = Array.isArray(gRoom.walls) ? gRoom.walls : [];
    const oWalls = Array.isArray(oRoom.walls) ? oRoom.walls : [];
    const gKeys = gWalls.map(wallGeometryKey).filter((k): k is string => k !== null).sort();
    const oKeys = oWalls.map(wallGeometryKey).filter((k): k is string => k !== null).sort();
    if (gKeys.length !== oKeys.length || gKeys.some((k, i) => k !== oKeys[i])) {
      issues.push(
        `room ${id}: wall coordinates/thickness/height changed between the geometry and openings passes`,
      );
    }
  }

  return issues;
}

// --- OpenAI call helpers ---------------------------------------------------

async function callOpenAiJsonSchema(
  messages: Array<{ role: string; content: unknown }>,
  schemaName: string,
  schema: unknown,
): Promise<{ ok: true; parsed: unknown; usage: Record<string, unknown> } | { ok: false; detail: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        seed: 20260910,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });
  } catch (err) {
    return { ok: false, detail: `connection error calling OpenAI: ${String(err)}` };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, detail: `OpenAI API error: ${response.status} ${errorText}` };
  }

  const openaiJson = await response.json();
  const rawContent = openaiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return { ok: false, detail: "OpenAI response missing content" };
  }

  try {
    const parsed = JSON.parse(rawContent);
    return { ok: true, parsed, usage: openaiJson?.usage ?? {} };
  } catch (err) {
    return { ok: false, detail: `failed to parse OpenAI JSON content: ${String(err)}` };
  }
}

function describeScopeForPrompt(scope: unknown): string | null {
  const s = scope as {
    mainFloorPlanBboxPct?: { xMinPct?: number; yMinPct?: number; xMaxPct?: number; yMaxPct?: number };
    excludedRegions?: Array<{ bboxPct?: { xMinPct?: number; yMinPct?: number; xMaxPct?: number; yMaxPct?: number }; reason?: string }>;
  };
  if (!s?.mainFloorPlanBboxPct) return null;

  const b = s.mainFloorPlanBboxPct;
  const lines: string[] = [];
  lines.push(
    `תוכנית הקומה הראשית זוהתה בשלב מקדים באזור (באחוזים מהתמונה): ` +
      `x: ${b.xMinPct}-${b.xMaxPct}, y: ${b.yMinPct}-${b.yMaxPct}.`,
  );

  const excluded = Array.isArray(s.excludedRegions) ? s.excludedRegions : [];
  if (excluded.length > 0) {
    lines.push("האזורים הבאים זוהו כפרטים/חתכים נפרדים - התעלם/י מהם לחלוטין:");
    for (const region of excluded) {
      const rb = region?.bboxPct;
      const reason = region?.reason ?? "לא צוינה סיבה";
      if (rb) {
        lines.push(
          `- x: ${rb.xMinPct}-${rb.xMaxPct}, y: ${rb.yMinPct}-${rb.yMaxPct} (${reason})`,
        );
      }
    }
  } else {
    lines.push("לא זוהו אזורי פרטים/חתכים נפרדים - כל הדף שייך לתוכנית הקומה.");
  }

  return lines.join("\n");
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

  // --- Pass 0: scope --------------------------------------------------
  // Best-effort. A failure here degrades gracefully to "no scope
  // guidance" rather than failing the whole analysis - Pass 1 still runs
  // exactly as it would have before v14 in that case.
  let scopeDescription: string | null = null;
  let scopeUsage: Record<string, unknown> | null = null;
  const scopeResult = await callOpenAiJsonSchema(
    [
      { role: "system", content: SCOPE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "זהה/י את אזור תוכנית הקומה הראשית בתמונה המצורפת." },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
    "drawing_scope",
    DRAWING_SCOPE_JSON_SCHEMA,
  );

  if (scopeResult.ok) {
    scopeDescription = describeScopeForPrompt(scopeResult.parsed);
    scopeUsage = scopeResult.usage;
  } else {
    console.error(`[analyze-sketch] scope pass failed (continuing without it): ${scopeResult.detail}`);
  }
  // --- Pass 1A: geometry (buildingEnvelope/rooms/walls only) ------------
  // openings/stairs/specialElements are required to stay empty here -
  // see GEOMETRY_SYSTEM_PROMPT. Accumulating corrective-retry loop,
  // same mechanism v13 introduced, now also covering the v15
  // room-coverage-gap check (in validateFloorPlanResult).
  const geometryUserText = scopeDescription
    ? `נתח/י את מעטפת הבניין וחלוקתו לחדרים (שלב גיאומטריה בלבד) לפי הכללים והסכמה שקיבלת.\n\n${scopeDescription}`
    : "נתח/י את מעטפת הבניין וחלוקתו לחדרים (שלב גיאומטריה בלבד) לפי הכללים והסכמה שקיבלת.";

  const geometryMessages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: GEOMETRY_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: geometryUserText },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    },
  ];

  let geometryResult: unknown = null;
  let geometryUsage: Record<string, unknown> = {};
  let geometryValidationIssues: string[] = [];
  let geometryAttemptsUsed = 0;
  let lastErrorDetail: string | null = null;

  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt++) {
    geometryAttemptsUsed = attempt;

    const attemptResult = await callOpenAiJsonSchema(
      geometryMessages,
      "floor_plan_geometry",
      FLOOR_PLAN_JSON_SCHEMA,
    );

    if (!attemptResult.ok) {
      lastErrorDetail = attemptResult.detail;
      console.error(
        `[analyze-sketch] geometry pass attempt ${attempt}/${MAX_ANALYSIS_ATTEMPTS} failed: ${lastErrorDetail}`,
      );
      break;
    }

    geometryResult = attemptResult.parsed;
    geometryUsage = attemptResult.usage;
    geometryValidationIssues = validateFloorPlanResult(geometryResult);

    if (geometryValidationIssues.length === 0) break;

    const willRetry = attempt < MAX_ANALYSIS_ATTEMPTS;
    console.error(
      `[analyze-sketch] geometry pass attempt ${attempt}/${MAX_ANALYSIS_ATTEMPTS} validation issues ` +
        `(${willRetry ? "retrying with feedback" : "giving up, returning best effort"}): ` +
        JSON.stringify(geometryValidationIssues),
    );

    if (!willRetry) break;

    geometryMessages.push({ role: "assistant", content: JSON.stringify(geometryResult) });
    geometryMessages.push({
      role: "user",
      content:
        "בתשובה הקודמת נמצאו הבעיות המבניות הבאות, שחייבות תיקון:\n" +
        geometryValidationIssues.map((issue) => `- ${issue}`).join("\n") +
        "\n\nהחזר/י תשובה מתוקנת מלאה לפי אותה סכמה בדיוק (openings/stairs/specialElements עדיין " +
        "ריקים בשלב הזה - הם יתווספו בשלב נפרד). שנה/י רק את מה שנדרש כדי לפתור את הבעיות שצוינו " +
        "למעלה - אל תשנה/י דברים שכבר היו נכונים בתשובה הקודמת.",
    });
  }

  if (geometryResult === null) {
    await fail(lastErrorDetail ?? "unknown error during geometry analysis");
    return jsonResponse(
      { error: "openai_error", detail: lastErrorDetail, analysisId },
      502,
    );
  }

  // --- Pass 1B: openings/stairs/specialElements, given fixed geometry ---
  // The confirmed geometry from Pass 1A is handed back as if it were the
  // model's own prior answer, under OPENINGS_SYSTEM_PROMPT's explicit
  // instruction not to touch it. validateGeometryDrift is what actually
  // verifies that instruction was followed, each attempt.
  const openingsUserText =
    "כעת השלם/י פתחים, מדרגות ואלמנטים מיוחדים (שלב שני) על גבי הגיאומטריה שכבר אושרה למעלה, לפי הכללים.";

  const openingsMessages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: OPENINGS_SYSTEM_PROMPT },
    geometryMessages[1], // the original user turn (text + image) that produced the confirmed geometry
    { role: "assistant", content: JSON.stringify(geometryResult) },
    { role: "user", content: openingsUserText },
  ];

  let openingsResult: unknown = null;
  let openingsUsage: Record<string, unknown> = {};
  let openingsValidationIssues: string[] = [];
  let openingsAttemptsUsed = 0;

  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt++) {
    openingsAttemptsUsed = attempt;

    const attemptResult = await callOpenAiJsonSchema(
      openingsMessages,
      "floor_plan_openings",
      FLOOR_PLAN_JSON_SCHEMA,
    );

    if (!attemptResult.ok) {
      lastErrorDetail = attemptResult.detail;
      console.error(
        `[analyze-sketch] openings pass attempt ${attempt}/${MAX_ANALYSIS_ATTEMPTS} failed: ${lastErrorDetail}`,
      );
      break;
    }

    openingsResult = attemptResult.parsed;
    openingsUsage = attemptResult.usage;

    const driftIssues = validateGeometryDrift(geometryResult, openingsResult);
    const contentIssues = validateFloorPlanResult(openingsResult);
    openingsValidationIssues = [...driftIssues, ...contentIssues];

    if (openingsValidationIssues.length === 0) break;

    const willRetry = attempt < MAX_ANALYSIS_ATTEMPTS;
    console.error(
      `[analyze-sketch] openings pass attempt ${attempt}/${MAX_ANALYSIS_ATTEMPTS} validation issues ` +
        `(${willRetry ? "retrying with feedback" : "giving up, returning best effort"}): ` +
        JSON.stringify(openingsValidationIssues),
    );

    if (!willRetry) break;

    openingsMessages.push({ role: "assistant", content: JSON.stringify(openingsResult) });
    openingsMessages.push({
      role: "user",
      content:
        "בתשובה הקודמת נמצאו הבעיות הבאות, שחייבות תיקון:\n" +
        openingsValidationIssues.map((issue) => `- ${issue}`).join("\n") +
        "\n\nהחזר/י תשובה מתוקנת מלאה לפי אותה סכמה בדיוק. אם צוין ששינית קואורדינטות/מידות " +
        "שהיו כבר קבועות - החזר/י אותן בדיוק כפי שניתנו לך במקור (בתשובה שלפני-הקודמת), ותקן/י " +
        "רק את openings/stairs/specialElements. אל תשנה/י דברים שכבר היו נכונים.",
    });
  }

  if (openingsResult === null) {
    await fail(lastErrorDetail ?? "unknown error during openings analysis");
    return jsonResponse(
      { error: "openai_error", detail: lastErrorDetail, analysisId },
      502,
    );
  }

  const result = openingsResult;
  const computedAreaSqm = computeAreaSqm(result);

  const mergedUsage: Record<string, unknown> = {
    prompt_tokens: (Number(geometryUsage.prompt_tokens) || 0) + (Number(openingsUsage.prompt_tokens) || 0),
    completion_tokens:
      (Number(geometryUsage.completion_tokens) || 0) + (Number(openingsUsage.completion_tokens) || 0),
    total_tokens: (Number(geometryUsage.total_tokens) || 0) + (Number(openingsUsage.total_tokens) || 0),
  };

  const { error: updateError } = await supabase
    .from("sketch_analyses")
    .update({
      status: "completed",
      result_json: result,
      input_tokens: mergedUsage.prompt_tokens ?? null,
      output_tokens: mergedUsage.completion_tokens ?? null,
    })
    .eq("id", analysisId);

  if (updateError) {
    return jsonResponse({ error: "internal_error", detail: "failed to save result", analysisId }, 500);
  }

  const allValidationIssues = [...geometryValidationIssues, ...openingsValidationIssues];

  return jsonResponse({
    analysisId,
    result,
    computedAreaSqm,
    usage: mergedUsage,
    geometryUsage,
    openingsUsage,
    scopeUsage,
    analysisAttempts: geometryAttemptsUsed + openingsAttemptsUsed,
    geometryAttempts: geometryAttemptsUsed,
    openingsAttempts: openingsAttemptsUsed,
    ...(allValidationIssues.length > 0 ? { validationIssues: allValidationIssues } : {}),
  });
});
