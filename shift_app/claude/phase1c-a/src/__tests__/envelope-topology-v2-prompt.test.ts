// claude/phase1c-a/src/__tests__/envelope-topology-v2-prompt.test.ts
//
// Regression tests for the EnvelopeTopology V2 RAW-perception system
// prompt. These lock the ARCHITECTURAL INVARIANTS the prompt text is now
// carrying, so a later edit cannot silently delete or reverse them.
//
// SCOPE / HONEST LIMITATION: these are TEXT assertions. They prove a rule
// is present and correctly worded; they cannot prove the model obeys it.
// The only real verification of perception stability is repeated
// production runs on the same crop, compared for vertex/edge-count
// variance. Do not let a green suite here create false confidence.
//
// The prompt is reached through the symlink at
// claude/phase1c-a/src/envelope_topology_system_prompt_v2.ts, which points
// at supabase/functions/_shared/envelope_topology_system_prompt_v2.ts —
// same precedent as the schema/validator symlinks, so these tests always
// run against the real production prompt, never a copy that could drift.
//
// Deliberately NO filesystem access here (no node:fs / node:path /
// node:url). The producer's own import of this prompt is covered at
// compile time by `deno check
// supabase/functions/analyze-sketch-v2-envelope-topology/index.ts`, which
// is the right layer for that check — reading source files from disk at
// test time would couple this suite to repo layout for no added safety.
//
// Assertion style matches this package's existing tests: node:test plus
// node:assert/strict, using only assert.ok / assert.equal (this package's
// StrictAssert typing does not expose assert.match / assert.doesNotMatch).
// Every regex below is flag-free or /i only — never /g or /y, whose
// lastIndex state would leak between .test() calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2 } from '../envelope_topology_system_prompt_v2.js';

const prompt = ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2;

// The prompt is hard-wrapped for readability, so any phrase spanning a line
// break carries a newline plus indentation in the middle. Assertions about
// such phrases run against this whitespace-normalized view instead, so a
// future re-wrap of the same words never fails the suite (only an actual
// wording change should). Single-line phrases assert against `prompt`
// directly. (The /g here is on .replace(), not .test() — no lastIndex
// state is retained anywhere in this file.)
const flat = prompt.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------
// 1. The four legitimate vertex-creating events
// ---------------------------------------------------------------------

test('prompt declares a dedicated "when a vertex is created — and when not" section', () => {
  assert.ok(/מתי נוצרת פינה \(vertex\) - ומתי לא/.test(prompt));
});

test('prompt enumerates all four legitimate vertex-creating events', () => {
  // visible wall start / visible wall end / genuine visible direction
  // change (jog, recess, notch, diagonal transition) / genuine visible
  // topology-changing junction.
  assert.ok(/התחלה נראית לעין של קיר/.test(prompt), 'missing: visible wall start');
  assert.ok(/סיום נראה לעין של קיר/.test(prompt), 'missing: visible wall end');
  assert.ok(/שינוי כיוון אמיתי ונראה לעין/.test(prompt), 'missing: genuine visible direction change');
  assert.ok(/jog, שקע \(recess\), חריץ \(notch\)/.test(prompt), 'missing: jog/recess/notch enumeration');
  assert.ok(/מעבר לאלכסון/.test(prompt), 'missing: diagonal transition');
  assert.ok(
    /צומת אמיתי ונראה לעין שמשנה את הטופולוגיה/.test(prompt),
    'missing: genuine topology-changing junction',
  );
});

// ---------------------------------------------------------------------
// 2. All eight non-vertex triggers
// ---------------------------------------------------------------------

test('prompt forbids subdividing one continuous straight wall', () => {
  assert.ok(/קיר פיזי אחד שנראה \*\*ישר ורציף\*\* - אסור לפצל אותו/.test(prompt));
});

test('prompt enumerates all eight excluded subdivision triggers', () => {
  const excluded: Array<[string, RegExp]> = [
    ['text/dimension annotations', /טקסט\/הערות\/מידות כתובות שעוברים עליו/],
    ['dimension lines', /קווי מידה \(dimension lines\)/],
    ['non-terminating opening/window graphics', /גרפיקה של פתח\/חלון שאינה מסיימת בפועל/],
    ['hatch/fill/color change', /שינוי בהצללה\/מילוי\/צבע \(hatch\/fill\/color\)/],
    ['line-weight change', /שינוי בעובי הקו \(line weight\)/],
    ['confidence change', /שינוי ברמת הביטחון שלך/],
    ['furniture/symbol intersection', /חיתוך עם ריהוט או סמלים/],
    ['arbitrary intermediate sampling', /נקודות דגימה שרירותיות באמצע הקיר/],
  ];
  for (const [label, re] of excluded) {
    assert.ok(re.test(prompt), `missing excluded subdivision trigger: ${label}`);
  }
  assert.equal(excluded.length, 8);
});

// ---------------------------------------------------------------------
// 3. Uncertainty routed to roleHint/perceptionNotes, not extra vertices
// ---------------------------------------------------------------------

test('uncertainty along one continuous straight wall is routed to roleHint/perceptionNotes, never to extra vertices', () => {
  assert.ok(/אם יש חוסר ודאות \*\*לאורך אותו קיר ישר ורציף עצמו\*\*/.test(prompt));
  assert.ok(/roleHint \("uncertain"\) ו\/או הערה ב-perceptionNotes/.test(prompt));
  assert.ok(/\*\*לא\*\* דרך יצירת פינות נוספות שרירותיות/.test(flat));
});

// ---------------------------------------------------------------------
// 4. Short-but-real geometry is explicitly preserved
// ---------------------------------------------------------------------

test('prompt explicitly preserves genuinely short geometry regardless of shortness', () => {
  assert.ok(
    /צלע \*\*קצרה\*\* בין שתי נקודות שנראות לעין כשונות זו מזו היא עדות \*\*תקינה לחלוטין\*\*/.test(flat),
  );
  assert.ok(/\*\*לא משנה כמה הם קצרים\*\*/.test(prompt));
  assert.ok(/אין שום סף-אורך שמתחתיו צלע אמיתית נמחקת/.test(flat));
});

test('prompt states the degeneracy distinction as coincident-vs-distinct, not long-vs-short', () => {
  assert.ok(
    /ההבדל הוא בין נקודות \*\*חופפות\*\* \(מנוון - לא לייצר\) לבין נקודות \*\*שונות אך קרובות\*\* \(אמיתי - לשמור\)/.test(
      flat,
    ),
  );
});

// ---------------------------------------------------------------------
// 5. No numeric near-zero degeneracy band (the regression that matters)
// ---------------------------------------------------------------------

test('prompt contains NO numeric near-zero length threshold', () => {
  // An earlier revision carried a "0.0-0.1 percent" band which disagreed
  // with the validator's own ZERO_LENGTH_EPSILON_PCT_V2 = 0.05 and, being
  // a pure length test, risked teaching the model to delete real short
  // geometry. The prompt must never again carry ANY length threshold —
  // enforcing the numeric floor is the validator's job alone.
  assert.ok(!/0\.0-0\.1/.test(prompt), 'prompt must not carry a 0.0-0.1 band');
  assert.ok(!/0\.1 אחוז/.test(prompt), 'prompt must not carry a 0.1 percent threshold');
  assert.ok(!/0\.05/.test(prompt), "prompt must not restate the validator's epsilon");
  assert.ok(!/הפרש של 0\./.test(flat), 'prompt must not express a numeric coordinate delta');
});

test('self-check item 1 is expressed as same-location coincidence, not as a length test', () => {
  assert.ok(/כל צלע חייבת לחבר שתי נקודות \*\*שונות במיקומן\*\* בתמונה/.test(prompt));
  assert.ok(
    /שתי נקודות שנמצאות בפועל \*\*באותו מיקום\*\* \(נקודות חופפות\), זו עדות מנוונת/.test(flat),
  );
});

test('the remedy for a would-be degenerate edge is to NOT EMIT it', () => {
  assert.ok(/\*\*אל תתעד\/י את הצלע הזו בכלל\*\*/.test(flat));
});

test('prompt NEVER instructs using the same vertex id for both ends of an edge (self-edge)', () => {
  // A self-edge is exactly the zero-length structural corruption item 1
  // exists to prevent — it must never be offered as the remedy for
  // coincident endpoints. Both the explicit prohibition and the absence
  // of the old "use the same vertex twice" phrasing are locked here.
  assert.ok(
    /\*\*אל תשתמש\/י באותו מזהה פינה גם ב-fromVertexId וגם ב-toVertexId\*\*/.test(flat),
    'missing explicit self-edge prohibition in item 1',
  );
  assert.ok(/צלע שמצביעה מפינה אל עצמה היא בדיוק אותה עדות מנוונת, לא פתרון לה/.test(flat));
  assert.ok(
    /בשום מקרה אל תייצר\/י צלע שמחברת פינה אל עצמה/.test(flat),
    'missing explicit self-edge prohibition in item 2',
  );
  // Negative: the old, unsafe remedy must not reappear in any form.
  assert.ok(!/באותה פינה \(אותו id\) פעמיים/.test(flat), 'old unsafe self-edge remedy returned');
  assert.ok(!/להשתמש באותה פינה פעמיים/.test(flat), 'old unsafe self-edge remedy returned');
  assert.ok(!/אותה פינה פעמיים/.test(flat), 'old unsafe self-edge remedy returned');
});

test('self-check item 2 resolves coincident vertices without ever implying a self-edge', () => {
  assert.ok(/או שזו באמת פינה אחת - ואז תעד\/י אותה כפינה אחת בלבד/.test(flat));
  assert.ok(/וכל הצלעות \*\*השונות\*\* שנפגשות בה יפנו לאותו מזהה/.test(flat));
  assert.ok(/או שאין שם קודקוד אמיתי בכלל - ואז אל תתעד\/י אותו/.test(flat));
});

// ---------------------------------------------------------------------
// 6. "All candidates" scoped to genuinely distinct physical locations
// ---------------------------------------------------------------------

test('"all candidates" is scoped to genuinely distinct physical boundary candidates at different image locations', () => {
  assert.ok(/קווים מועמדים אפשריים \*\*במיקומים שונים בתמונה\*\*/.test(prompt));
  assert.ok(/פאה פנימית מול פאה חיצונית של אותו קיר/.test(prompt));
  assert.ok(
    /"כל המועמדים" פירושו מועמדי-גבול פיזיים \*\*שונים באמת, במיקומים שונים בתמונה\*\*/.test(flat),
  );
  assert.ok(/פיצול של אותו קיר עצמו אינו "עוד מועמד"/.test(prompt));
});

test('the final completeness sweep is scoped to undocumented walls, not to further subdivision', () => {
  assert.ok(
    /הסבב הזה נועד למצוא \*\*קיר שלא תיעדת בכלל\*\*, לא לפצל קיר רציף שכבר תיעדת לעוד קטעים/.test(
      flat,
    ),
  );
});

// ---------------------------------------------------------------------
// 7. No deterministic-repair language anywhere
// ---------------------------------------------------------------------

test('prompt contains no merge/snap/consolidate/deterministic-repair language', () => {
  assert.ok(!/merge/i.test(prompt), 'prompt must not contain merge language');
  assert.ok(!/snap/i.test(prompt), 'prompt must not contain snap language');
  assert.ok(!/consolidat/i.test(prompt), 'prompt must not contain consolidate language');
  assert.ok(!/מיזוג/.test(prompt), 'prompt must not contain merge language (he)');
  assert.ok(!/למזג/.test(prompt), 'prompt must not contain merge language (he)');
  assert.ok(!/להצמיד/.test(prompt), 'prompt must not contain snap language (he)');
});

// ---------------------------------------------------------------------
// 8. Pre-existing locked invariants must survive this change
// ---------------------------------------------------------------------

test('no forced closure: a closed polygon is explicitly NOT required', () => {
  assert.ok(/\*\*לא\*\* נדרש\/ת להחזיר פוליגון סגור/.test(prompt));
  assert.ok(/אל תדחה\/י ראיה חזותית אמיתית רק כי היא לא "סוגרת" משהו/.test(flat));
});

test('no invented hidden continuation', () => {
  assert.ok(/אל תמציא\/י המשך נסתר/.test(flat));
  assert.ok(/\*\*להמציא המשך נסתר\*\*/.test(prompt));
});

test('open and disconnected evidence remains explicitly allowed', () => {
  assert.ok(/אינו נסגר למעגל אחד, או שיש בו יותר ממרכיב מחובר אחד/.test(prompt));
  assert.ok(/זה תקין ומצופה/.test(prompt));
  assert.ok(/פלט פתוח, לא-מחובר, או חלקי \*\*עדיף\*\*/.test(prompt));
});

test('no metrics, area, or scale reasoning in this stage', () => {
  assert.ok(/לכתוב שום ערך במטרים\/ס"מ\/מ"מ/.test(prompt));
  assert.ok(/לחשב או להעריך שטח/.test(prompt));
  assert.ok(/להמציא scale\/קנה-מידה/.test(prompt));
  assert.ok(/להחזיר "dimensionRefs"/.test(prompt));
});

test('polygonOrder remains explicitly prohibited', () => {
  assert.ok(/להחזיר "polygonOrder"/.test(prompt));
  assert.ok(/שדה כזה לא קיים יותר ואסור להמציא אותו/.test(flat));
});

test('the FINAL STRUCTURAL SELF-CHECK section is still present', () => {
  assert.ok(/FINAL STRUCTURAL SELF-CHECK/.test(prompt));
  assert.ok(/בדיקה עצמית מבנית סופית/.test(prompt));
});
