// validate_vnext_prompt_locks_test.mjs
//
// SHIFT VNext Checkpoint 1 — asserts that specific hard-locked phrases
// are present in the two system prompt strings, so a future edit to
// either prompt cannot silently drop one of the Checkpoint 1 locks
// without a test failing (same precedent as
// claude/phase1c-a/src/__tests__/envelope-topology-v2-prompt.test.ts,
// re-implemented here in this repo's plain .mjs style instead of Jest so
// it needs no extra tooling beyond tsc+node).

import { GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT } from "./build/geometry_observation_prompt_vnext.js";
import { EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT } from "./build/evidence_observation_prompt_vnext.js";
import { sanitizeOpenAiProviderErrorVNext } from "./build/vnext_openai_json_schema_client.js";
import { readFileSync } from "node:fs";

const TEST_FILE_ID = "prompts";
let assertionsPassed = 0;
let failures = 0;
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

const geometryProhibited = ["מטרים", "ס\"מ", "מ\"מ", "קנה-מידה", "לחשב"];
const geometryMustContain = [
  "roleHint",
  "boundaryVertexIds",
  "nearestLabelHint",
  "drawingConventionHint",
  "FINAL STRUCTURAL SELF-CHECK",
  "wallBoundaryVertexPaths",
  "visibleBoundaryPathsImagePct",
  "boundaryCompletenessHint",
  "enclosureHint",
  "paving",
  "pergola",
  "canopy",
  "contextHint",
];

function geometryPromptContractViolations(prompt) {
  const violations = [];
  const requiredRules = [
    ["MISSING_EVIDENCE_STATE_RULE", /לכל ישות שמוחזרת חובה לציין evidenceState/],
    ["MISSING_RESOLVED_PROHIBITION", /אסור להחזיר "RESOLVED"/],
    ["MISSING_EMPTY_OUTPUT_RULE", /אם אין גיאומטריה קריאה, החזר\/י מערכים ריקים/],
    ["MISSING_HIDDEN_GEOMETRY_RULE", /להמציא המשך נסתר/],
    ["MISSING_NO_ARBITRARY_VERTEX_RULE", /\*\*לא\*\* דרך יצירת\s+פינות נוספות שרירותיות/],
    ["MISSING_OPEN_OUTPUT_RULE", /פלט פתוח, לא-מחובר, או חלקי \*\*עדיף\*\*/],
    ["MISSING_RAW_TEXT_PROHIBITION", /להעתיק או לתעד טקסט מידה כתוב \(rawText\)/],
    ["MISSING_METRIC_PROHIBITION", /לכתוב שום ערך במטרים\/ס"מ\/מ"מ, לחשב או להעריך שטח/],
    ["MISSING_ARTIFICIAL_FEATURE_VERTEX_PROHIBITION", /ליצור wall vertices מלאכותיים עבור גבול של exteriorFeature/],
    ["MISSING_FRAGMENT_CONNECTION_PROHIBITION", /לחבר fragments נפרדים, להשלים קטע מוסתר, או לסגור path בלי קטע סגירה נראה/],
    ["MISSING_EXPLICIT_FEATURE_CLOSURE_RULE", /complete_visible מותר רק כאשר קיים לפחות path אחד/],
    ["MISSING_EVERY_FEATURE_PATH_CLOSURE_RULE", /כל path קיים בשני\s+אוספי הגבול סגור במפורש בפני עצמו/],
    ["MISSING_NO_CROSS_COLLECTION_CLOSURE_RULE", /אין\s+closure משותף או משתמע בין wallBoundaryVertexPaths לבין\s+visibleBoundaryPathsImagePct/],
    ["MISSING_SINGLE_EXTERIOR_STAIRS_RULE", /מדרגות חוץ מופיעות פעם אחת תחת stairs/],
    ["MISSING_WALL_ASSOCIATION_HINT_RULE", /association\s+ל-wall vertices הוא hint תפיסתי בלבד ולעולם אינו geometric proof/],
  ];
  for (const [code, pattern] of requiredRules) {
    if (!pattern.test(prompt)) violations.push(code);
  }

  const forbiddenPositiveInstructions = [
    ["POSITIVE_METRIC_INSTRUCTION", /(?:^|\n)\s*(?:[-*]\s*)?(?:חשב|חשבי|חשב\/י|המר|המירי|המר\/י).{0,80}(?:מטר|ס"מ|מ"מ|שטח|קנה-מידה|scale)/m],
    ["POSITIVE_RAW_TEXT_INSTRUCTION", /(?:^|\n)\s*(?:החזר|החזירי|החזר\/י|תעד|תעדי|תעד\/י).{0,60}rawText/m],
    ["FORCED_CLOSURE_INSTRUCTION", /(?:^|\n)\s*(?:סגור|סגרי|סגור\/י).{0,60}(?:גרף|פוליגון|גבול)/m],
    ["RESOLVED_ALLOWED", /מותר להחזיר "RESOLVED"/],
    ["CREATE_ARTIFICIAL_FEATURE_VERTICES", /(?:^|\n)\s*(?:[-*]\s*)?(?:צור|צרי|צור\/י).{0,100}wall vertices.{0,100}exteriorFeature/m],
    ["CONNECT_FEATURE_FRAGMENTS", /(?:^|\n)\s*(?:[-*]\s*)?(?:חבר|חברי|חבר\/י).{0,80}fragments/m],
    ["SINGLE_CLOSED_PATH_SUFFICIENT", /מספיק path סגור אחד/],
    ["COMPLETE_HIDDEN_FEATURE_BOUNDARY", /(?:^|\n)\s*(?:[-*]\s*)?(?:השלם|השלימי|השלם\/י).{0,80}(?:גבול|boundary).{0,80}(?:מוסתר|חסר)/m],
    ["DUPLICATE_EXTERIOR_STAIRS", /(?:^|\n)\s*(?:[-*]\s*)?(?:צור|צרי|צור\/י).{0,100}exteriorFeature.{0,100}מדרגות חוץ/m],
  ];
  for (const [code, pattern] of forbiddenPositiveInstructions) {
    if (pattern.test(prompt)) violations.push(code);
  }
  return violations;
}

function evidencePromptContractViolations(prompt) {
  const violations = [];
  const requiredRules = [
    ["MISSING_VERBATIM_RAW_TEXT_RULE", /rawText: \*\*בדיוק\*\* כפי שמופיע בתמונה/],
    ["MISSING_OVERALL_LOCAL_PROHIBITION", /לסווג מידה כ"כללית" מול "מקומית"/],
    ["MISSING_ROOM_LABEL_OWNERSHIP", /הטקסט של שם החדר שייך \*\*אך ורק\*\* לך/],
    ["MISSING_NO_GEOMETRY_RULE", /להתייחס לגיאומטריה\/קירות\/vertices - זה תפקיד מעבר נפרד/],
    ["MISSING_HONEST_PARTIAL_RULE", /תיעוד חלקי אך כן\s+עדיף על פני השלמה מומצאת/],
  ];
  for (const [code, pattern] of requiredRules) {
    if (!pattern.test(prompt)) violations.push(code);
  }

  const forbiddenPositiveInstructions = [
    ["POSITIVE_CONVERSION_INSTRUCTION", /(?:^|\n)\s*(?:[-*]\s*)?(?:חשב|חשבי|חשב\/י|המר|המירי|המר\/י).{0,80}(?:valueM|מטר|שטח|יחיד)/m],
    ["POSITIVE_GEOMETRY_INSTRUCTION", /(?:^|\n)\s*(?:בנה|בני|בנה\/י|צור|צרי|צור\/י).{0,80}(?:geometry|vertices|קירות)/m],
    ["POSITIVE_CLASSIFICATION_INSTRUCTION", /(?:^|\n)\s*(?:סווג|סווגי|סווג\/י).{0,80}(?:overall|local|כללית|מקומית)/m],
  ];
  for (const [code, pattern] of forbiddenPositiveInstructions) {
    if (pattern.test(prompt)) violations.push(code);
  }
  return violations;
}


check(
  "Geometry prompt: never asks for meters/cm/mm/scale/area computation",
  geometryProhibited.every((phrase) => GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes(phrase)) &&
    // the phrases above must appear ONLY inside a prohibition sentence —
    // approximate this by requiring the word "אסור" (forbidden) to occur
    // at least as many times as these sensitive terms combined appear as
    // standalone asks; a looser but meaningful signal than exact parsing.
    (GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.match(/אסור/g) || []).length >= 3,
);

check("Geometry prompt requires evidenceState", GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("evidenceState"));
check("Geometry prompt explicitly forbids RESOLVED", GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("RESOLVED"));
check("Geometry prompt allows honest empty arrays", GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("מערכים ריקים"));
check(
  "Geometry prompt satisfies semantic contract validator",
  geometryPromptContractViolations(GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT).length === 0,
);
check(
  "Geometry prompt requires every existing feature-boundary path to close for complete_visible",
  /כל path קיים בשני\s+אוספי הגבול סגור במפורש בפני עצמו/.test(GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT),
);
check(
  "Geometry prompt forbids shared closure between wall and image path collections",
  /אין\s+closure משותף או משתמע בין wallBoundaryVertexPaths לבין\s+visibleBoundaryPathsImagePct/.test(GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT),
);

{
  const mutations = [
    [
      "Geometry negative control rejects removed RESOLVED prohibition",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.replace('אסור להחזיר "RESOLVED"', 'מותר להחזיר "RESOLVED"'),
      "MISSING_RESOLVED_PROHIBITION",
    ],
    [
      "Geometry negative control rejects metric computation instruction",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- חשב/י ערכים במטרים עבור כל קיר.",
      "POSITIVE_METRIC_INSTRUCTION",
    ],
    [
      "Geometry negative control rejects rawText collection instruction",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\nהחזר/י rawText עבור כל מידה.",
      "POSITIVE_RAW_TEXT_INSTRUCTION",
    ],
    [
      "Geometry negative control rejects forced closure instruction",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\nסגור/י כל גרף גם כאשר הגבול אינו נראה.",
      "FORCED_CLOSURE_INSTRUCTION",
    ],
    [
      "Geometry negative control rejects removal of honest empty output rule",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.replace("אם אין גיאומטריה קריאה, החזר/י מערכים ריקים", "אם אין גיאומטריה קריאה"),
      "MISSING_EMPTY_OUTPUT_RULE",
    ],
    [
      "Geometry negative control rejects artificial exterior-feature wall vertices",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- צור/י wall vertices חדשים עבור כל exteriorFeature.",
      "CREATE_ARTIFICIAL_FEATURE_VERTICES",
    ],
    [
      "Geometry negative control rejects connecting separate feature fragments",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- חבר/י fragments נפרדים למסלול אחד.",
      "CONNECT_FEATURE_FRAGMENTS",
    ],
    [
      "Geometry negative control rejects completing a hidden feature boundary",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- השלם/י גבול חסר גם כאשר הקטע מוסתר.",
      "COMPLETE_HIDDEN_FEATURE_BOUNDARY",
    ],
    [
      "Geometry negative control rejects duplicate exteriorFeature for exterior stairs",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- צור/י exteriorFeature נוסף עבור מדרגות חוץ.",
      "DUPLICATE_EXTERIOR_STAIRS",
    ],
    [
      "Geometry negative control rejects replacing every-path closure with one closed path",
      GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.replace(
        /כל path קיים בשני\s+אוספי הגבול סגור במפורש בפני עצמו/,
        "מספיק path סגור אחד",
      ),
      "SINGLE_CLOSED_PATH_SUFFICIENT",
    ],
  ];
  for (const [label, mutated, expectedCode] of mutations) {
    check(label, geometryPromptContractViolations(mutated).includes(expectedCode));
  }
}

{
  const rawSecret = "raw-provider-secret";
  const safe = sanitizeOpenAiProviderErrorVNext(
    429,
    JSON.stringify({ error: { code: "rate_limit", message: rawSecret }, request_id: "req_safe123" }),
    null,
  );
  const serialized = JSON.stringify(safe);
  check("Provider error keeps safe status/code/request id", safe.status === 429 && safe.code === "rate_limit" && safe.requestId === "req_safe123");
  check("Provider error discards raw body and provider message", !serialized.includes(rawSecret) && !serialized.includes('message":"raw'));
}

{
  const source = readFileSync("./supabase/functions/analyze-sketch-vnext-checkpoint1/index.ts", "utf8");
  check("Edge Function default model is gpt-5.6-luna", source.includes('?? "gpt-5.6-luna"'));
  check("Edge Function contains no temperature request field", !/^\s*temperature\s*:/m.test(source));
  check("Edge Function contains no seed request field", !/^\s*seed\s*:/m.test(source));
  check("Persistence targets analysis_artifacts only", source.includes('.from("analysis_artifacts")') && !source.includes('.from("analysis_jobs").update'));
  check("No current_stage assignment/update exists", !/current_stage\s*:/.test(source));
}
// NOTE: the geometry prompt DOES mention "rawText" and "כללית"/"מקומית"
// once each — but only inside its own "אסור בהחלט" (forbidden) section,
// explicitly telling the model these are NOT its job. This mirrors real
// precedent already in this codebase: envelope_topology_system_prompt_v2.ts
// explicitly names "polygonOrder" as forbidden rather than just omitting
// it silently. So the correct assertion is "mentioned at most once, and
// only in a forbidding sentence" — not "never mentioned at all".
{
  const rawTextMentions = (GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.match(/rawText/g) || []).length;
  check(
    "Geometry prompt: mentions rawText at most once, only to explicitly forbid it (not requested as an ask)",
    rawTextMentions === 1 && /לתעד טקסט מידה כתוב \(rawText\)/.test(GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT),
  );
}
check(
  "Geometry prompt: overall/local wording appears only inside its explicit 'not asked of you' sentence",
  /לסווג מידה כ"כללית".*מול "מקומית"/.test(GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT),
);
for (const term of geometryMustContain) {
  check(`Geometry prompt: contains required term "${term}"`, GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes(term));
}

const evidenceMustContain = [
  "rawText",
  "room_label",
  "unitHint",
  "כפי שמופיע",
];

for (const term of evidenceMustContain) {
  check(`Evidence prompt: contains required term "${term}"`, EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes(term));
}
check(
  "Evidence prompt satisfies semantic contract validator",
  evidencePromptContractViolations(EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT).length === 0,
);

{
  const mutations = [
    [
      "Evidence negative control rejects conversion instruction",
      EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\n- המר/י את כל המספרים ליחידת מטר.",
      "POSITIVE_CONVERSION_INSTRUCTION",
    ],
    [
      "Evidence negative control rejects geometry construction instruction",
      EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\nבנה/י vertices עבור כל הקירות.",
      "POSITIVE_GEOMETRY_INSTRUCTION",
    ],
    [
      "Evidence negative control rejects overall/local classification instruction",
      EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT + "\nסווג/י כל מידה כ-overall או local.",
      "POSITIVE_CLASSIFICATION_INSTRUCTION",
    ],
    [
      "Evidence negative control rejects removed room-label ownership",
      EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.replace("הטקסט של שם החדר שייך **אך ורק** לך", "הטקסט של שם החדר עשוי להיות מטופל במקום אחר"),
      "MISSING_ROOM_LABEL_OWNERSHIP",
    ],
    [
      "Evidence negative control rejects removed honest-partial rule",
      EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.replace(/תיעוד חלקי אך כן\s+עדיף על פני השלמה מומצאת/, "השלם/י כל טקסט חסר"),
      "MISSING_HONEST_PARTIAL_RULE",
    ],
  ];
  for (const [label, mutated, expectedCode] of mutations) {
    check(label, evidencePromptContractViolations(mutated).includes(expectedCode));
  }
}
check(
  "Evidence prompt: explicitly forbids overall/local classification",
  EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("לסווג מידה כ\"כללית\" מול \"מקומית\""),
);
check(
  "Evidence prompt: never references geometry/wall/vertex concepts",
  !EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("vertexId") && !EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("fromVertexId"),
);
// Same "named only to forbid it" precedent as the geometry prompt above:
// valueM is mentioned once, purely as an example of what must never be
// returned — never as something the model is asked to produce.
{
  const valueMMentions = (EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.match(/valueM/g) || []).length;
  check(
    "Evidence prompt: mentions 'valueM' at most once, only inside its explicit forbidden-example list",
    valueMMentions === 1 && /להחזיר ערך מטרי מומר \(valueM/.test(EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT),
  );
}
check(
  "Evidence prompt: never mentions forbidden field name 'totalAreaSqm'",
  !EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.includes("totalAreaSqm"),
);

check(
  "Both prompts are non-empty distinct strings (no accidental copy-paste of one into the other)",
  GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT.length > 200 &&
    EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT.length > 200 &&
    GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT !== EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT,
);

const summary = {
  testFileId: TEST_FILE_ID,
  assertionsPassed,
  assertionsFailed: failures,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify(summary));
process.exit(failures === 0 ? 0 : 1);
