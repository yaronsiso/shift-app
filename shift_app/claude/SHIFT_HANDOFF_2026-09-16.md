# SHIFT — Envelope Constraint Solver — HANDOFF
תאריך: 2026-09-16. מטרת מסמך זה: המשך עבודה מדויק בסשן/חשבון חדש, בלי לאבד קונטקסט ובלי לשחזר מהזיכרון בלבד.

## מטרת הפרויקט וה-pipeline הרלוונטי
SHIFT — אפליקציית Flutter ל-AI home/yard renderings, שוק ישראלי. המשתמש: יערון, PM לא-מתכנת, עובד ב-GitHub Codespaces, Hebrew + step-by-step.
Repo: `github.com/yaronsiso/shift-app`. Test job לדוגמה: `98861ede-1d27-462c-bdf6-2f5893b34c4a`, Supabase project `iywhxmuzvincfmezijtv`.

Pipeline (production, staged):
```
Stage0 (scope)  →  PageDimensions  →  EnvelopeTopology (RAW)  →  [Phase1C-A/B — לא production] → [Phase2 Witness Promotion] → [Phase3 Constraint Solver]
```

Claude אין לו גישה ל-repo/Codespace/Supabase בשום session — כל מה שידוע מגיע מקבצים שהמשתמש מדביק/מעלה ידנית. אין לבטוח בזיכרון על תוכן קוד — תמיד לדרוש את הקובץ האמיתי כשדיוק חשוב.

---

## שלבים שכבר APPROVED/CLOSED

### Phase 1B — semantic audit (APPROVED, CLOSED)
Audit מלא e1-e26 על RAW Attempt #3 EnvelopeTopologyV1 artifact (25 vertices, 26 edges, job הנ"ל). 14 edges KEEP_ENVELOPE: e1,e2,e5-e12,e19,e20,e25,e26. שאר ה-edges REJECT_NOT_ENVELOPE/REJECT_DUAL_FACE/UNRESOLVED. ממצאים מרכזיים: v13 = UNRESOLVED_BOUNDARY_CONTINUATION (פתח), v21/v1 = KEEP_TO_KEEP_ENDPOINT_DISCONTINUITY, v22 = RESOLVED_DUAL_FACE (e23 reject / e25 keep / e26 keep), v19/v20 = OFF_WALL geometrically (semantic status עדיין KEEP).

### Phase 1C-A — Canonical Topology Planning (APPROVED, CLOSED)
PLAN ידני של 21 operations (op-01, op-01b, op-02, op-03, op-04a..j, op-05, op-06, op-07, op-08) הבנוי **ידנית** מתוך ממצאי Phase 1B, **ספציפית ל-Attempt #3 בלבד**. 13 invariants מאושרים (NO_UNPROVEN_EDGE, NO_RAW_MUTATION, NO_PROXIMITY_ONLY_REPAIR, NO_FORCED_CLOSURE, PROVENANCE_COMPLETE, NO_REJECTED_EDGE_ACTIVE, GAPS_EXPLICIT, DEFERRED_ISSUES_PRESERVED, CANONICAL_FACE_SELECTION_RESPECTED, GRAPH_STRUCTURALLY_VALID, DEFERRED_DOES_NOT_IMPLY_EXCLUSION, NO_ORPHAN_EDGE_ENDPOINTS, CONNECTED_COMPONENTS_EDGE_INDUCED, SINGLE_CANONICAL_EDGE_OWNER).

**קריטי:** ה-PLAN הזה (`attempt3ApprovedPlan`) הוא **hardcoded, ידני, ספציפי ל-job אחד**. **אסור בשום אופן להכניס אותו כ-hardcoded ל-production** — אין עדיין מנגנון אוטומטי שבונה PLAN מ-`EnvelopeTopologyV1` גולמי לכל job חדש. זה בדיוק הפער שנמצא (ראה "הגילוי האחרון" למטה).

### Phase 1C-B — Canonical Topology Construction (APPROVED, CLOSED — אך רק כ-package עצמאי, לא production)
מומש כחבילת TypeScript עצמאית (`phase1c-b-complete.zip`), 9 קבצי מקור: `src/types/model.ts`, `src/construct.ts`, `src/validate.ts`, `src/report.ts`, `src/fixtures/attempt3.ts`, `src/__tests__/construct.test.ts`, `tsconfig.json`, `package.json`, `node-builtins.d.ts`. פונקציית הליבה: `constructCanonicalTopology(raw: RawTopology, plan: ApprovedPlan, candidateId: string): CanonicalTopologyCandidate`.

פלט מאומת עבור Attempt #3 (הרצה אמיתית, לא ניחוש): **14 CanonicalEdges, 19 vertices, 2 gaps (gap-op-06 OPENING_CONTINUATION_UNKNOWN v13; gap-op-07 SOURCE_OCCLUDED v23/v24), 3 deferredIssues (deferred-op-02, deferred-op-05, deferred-op-08), 4 connectedComponents, candidateState=OPEN_WITH_GAPS**. 21/21 טסטים עוברים, tsc נקי, 12 validation rules PASS.

`CanonicalVertex.coordinate = {x, y}` נגזר ישירות מ-`RawVertex.xPct/yPct` — **ללא שינוי, ללא חישוב מחדש** (`coordinate: { x: rv.xPct, y: rv.yPct }`).

**המשתמש אימת עצמאית** (הרצת tsc+tests בעצמו) שזו חבילה עובדת. **אבל: זו חבילה עצמאית ב-sandbox של Claude — היא מעולם לא שולבה כ-Edge Function ב-production האמיתי.**

### Phase 2-A — Witness Promotion data model (APPROVED, CLOSED)
עיצוב מלא: `MeasurementEvidence → WitnessPerceptionCandidate → deterministic witness evaluation → MeasurementWitness → deterministic promotion → PromotedConstraintCandidate`. שלוש שכבות נפרדות לעולם: Measurement evidence ≠ Witness ≠ Constraint.

`TopologyAnchor = VERTEX{canonicalVertexId} | EDGE_POINT{canonicalEdgeId, paramT∈[0,1]}`. CanonicalGap/DeferredIssue **אינם** TopologyAnchor. Anchor חייב existence check אמיתי מול `CanonicalTopologyCandidate` (לא RAW/AUDITED בלבד) — invariant: `RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE` (הוכח: v4 לא קיים כ-CanonicalVertex, כי e3/e4 שניהם REJECT).

Confidence caps **per-endpoint**, לא aggregate: `EXTENSION_LINE_INTERSECTION_VERIFIED→HIGH`, `EXTENSION_LINE_PROJECTION_INFERRED→MEDIUM`, `OTHER_SPATIAL_INFERENCE→LOW`. `bindingConfidence = MIN(start, end)`. `bindingStatus`: 0 resolved→UNBOUND, 1→PARTIALLY_BOUND (שני כיוונים), 2 valid→BOUND, ambiguity→AMBIGUOUS. `UNBOUND` הוא מצב תקין, לא כשל.

שלושה span types נפרדים: `DimensionLineSpan → WitnessSpan → TopologySpan` (רק מ-BOUND). Promotion: `bindingStatus=BOUND` + שני endpoints עוברים validation. `PromotedConstraintCandidate` תמיד structured, לעולם לא string equation.

13 invariants מאושרים (ANCHOR_EXISTS_IN_CANONICAL_TOPOLOGY, EDGE_POINT_PARAM_VALID, BINDING_STATUS_DERIVED_FROM_ENDPOINTS, NO_NUMERIC_MATCH_PROMOTION, NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT, PROJECTED_INFERRED_CONFIDENCE_CAP, PROMOTED_REQUIRES_TWO_BOUND_ENDPOINTS, CONTEXTUAL_REFERENCE_IS_NOT_ANCHOR, MEASUREMENT_CANNOT_MUTATE_TOPOLOGY, STRUCTURED_CONSTRAINT_ONLY, UNIQUE_CANDIDATE_IS_NOT_PROOF, RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE, ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION).

### Phase 2-B Part A — תשתית דטרמיניסטית (APPROVED, CLOSED)
חבילה עצמאית (`phase2b-part-a-deterministic.zip`): `anchor.ts` (validation, resolveEndpoint), `binding.ts` (bindingStatus/bindingConfidence derivation), `span.ts` (TopologySpan construction, gated ל-BOUND בלבד), `promotion.ts` (eligibility + construction), `invariants.ts` (רישום כל 13 ה-invariants). **46/46 טסטים עוברים, tsc נקי.**

Fixture (`attempt3-canonical.ts`) נטען **ישירות מ-snapshot JSON אמיתי** (`attempt3-actual-candidate.json`) — פלט ריצה בפועל של `constructCanonicalTopology` מה-`phase1c-b-complete.zip` המקורי, לא reconstruction ידני (תוקן אחרי טעות קודמת שבה fabrication הוצג כ-verified).

**Reproducibility:** `tsc` → `dist/*.js` טהור → `node --test`, ללא `tsx` או תלות runtime אחרת. TypeScript מוצמד ל-6.0.3 המדויק (תוקן baseline בעיה עם `moduleResolution`/`ignoreDeprecations`).

**שאלת policy פתוחה, לא נפתרה, מדווחת בכוונה:** כאשר candidate אחד עובר validation ב-MEDIUM ואחר ב-LOW (לא שווים) — `resolveEndpoint` מחזיר `AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY` ולא בוחר "החזק מנצח". אין policy מאושר לכך עדיין.

### Phase 2-B Part B — Witness Perception Candidate (APPROVED, CLOSED — כ-infrastructure בלבד, טרם integration)
חבילה עצמאית (`phase2b-part-b-witness-perception.zip`): `witness-perception-schema.ts` (strict JSON Schema, `additionalProperties:false`), `witness-perception-prompt.ts` (עברית, AI מציע/קוד מחליט), `witness-perception-call.ts` (request builder בלבד — **אין network call בסביבת Claude**), `sanitation.ts` (בדיקות דטרמיניסטיות בלבד: measurementId קיים, canonical existence, paramT∈[0,1], suggestedAnchor∈candidateAnchors — **ללא** proof validation/binding/promotion).

**26/26 טסטים עוברים, tsc נקי.**

AI מותר להציע: `candidateAnchors[]`, `suggestedAnchor` (nullable), `proposedProofRelationType`, `imageGeometryEvidence`, `evidenceRefs`, `proposalConfidence`, `notes`. AI **אסור** לו לקבוע (לא קיים בסכמה בכלל): `selectedAnchor`, `proofStatus`, `proofStrength`, `endpointConfidence`, `bindingStatus`, `bindingConfidence`, `TopologySpan`, `promotion`, `PromotedConstraintCandidate`, מטרים/world geometry.

**עדכון קריטי שבוצע:** `CanonicalVertex` (בעותק המקומי של Part B, `topology-input.ts`) הורחב לכלול `coordinate: {x, y}` (נשלף ישירות מה-snapshot האמיתי, לא הומצא) — כדי שה-prompt ל-AI יכלול בפועל את מיקומי ה-vertices ב-`cropped.jpg`, לא רק מזהים בלי מיקום. **Part A המקורי לא נגע כלל** (checksums מאומתים זהים).

`EXTENSION_LINE_INTERSECTION_VERIFIED` **נשאר ב-enum** לצורך proposal compatibility, אך הפרומפט מבהיר במפורש: זו **תמיד** רק "AI visual relation proposal", **לעולם לא** extension-line proof מאומת — כי ה-PageDimensions contract הנוכחי לא מכיל witness feet על האובייקט הנמדד.

---

## Coordinate Contract — Audit מלא, Verdict סופי: VERIFIED_COMPATIBLE

זהו audit ארוך ורב-שלבי, כולל תיקון עצמי אחד בדרך (נמחק verdict שגוי שהיה VERIFIED_INCOMPATIBLE, בוטל כי היה מבוסס על היקש לוגי לא-מוכח). השרשרת הסופית שהוכחה **מקוד אמיתי בלבד**:

1. **Stage0** (`analyze-sketch-v2-scope/index.ts`): לא מבצע crop בעצמו. מזהה ומחזיר `mainFloorPlanBboxPct` — אחוזים 0-100 ביחס ל-**original uploaded image המלאה**, origin מוצהר במפורש: "0,0 היא הפינה השמאלית-עליונה".
2. **Client-side crop** (`client_side_crop.dart`, `cropImageToBboxPct`): crop גיאומטרי טהור (`img.copyCrop`), **ללא padding, ללא resize, ללא rotation, ללא letterbox** — ישירות מ-`mainFloorPlanBboxPct` על ה-original image. מוכח מתמטית: percent-within-bbox == percent-within-cropped.jpg לאותה נקודה פיזית.
3. **`cropped.jpg`** מועלה ל-`${uid}/analysis/${jobId}/cropped.jpg` (bucket `renders`) — **אותו path בדיוק** בשלושה מקומות: PageDimensions (`index.ts`), Envelope הישן-מטרי (`envelope_index.ts`, **לא רלוונטי יותר**), ו-EnvelopeTopology (`index__2_.ts`).
4. **PageDimensions persisted geometry** (`bboxPct`/`lineStartPct`/`lineEndPct`): אחרי `remapStripMeasurements` (`dimension_measurement_merge_v3.ts`, נוסחה מדויקת: `remapLocalPctToCropPct`) — כולם חיים ב-percent ביחס ל-`mainFloorPlanBboxPct` (שכעת מוכח = בדיוק שווה ל-`cropped.jpg` הפיזי, לפי #1-2).
5. **`EnvelopeTopologyV1.vertices[].imagePct`** (`envelope_topology_schema_v1.ts` + `index__2_.ts`): אחוזים ביחס ל"התמונה הזו" — שהיא אותה `cropped.jpg`.
6. **מסקנה מוכחת:** שני ה-artifacts (PageDimensions geometry ו-`EnvelopeTopologyV1.imagePct`) חיים **באותו coordinate frame בפועל** — `0-100` ביחס לאותה `cropped.jpg`, origin top-left, ללא transform סותר.

**`envelope_index.ts` (הישן, מטרי, `Point2D` ב-meters, `analyze-sketch-v2-envelope`) הוכח כ-stage שונה/מקביל לגמרי מ-`analyze-sketch-v2-envelope-topology` — אינו רלוונטי יותר להערכת coordinate contract.**

**Verdict סופי: `COORDINATE_CONTRACT = VERIFIED_COMPATIBLE`. Audit CLOSED. אושר על ידי המשתמש.**

---

## הגילוי האחרון — CanonicalTopologyCandidate אינו persisted ב-production

**זה הבלוקר הפעיל כרגע.** לפני שהתחלנו integration ל-Witness Perception, ביקשתי לאתר איפה `CanonicalTopologyCandidate` נטען מ-production. הממצא:

**מה שכן persisted, `stage: "envelope_topology"`:** רק `EnvelopeTopologyV1` **הגולמי** — פלט ה-AI הישיר (`vertices[].imagePct`, `edges[]`, `polygonOrder`, `perceptionNotes`), אחרי `parseEnvelopeTopologyV1` (forbidden-field firewall) ו-`validateEnvelopeTopologyV1` (9 validators מבניים — **הקובץ הזה לא נקרא, לא סופק**). זה **בדיוק** מקביל ל-`attempt3Raw` (ה-**input** ל-`constructCanonicalTopology`), **לא** לפלט שלו.

**אין בשום מקום ב-production:**
- קריאה ל-`constructCanonicalTopology`.
- `stage="canonical_topology"` (או שם דומה) ב-DB.
- Semantic audit אוטומטי (Phase 1B logic).
- PLAN construction אוטומטי (Phase 1C-A logic).

**ההבדל בין השניים, במפורש:**

| | `EnvelopeTopologyV1` (RAW, persisted) | `CanonicalTopologyCandidate` (לא persisted) |
|---|---|---|
| semantic audit | אין | יש (Phase 1B: KEEP/REJECT/DUAL_FACE) |
| PLAN operations | אין | יש (Phase 1C-A: 21 ops) |
| gaps/deferredIssues מחושבים | אין | יש |
| invariants (SINGLE_CANONICAL_EDGE_OWNER וכו') | אין | יש (12+ regels) |
| vertex/edge ids | `v1, v2...` ישירות מה-AI | `canon-e1` וכו', אחרי filtering |

**עוד ממצא קריטי:** `attempt3ApprovedPlan` (ה-PLAN של 21 operations) הוא **hardcoded, נבנה ידנית**, ספציפית ל-Attempt #3 בלבד, מתוך semantic audit ידני שביצענו יחד בשיחה (Phase 1B). **אין קוד production שבונה PLAN אוטומטית מ-`EnvelopeTopologyV1` גולמי לכל job חדש.** **אסור בהחלט** להכניס `attempt3ApprovedPlan` (או כל PLAN hardcoded אחר) ל-production כפתרון — זה יעבוד רק על ה-job הספציפי הזה, לא על שום job אחר.

---

## ההחלטה: Option B, לא workaround

הוצגו למשתמש שתי אופציות כשנתקלנו בבלוקר:
- **Option A** (נדחתה): להריץ `constructCanonicalTopology` in-process בתוך ה-Witness Perception Edge Function עצמו, עם PLAN hardcoded מועבר כפרמטר — workaround זמני.
- **Option B** (**נבחרה**): לעצור, לא ליישם שום workaround, ולטפל תחילה בפער האמיתי: Phase 1C-A (PLAN construction) חייב להפוך לתהליך production-ready/כללי, **לפני** ש-Witness Perception integration יכול להתבסס על `CanonicalTopologyCandidate` אמיתי.

**לא בוצע שום implementation על סמך Option A.** לא נכתב Edge Function ל-Witness Perception integration.

---

## Invariants ו-architectural rules — אסור לשבור, בשום סשן עתידי

1. RAW → AUDITED → PLAN → CANONICAL_CANDIDATE — הפרדת שכבות מוחלטת, לעולם לא לדלג.
2. `RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE` — קיום ב-RAW לא מוכיח קיום ב-canonical (v4 הוא ה-proof case הקבוע).
3. Proximity לעולם לא מספיקה כהוכחה למיזוג/repair/binding (`NO_PROXIMITY_ONLY_REPAIR`).
4. Numeric similarity, chain membership, corroboration count — **אף אחד מהם אינו spatial/endpoint proof**.
5. `lineStartPct`/`lineEndPct` = קצוות **קו המידה הגרפי בלבד**, **לעולם לא** witness feet על האובייקט הנמדד. אישוש עצמאי חוזר בכל שלב.
6. Confidence caps הם **per-endpoint**, לא aggregate. MIN() בלבד, לעולם לא ניתן להעלות ע"י witnessType/corroboration.
7. `UNIQUE_CANDIDATE_IS_NOT_PROOF` — מועמד יחיד בלי מתחרה עדיין חייב לעבור את כל תנאי ה-validation, לא exemption אוטומטי.
8. אין tie-break policy מאושר בין candidates בעוצמות שונות (MEDIUM vs LOW) — נשאר AMBIGUOUS, לא להמציא policy.
9. `PromotedConstraintCandidate` — structured בלבד, לעולם לא string equation.
10. אף שלב לא רשאי למטב/לשנות topology (`MEASUREMENT_CANNOT_MUTATE_TOPOLOGY`).
11. Claude תמיד קורא קוד אמיתי לפני מסקנה — לא בוטח בזיכרון/שמות משתנים/הנחות. תוקן מספר פעמים באותה שיחה עצמה.
12. שיחה בעברית תמיד; קוד/schemas/identifiers/logs נשארים באנגלית.

---

## קבצים/packages חשובים (למי שממשיך)

- `phase1c-b-complete.zip` — Phase 1C-B, מקור אמת ל-`constructCanonicalTopology`, `attempt3Raw`, `attempt3ApprovedPlan`. **המשתמש מחזיק בקובץ המקורי.**
- `phase2b-part-a-deterministic.zip` — Part A, תשתית דטרמיניסטית.
- `phase2b-part-b-witness-perception.zip` — Part B, שכבת AI proposal + sanitation.
- קבצי production אמיתיים שכבר נקראו ואומתו: `dimension_evidence_schema_v3.ts`, `page_dimensions_current.zip` (`index.ts`, `resolved_page_dimensions_v3.ts`, `dimension_extent_grouping_v3.ts`, `envelope_index.ts` — הישן, לא רלוונטי יותר), `dimension_measurement_merge_v3.ts`, `envelope_topology_schema_v1.ts`, `index__2_.ts` (=`analyze-sketch-v2-envelope-topology/index.ts`), `index (3).ts`/`index__3_.ts` (=`analyze-sketch-v2-scope/index.ts`), `client_side_crop.dart`, `sketch_scope_service.dart`.
- **לא נקרא עדיין**: `envelope_topology_validators_v1.ts`, `envelope_topology_debug_metrics_v1.ts` — מוזכרים ב-`index__2_.ts` אך תוכנם לא סופק.

## מה אסור לשנות (ללא אישור מפורש חדש)

- Phase 1B/1C-A/1C-B (עצמם) — סגורים, לא לפתוח מחדש בלי contradiction מוכח.
- Phase 2-A — סגור.
- Phase 2-B Part A — סגור, אסור לשנות לוגיקה.
- Phase 2-B Part B schema/prompt/sanitizer — סגור לעת עתה (המשתמש אמר "אל תשנה יותר כרגע").
- `EXTENSION_LINE_INTERSECTION_VERIFIED` enum — לא לשנות.
- PageDimensions (production) — לא לשנות.
- Coordinate contract עצמו — סגור, VERIFIED_COMPATIBLE, לא לפתוח מחדש בלי ראיה חדשה.
- אין proof validation / binding / promotion / solver עדיין — לא התחיל בכלל.

---

## NEXT TASK:
**PHASE1C-A PRODUCTION GAP AUDIT ONLY.**
**NO IMPLEMENTATION YET.**

המטרה של המשימה הבאה: לבדוק בקוד production אמיתי (לא בהנחות) מה בדיוק חסר כדי ש-Phase 1C-A (בניית PLAN מ-`EnvelopeTopologyV1` גולמי) יוכל להפוך לתהליך כללי/production, ולא להישאר PLAN ידני שנבנה פעם אחת עבור Attempt #3 בלבד. לא לכתוב קוד, לא ליישם, לא לפתור — רק audit ודיווח מדויק, באותה מתודולוגיה שכבר נבחנה בהצלחה ב-coordinate contract audit: לקרוא קוד אמיתי, לא לנחש, לדווח MISSING_FILE_OR_MODULE במפורש כשמשהו חסר, ולתת verdict ברור בסוף.
