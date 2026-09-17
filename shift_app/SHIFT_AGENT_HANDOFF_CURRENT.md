# SHIFT — Agent Handoff (current as of session ending 2026-09-17)

Written by the outgoing agent, per Yaron's explicit request, at the point
where a new `EnvelopeTopologyV2` contract has been fully designed (all
core decisions locked) but **not implemented**, and four specific
production-integration decisions remain genuinely open (§19).

**Status: DRAFT, not yet reviewed by Yaron. Do not commit or push this
file (or anything else) until he explicitly reviews it and asks.**

**Verification labeling used throughout this file:**
- **[VERIFIED]** — the outgoing agent independently checked this against
  the actual repository content or git history in this session.
- **[REPORTED]** — stated by Yaron directly (either as a real production
  observation he made outside this sandbox, or as an architectural
  decision/history he stated). Not independently re-checked by this agent
  against a live system, a test run, or a source file, but not invented
  either — treat as reliable, sourced information, just not
  agent-re-verified.
- **[OPEN / UNDECIDED]** — explicitly not yet decided. Do not guess these.

This sandbox has no live Supabase access (no CLI, no project credentials,
no DB connection) — see §12/§22. Every production-runtime claim in this
file is therefore **[REPORTED]** by Yaron, not **[VERIFIED]** by this
agent, unless stated otherwise.

---

## 1. Project overview

SHIFT is Yaron's Flutter + Supabase mobile app. A user photographs or
sketches a floor plan; the app turns it into a validated, dimensioned 2D/3D
model, which then feeds an existing (already-shipped, frozen, unrelated)
AI design/render feature.

Full intended pipeline:

```
architectural plan / sketch / photo
  -> scope / crop
  -> dimension evidence (PageDimensions)
  -> raw topology perception (EnvelopeTopology)
  -> semantic envelope planning (Phase1C-A)
  -> canonical topology (Phase1C-B)
  -> measurement witnesses (Phase2)
  -> deterministic constraint solving
  -> rooms / global walls / openings / stairs
  -> validated 2D / 3D
  -> existing design / render system (already shipped, FROZEN)
```

**Core principle, repeated by Yaron throughout this whole project and
enforced structurally in every stage's code:**

> AI perceives and classifies evidence. Deterministic code computes,
> validates, resolves authority, and constructs geometry. OpenAI
> Structured Outputs (`strict: true` JSON Schema) guarantee response
> *shape*, never semantic *correctness*. Nothing is trusted merely because
> it parsed against the schema.

Every stage follows this split: an Edge Function calls OpenAI with a
strict JSON Schema for perception/classification only, then runs the raw
output through pure, deterministic, side-effect-free TypeScript validators
before anything is persisted as authoritative.

---

## 2. Current repository state **[VERIFIED at time of writing]**

- Repo root (this sandbox): `/home/claude/shift-app-check/shift_app`
- Branch: `main`
- `HEAD` = `origin/main` = `99f57e0f1b3ce349b97c3ad39dfe4d8b64ee6ec8`
- `git status --short`: clean
- Commit message at `HEAD`: `feat: integrate canonical topology production stage`

**Verify this yourself before doing anything** —
`git fetch origin main && git rev-parse HEAD origin/main` — do not assume
it is unchanged.

Named milestone commits, verified present with matching messages
(not the full history — many more commits exist between/around these):

| commit | message |
|---|---|
| `e4eff894929a6ceca6fb3b1ca4377f6c6a4f0a82` | feat: consolidate canonical topology contract across Phase1C and Phase2B |
| `a2dde2471058dd7e521676dc0da43b4ca5bcd5e5` | feat: add Phase1C-A semantic planning contracts |
| `fe0d896709c454ee1ba49db7721825ea971a59ee` | feat: add Phase1C-A semantic planner proposal infrastructure |
| `505a32588936d21451f209c5d2d34509d97f6c45` | fix: require verification scope for executable envelope edges |
| `b8c6a301ae591a0253f8fc00a76b7f57fea6bcc0` | feat: add Phase1C-A approved plan builder |
| `9f06fc4fa539dea6382080db4c5b11a0b512b147` | refactor: establish shared Phase1C source of truth |
| `99f57e0f1b3ce349b97c3ad39dfe4d8b64ee6ec8` | feat: integrate canonical topology production stage (**current HEAD**) |

Supabase Edge Functions present (`supabase/functions/`): `_shared`,
`analyze-sketch` (legacy v15, production, untouched), `analyze-sketch-v2-scope`,
`analyze-sketch-v2-page-dimensions`, `analyze-sketch-v2-measurements`,
`analyze-sketch-v2-envelope`, `analyze-sketch-v2-envelope-topology`,
`analyze-sketch-v2-canonical-topology`, `generate-render`,
`render-webhook`. **[VERIFIED]**

**Git operational note:** `git push origin main` from this sandbox is
blocked by the git proxy — `403 access denied ... not in this session's
authorized repository set`. Permanent authorization-scope denial for this
sandbox, not transient — never retry it. Working fallback (used
successfully twice): `git format-patch -1 HEAD --stdout`, deliver the
`.patch` file to Yaron, he applies (`git am`) and pushes it himself.
Confirmed byte-identical trees both times.

---

## 3. Frozen / DO NOT TOUCH areas

- The existing AI design/render feature (`generate-render`,
  `render-webhook`, related Flutter screens) — shipped, working,
  unrelated to this effort. Never touch as a side effect of topology work.
- `analyze-sketch` (legacy v15) and its data — production, untouched by
  any "v2" pipeline work.
- `EnvelopeTopologyV1` contract: `_shared/envelope_topology_schema_v1.ts`,
  `_shared/envelope_topology_validators_v1.ts`,
  `_shared/envelope_topology_debug_metrics_v1.ts`, and the producer
  `analyze-sketch-v2-envelope-topology/index.ts`. **V1 stays exactly as-is,
  forever**, despite its known real-world limitation (§14). `V2` is being
  designed as a separate, additive contract specifically so V1 never has
  to change.
- Phase1C-A / Phase1C-B library code under `_shared/phase1c/*.ts` — tested,
  verified, production-integrated (§7/§8). Do not refactor, "clean up," or
  change behavior as a side effect of adding V2 support. Any V2-driven
  change here must be explicit, narrow, and separately reviewed.
- `PageDimensions` / measurement resolution pipeline
  (`analyze-sketch-v2-page-dimensions`, `analyze-sketch-v2-measurements`,
  `_shared/resolved_page_dimensions_v3.ts`,
  `_shared/dimension_extent_grouping_v3.ts`, and related resolver code) —
  out of scope unless a task explicitly requires it. **Do not reopen this
  architecture during EnvelopeTopologyV2 work** (Yaron's explicit
  instruction — see §6).
- Phase2 Witness contracts (`claude/phase2b-part-a/src/*`,
  `claude/phase2b-part-b/src/*`) — designed/implemented at the library
  level, not wired into production yet. Do not modify casually.
- Constraint solver, rooms/global-walls, openings, stairs, final
  deterministic validation, 3D generation — **not built at all yet**
  (§5). Nothing to break, but also not to be started without an explicit
  task.

Hard rules that apply throughout:

- **Never `git add .`.** Stage files by explicit path only.
  `git status --short` before every stage; inspect
  `git diff --cached --name-status` before every commit — it must show
  only the explicitly intended path(s), or STOP.
- **Never hardcode a specific job's IDs or geometry into production code**
  (came up explicitly re: Attempt3 and the real job `98861ede-...` — a
  validator or fix must be a general, principled rule, never shaped to
  make one known job pass).
- **Never widen a validator tolerance** (e.g. V1's 3pct axis-hint
  tolerance) just to make a specific real run pass. V1 stays frozen;
  fixing a real limitation is V2's job, and even V2's own validator must
  stay general (§16).
- **Never rewrite/backfill historical artifacts** (the real job's existing
  v1/v2/v3 `envelope_topology` rows) just to make a diagnosis or a new
  contract retroactively "pass." New V2 artifacts apply to jobs going
  forward; history stays history (§19.D).
- Every phase in this project has been implemented as a change to exactly
  one new file (or a small, explicitly named set), with a full
  line-by-line safety audit and explicit approval before any commit.
  Continue that discipline — do not implement broader than what is
  explicitly approved for the current task, and do not fold unrelated
  cleanup/refactoring into a focused phase.
- Be careful with untracked files and secrets (see §22).

---

## 4. Locked architecture — global invariants **[REPORTED by Yaron as standing decisions across this project; consistent with everything this agent verified in code]**

Documented as decisions, not suggestions.

**Geometry authority**
- AI does not own metric geometry. Geometry source of truth is
  deterministic code, not the model.
- No global meters-per-percent conversion.
- Unknown quantities remain nullable — never defaulted/guessed.
- No silent reconciliation of conflicting values.
- Do not average contradictory measurements.
- Higher-confidence solved coordinates freeze before lower-confidence
  constraints are applied.
- Residual conflicts remain visible (surfaced, not hidden/resolved away).

**Walls**
- One physical wall exists once, globally (not duplicated per room).
- Rooms reference `wallIds` (rooms don't own their own wall geometry).

**Measurements**
- `PageDimensions` is the canonical measurement-evidence authority.
- Dimension evidence becomes equations between proven anchors — not
  standalone numbers.
- Numeric similarity between two readings is never treated as proof they
  refer to the same endpoint.
- Chain membership or corroboration is never endpoint proof by itself.
- `projected_inferred` witness proof is capped at `MEDIUM` confidence.
- `extension_line_verified` is a future, stronger proof type (not yet
  built).
- `edge_point` inherits only the orthogonal coordinate class and remains
  unique along the edge direction.

**Topology semantics**
- The canonical envelope follows the **inner face** of physical exterior
  walls.
- "Envelope" means the enclosed interior boundary.
- Uncovered terrace / paving / pergola / exterior stairs / open balcony /
  canopy are **not automatically** envelope.
- Exterior-wall classification is primarily driven by local
  interior↔exterior adjacency.
- Connectivity is supporting evidence for a classification, never a
  substitute for it.
- One physical drawn line may require semantic splitting (e.g. part of it
  is exterior wall, part is something else — see `SPLIT_REQUIRED`, §7).
- Openings do not automatically break the physical wall's continuity.
- Structural validity != semantic correctness.
- Semantic correctness != geometry alignment.
  (These last two are the exact distinction behind why a `BLOCKED` or even
  a `BUILT` Phase1C result is not automatically "the drawing is right" —
  see §7/§13.)

---

## 5. Pipeline status table

| Stage | Status |
|---|---|
| Scope | DONE |
| Real crop | DONE |
| PageDimensions V3 | DONE |
| Deterministic dimension grouping/resolution | DONE |
| Envelope perception (V1) | **ACTIVE BLOCKER — V2 migration required** |
| Phase1C-A semantic planning | IMPLEMENTED |
| Phase1C-B canonical construction | IMPLEMENTED |
| H-B production canonical integration | IMPLEMENTED + DEPLOYED |
| H-C runtime verification | EXECUTED ONCE, BLOCKED UPSTREAM |
| Phase2A witness architecture | DESIGNED |
| Phase2B-A deterministic witness infrastructure | DONE, 46/46 tests **[REPORTED]** |
| Phase2B-B witness perception infrastructure | DONE, 26/26 tests **[REPORTED]** |
| Phase2C witness proof/binding | WAITING FOR REAL CANONICAL PRODUCTION |
| Constraint solver | WAITING |
| Rooms / global walls | FUTURE |
| Openings | FUTURE |
| Stairs / special elements | FUTURE |
| Final deterministic validation | FUTURE |
| 3D generation | FUTURE |
| Design / render | EXISTING + FROZEN |

**CURRENT ACTIVE POINT: `Phase 1A — EnvelopeTopologyV2 migration`.**

Note on the test counts: this agent independently confirmed the *test
files exist* (`claude/phase2b-part-a/src/__tests__/{anchor,span,binding,
promotion,invariants}.test.ts`, `claude/phase2b-part-b/src/__tests__/
{witness-perception-call,sanitation}.test.ts` — **[VERIFIED]** files
present) but did **not** re-run the suites to confirm the exact pass
counts (46/46, 26/26, and the 230/230 figure in §8) — those pass counts
are **[REPORTED]**.

---

## 6. PageDimensions status **[REPORTED, with file existence VERIFIED]**

Important history: the old "Pass 0.5" logic incorrectly treated a local
`274cm` balcony measurement as if it were the whole building's width.
`PageDimensions V3` (`_shared/resolved_page_dimensions_v3.ts`,
**[VERIFIED file exists]**) now extracts all dimension-line evidence and
resolves it deterministically instead.

Known real plan overall dimensions (this specific reference plan):
- horizontal `1669` = 16.69m
- vertical `1099` = 10.99m
- the local balcony reading of `274` is **not** the whole building width

Known current resolution for that plan:
- horizontal 16.69m, confidence **HIGH**, from two corroborating
  observations
- vertical 10.99m, confidence **MEDIUM**, from one observation
- No averaging is performed anywhere in this resolution.

`PageDimensions` and `EnvelopeTopology` perception both operate on the
**same** cropped image coordinate frame (`${userId}/analysis/${jobId}/cropped.jpg`).

Dimension-line endpoints are **not** automatically treated as
extension-line witness feet — that promotion is a separate, later,
explicit step (Phase2), not implied by PageDimensions alone.

**Do not reopen this architecture during EnvelopeTopologyV2 work.**

---

## 7. Phase1C architecture and status **[VERIFIED against actual source at HEAD]**

Phase1C-A (semantic planning) and Phase1C-B (canonical construction),
under `_shared/phase1c/*.ts`.

**Semantic proposal dispositions** (confirmed in `model.ts`,
`semantic_plan_proposal_v1.ts`, `semantic_plan_proposal_schema_v1.ts`):
`KEEP_ENVELOPE`, `REJECT_NOT_ENVELOPE`, `REJECT_DUAL_FACE`,
`SPLIT_REQUIRED`, `UNRESOLVED`.

- `KEEP_ENVELOPE` -> becomes `PRESERVE_CONFIRMED_TOPOLOGY` in the approved
  plan (grouped by `verificationScope`).
- `REJECT_NOT_ENVELOPE` -> becomes an explicit `DROP_REJECTED_EDGE` (never
  represented by silent omission).
- `REJECT_DUAL_FACE` -> the "one physical line, two faces" case: the inner
  face is `KEEP_ENVELOPE`, the outer face is `REJECT_DUAL_FACE` with a
  `dualFaceOf` pointer back to the kept edge.
- **`SPLIT_REQUIRED` is a valid, legitimate disposition that is currently
  NOT executable by the constructor.** It must never be silently coerced
  into `KEEP_ENVELOPE`/`REJECT_NOT_ENVELOPE`. Part D (the approved-plan
  builder) is documented to eventually route it to a deferred-issue
  mechanism, but as of `HEAD` it simply blocks readiness
  (`VALIDATION_NOT_EXECUTION_READY`, per-edge status
  `NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR`) — this is exactly what
  happened in the real H-C run (§13).
- `UNRESOLVED` — no disposition decided; also never execution-ready.

**Part C (semantic-plan validation) explicitly separates three
categories** (`semantic_plan_validation_result_v1.ts`):
`contractValid`, `coverageValid`, `semanticPolicyValid` — each is the AND
of every rule in that category. `executionReadyForPartD` = all three AND
every `perEdgeReadiness[i].status === 'EXECUTION_READY'`.

Confirmed rule names actually present in
`semantic_plan_validator_v1.ts`/`referential_integrity.ts`/
`semantic_plan_validation_result_v1.ts`: `EVERY_RAW_EDGE_HAS_PROPOSAL`
(coverage), `GAP_REQUIRES_TOPOLOGY_CONTEXT`, `NO_DUPLICATE_GAP_PROPOSAL`,
`ENVELOPE_RAW_CONSISTENCY` (exact ID-set equality against RAW, not
epsilon/proximity), `DUAL_FACE_FIELD_MATCHES_DISPOSITION`,
`KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE`.

**Part D (`approved_plan_builder_v1.ts`) treats Part C's readiness verdict
as authoritative and does NOT re-run semantic validation itself** — it
requires `executionReadyForPartD === true` up front and otherwise returns
`{ outcome: 'BLOCKED', blockingReasons }` without attempting translation.
It has real `throw new Error("IMPOSSIBLE_STATE: ...")` guards for
contract violations that "should never happen if Part C did its job" (e.g.
an execution-ready edge with no proposal at all, or with a disposition
that can never be execution-ready) — real, non-theoretical throws any
caller must catch (Part H-B does, per §9).

Canonical edge IDs always preserve the source RAW edge id:
`canonicalEdgeId = "canon-" + sourceRawEdgeId` — confirmed in
`construct.ts` (`canon-${edgeId}`, `canon-${perEntity.edgeId}`). Never
strip this prefix anywhere.

---

## 8. Shared Phase1C source of truth **[REPORTED test-count figure; file layout VERIFIED]**

The Phase1C-A/B library was migrated to a single physical shared location:
`supabase/functions/_shared/phase1c/` — **[VERIFIED, this is the actual,
current location; confirmed by direct import in
`analyze-sketch-v2-canonical-topology/index.ts` and by reading every file
under that directory in this and prior sessions]**.

This is the physical shared source. Where other consumers (Node/Claude
local packages, e.g. `claude/phase1c-a`, `claude/phase1c-b`,
`claude/phase2b-part-b`) need it, they go through thin adapters,
re-exports, or symlinks — **never** a duplicate re-implementation.

Recorded regression result at the closure of the migration phase ("Part
G"): 230/230 tests passing, Deno shared-code checks clean. **[REPORTED —
not re-run by this agent this session]**.

**Do not create a second/duplicate implementation of anything in
`_shared/phase1c/*` for any consumer's convenience.**

---

## 9. H-B — production canonical integration **[VERIFIED code; deployment status REPORTED]**

**File (the only file this phase created):**
`supabase/functions/analyze-sketch-v2-canonical-topology/index.ts`
(695 lines when written). Committed as `99f57e0f1b3ce349b97c3ad39dfe4d8b64ee6ec8`
— current `HEAD` **[VERIFIED]**.

Production chain:
```
envelope_topology artifact (selected per policy below)
  -> buildSemanticPlanProposalRequest
  -> exactly ONE OpenAI generation (no retry)
  -> parse/check proposal
  -> validateSemanticPlan
  -> buildApprovedPlan
  -> constructCanonicalTopology (runs canonical validation internally --
     do NOT call validateCandidate a second time; its result is already
     embedded as candidate.validationResults)
  -> persist artifact(s)
```

**Locked behavior:**
- Exactly one OpenAI generation call, no retry, per invocation.
- The constructor runs canonical validation internally; callers never
  re-derive or re-call it.
- SEMANTIC BLOCKED = HTTP 200, job -> `stage_complete`, no canonical
  artifact created. This is a legitimate outcome, not an error.
- TECHNICAL FAILURE = job -> `failed`, `error_message` set (via the
  `failJob` helper).
- `semantic_plan` artifact is **diagnostic/evidence only** —
  `canonical_topology` is the **sole** canonical geometry authority. A
  `semantic_plan` row with `status:"success"`/`buildOutcome:"BUILT"` must
  never itself be treated as canonical.
- Success persistence order is deliberately: `semantic_plan` **first**,
  `canonical_topology` **second**. (Explicitly audited and kept as-is —
  reversing this was proposed during the Part H-B audit and explicitly
  rejected by Yaron: an orphaned `status:"success"` `semantic_plan` row
  with no matching `canonical_topology` — job left `failed` — is
  acceptable and conservative; the reverse risk, an authoritative
  `canonical_topology` persisting while the job shows `failed`, is not.)
- Canonical invariant failure (an embedded `validationResults` entry fails
  after a plan was `BUILT`): best-effort diagnostic `semantic_plan` write
  (try/catch, result never inspected), then `failJob`, no canonical
  artifact ever created.
- Adapter/build exceptions (`envelopeTopologyV1ToRawTopology`,
  `buildApprovedPlan`, `constructCanonicalTopology` all wrapped in
  try/catch) are technical failures, not silent fallthroughs.

**Versioning:** shared `attempt` number =
`1 + max(latest "semantic_plan" version, latest "canonical_topology" version)`
for that job — a single query across both stages, specifically to avoid
duplicate version numbers across repeated BLOCKED/TECHNICAL_FAILURE/
SUCCESS reruns.

**Envelope-artifact selection authority (POLICY 1), currently locked:**
filter to `status === "valid"` artifacts, then choose the **newest** of
those (`sourceEnvelopeTopologyArtifactVersion`); a newer
invalid/forbidden-field attempt does **not** invalidate an older valid
one (`skippedNewerInvalidVersions` records what was skipped). **Do not
weaken this merely to make a specific historical artifact (e.g. Attempt3's
real v3) selectable.**

**Deployment status:** Yaron deployed and ran this function for real
(§10) — **[REPORTED]**, not something this agent (no Supabase CLI/
credentials in this sandbox) can independently confirm is still live.

---

## 10. Real H-C runtime verification **[REPORTED by Yaron — this section is CRITICAL, and this agent has no way to independently confirm any of it]**

Supabase project ref: `iywhxmuzvincfmezijtv`. The new canonical function
was deployed independently and invoked once against a real job:
`98861ede-1d27-462c-bdf6-2f5893b34c4a`.

Envelope-topology artifacts on that job:

| version | status | vertices | edges | edge IDs |
|---|---|---|---|---|
| v1 | valid | 11 | 11 | e1..e11 |
| v2 | valid | 9 | 9 | e1..e9 |
| v3 | invalid | 25 | 26 | e1..e26 |

(The separate "Attempt3" reference audit in §12 corresponds to this v3.)

H-B correctly selected v2 as input, because v3 was invalid (per POLICY 1,
§9).

Runtime response: HTTP 200, `status: blocked`,
`sourceEnvelopeTopologyArtifactVersion: 2`, `skippedNewerInvalidVersions: [3]`,
duration approximately 41 seconds. **No `canonical_topology` artifact was
created.**

**Do NOT rerun H-C merely to reproduce this result** — the outcome is
already known and recorded here; a rerun burns a real OpenAI call for no
new information.

---

## 11. Why v3 was invalid **[REPORTED — the validator logic itself IS VERIFIED against source in §14, but these specific per-run numbers/edge-IDs are Yaron's report of the real run, not re-derived by this agent]**

Exact validation failures reported for v3:

- `NOT_SINGLE_CLOSED_CYCLE` — no edge connects the `polygonOrder`
  wraparound pair `v25 -> v1`.
- `NOT_SINGLE_CLOSED_CYCLE` — edges `e21, e26` are disconnected/extraneous
  relative to the `polygonOrder` cycle.
- `AXIS_HINT_MISMATCH` — edge `e22` is marked `horizontal`, but its
  endpoints differ by 4.50pct vertically; V1's tolerance is 3pct.

**Diagnosis:** this does **not** prove the richer 26-edge perception is
unusable evidence. It proves `EnvelopeTopologyV1`'s validity contract
assumes a final-ish single closed polygon — which conflicts with what
generalized Phase1C is actually designed to consume: RAW perception
evidence that may legitimately be open, disconnected, incomplete,
occluded, semantically ambiguous, or contain extra candidate edges. The
active problem is a **contract mismatch at Phase1A** (the perception
layer), not an H-B bug, not a Phase1C bug, and not fixable by loosening
V1's tolerance or making `NOT_SINGLE_CLOSED_CYCLE` non-fatal *inside V1*.

---

## 12. Attempt3 semantic audit reference **[REPORTED — explicitly TEST EVIDENCE, not production hardcoding, per Yaron's own repeated instruction]**

RAW edges: `e1..e26`.

Known human-reviewed semantic KEEP set (14 edges):
`e1, e2, e5, e6, e7, e8, e9, e10, e11, e12, e19, e20, e25, e26`.

Rejected: `e3, e4, e13, e14, e15, e16, e17, e18, e21, e22, e23`.

`e24` unresolved due to legend/source occlusion.

Known issues on specific kept edges:
- `e19` — KEEP, HIGH confidence, but geometry `MISALIGNED`/`PARALLEL_OFFSET`.
- `e20` — KEEP, HIGH confidence, geometry `UNRESOLVED`.
- A gap at `v13` (opening-continuation-unknown).
- A gap around `e24` (source occlusion).

Known resulting Phase1C candidate state: `OPEN_WITH_GAPS`, 14 keep edges,
2 gaps, 3 deferred issues, 4 open components.

Gaps: `gap-op-06` (`OPENING_CONTINUATION_UNKNOWN`, at `v13`),
`gap-op-07` (`SOURCE_OCCLUDED`, around `v23`/`v24`).

Deferred issues: `deferred-op-02`, `deferred-op-05`, `deferred-op-08`.

**Again: do NOT hardcode any of these specific IDs or results into
generalized production logic.** This is reference/test evidence for
sanity-checking a new implementation's general behavior, nothing more.

---

## 13. H-C semantic result on v2 (the actually-selected artifact) **[REPORTED]**

Phase1C processed the selected 9-edge v2 successfully at the *contract*
level — it produced a proposal for all 9 edges. Part C result:
`contractValid = true`, `coverageValid = true`, `semanticPolicyValid = true`,
`executionReadyForPartD = false`.

Reason: `e6 = SPLIT_REQUIRED` (per-edge readiness:
`NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR` — matches §7's note that
`SPLIT_REQUIRED` is legitimate but not yet executable). Part D therefore
correctly returned `BLOCKED: VALIDATION_NOT_EXECUTION_READY`.

**This SPLIT_REQUIRED-on-e6 result is *not* the priority thing to fix
next.** The more fundamental, upstream issue is that the richer 26-edge
RAW perception (v3) never became usable authority at all, because V1
demanded a single closed polygon it couldn't produce (§11). Fixing V1's
selection or the `SPLIT_REQUIRED` executability gap would still leave the
real underlying contract-mismatch problem unsolved.

---

## 14. EnvelopeTopologyV1 diagnosis **[VERIFIED against actual source at HEAD]**

`_shared/envelope_topology_schema_v1.ts` — contains `vertices`, `edges`,
`polygonOrder`, `perceptionNotes`. Its own header comment explicitly
describes this as "the ONLY thing the AI model is allowed to return for
envelope perception," framed as "an ordered closed polygon." `polygonOrder`
(`string[]`, `minItems: 3`) is a required field.

The production perception prompt
(`analyze-sketch-v2-envelope-topology/index.ts`, lines 68-131,
`ENVELOPE_TOPOLOGY_SYSTEM_PROMPT`) also explicitly instructs the model to
produce a continuous closed polygon ("לתעד אותו כפוליגון סגור... לאורך כל
ההיקף ברציפות") — while, notably, *also* explicitly forbidding
simplifying to a silhouette or bridging over a recess/jog. The prompt is
already trying to get honest, detailed perception; it's the schema and
validator that then force that honest perception into a shape it can't
always be.

`_shared/envelope_topology_validators_v1.ts` (450 lines, read in full):
`checkSingleClosedCycle()` requires every consecutive `polygonOrder` pair
(with wraparound) to be connected by exactly one edge, AND every edge in
`topology.edges` to be used exactly once by that traversal — no
extraneous or disconnected edges allowed. `AXIS_HINT_MISMATCH`
(tolerance `AXIS_HINT_TOLERANCE_PCT = 3`) is fatal.
`validateEnvelopeTopologyV1()` returns `valid` only when
`errors.length === 0`.

The **sole** production caller of this validator, confirmed by
reconnaissance: `analyze-sketch-v2-envelope-topology/index.ts`.

**V1 must remain frozen/historical. Do not silently change V1 semantics,
its schema, its validator, or its tolerance — for any reason, including to
make any specific job pass.**

---

## 15. Locked EnvelopeTopologyV2 decisions — THE CURRENT ACTIVE DESIGN

An explicit, separate `EnvelopeTopologyV2` is being created rather than
silently redefining V1.

**V2's responsibility:** the AI returns **observed image-space topology
evidence** — not a canonical polygon.

**LOCKED — no `polygonOrder`.** V2 has no `polygonOrder` field at all.
Not optional, not nullable, not reinterpreted as an open traversal. The
graph itself (`vertices + edges`) is the evidence. A missing edge remains
missing. Never synthesize closure to satisfy a schema.

**LOCKED — `axisHint` remains, but is non-authoritative.** Keep
`horizontal | vertical | diagonal_or_unknown` as useful evidence, but an
axis-hint/geometry mismatch is a **non-fatal diagnostic** in V2, never
invalidating. Coordinates are the observed geometry; `axisHint` is just an
AI classification hint a later deterministic solver may use or reject on
its own terms. **Do not modify V1's tolerance** to make any run pass.

**LOCKED — no explicit components/polylines/gap objects in V2.** Multiple
disconnected/open structures are represented naturally by the plain edge
list (e.g. `e1: v1->v2, e2: v2->v3` plus separately `e3: v4->v5, e4: v5->v6`
is sufficient to represent two components) — the AI is never asked to
compute component membership; deterministic code can derive connected
components later if a diagnostic needs them. No explicit gap objects
either — if there's no visually supported edge between two locations, the
AI simply omits it. Gap/opening-continuation-unknown/source-occlusion/
deferred-issue/envelope-membership semantics stay Phase1C's job, never
move upstream into perception. `perceptionNotes` may still describe
uncertainty/occlusion as evidence, but carry no topology authority.

**LOCKED — semantic ambiguity allowed; structural corruption is not.**
Allowed in V2: extra candidate edges, disconnected edges/components, open
chains, edges Phase1C later rejects, uncertain role/axis hints, multiple
visually-plausible boundary candidates (as long as each is a concrete
edge with valid endpoints). Fatal in V2: duplicate vertex IDs, duplicate
edge IDs, an edge referencing an unknown vertex, malformed/non-finite
image coordinates, forbidden metric/scale/area/dimension fields, true
zero/near-zero unusable edges. **Never use duplicate IDs or malformed
structure as an "ambiguity" mechanism** — ambiguity must be expressed as
multiple valid, distinct edges, never as corrupt data.

**Proposed minimal V2 shape** (starting point — implementer must still
check OpenAI strict-mode JSON Schema implications, e.g. the
required-but-nullable pattern V1 already uses, before finalizing):

```ts
interface EnvelopeTopologyV2 {
  schemaVersion: "envelope_topology_v2";
  vertices: EnvelopeTopologyVertexV2[];
  edges: EnvelopeTopologyEdgeV2[];
  perceptionNotes: EnvelopeTopologyPerceptionNoteV2[] | null;
}

interface EnvelopeTopologyVertexV2 {
  id: string;
  imagePct: { xPct: number; yPct: number };
  cornerAngleHint: "orthogonal_90" | "acute" | "obtuse" | "uncertain" | null;
}

interface EnvelopeTopologyEdgeV2 {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  axisHint: "horizontal" | "vertical" | "diagonal_or_unknown";
  roleHint: "exterior_wall" | "opening" | "uncertain";
}

interface EnvelopeTopologyPerceptionNoteV2 {
  vertexId: string | null;
  edgeId: string | null;
  note: string;
}
```

No metric fields, ever: `meters`, `lengthMeters`, `scale`, `metersPerPct`,
`area`, `areaMeters`, `dimensionRefs`, `paramT`/world metric geometry,
solver coordinates. No `polygonOrder`.

---

## 16. V2 validation direction (locked shape; not yet implemented)

Explicitly separate:

- **Structural validity** — determines whether V2 RAW evidence is usable
  downstream at all. Fatal examples: duplicate vertex ID, duplicate edge
  ID, edge referencing an unknown vertex, invalid/non-finite coordinate,
  an `imagePct` bound violation (only if such a bound is already
  justified elsewhere in the existing contract — implementer must check),
  forbidden fields, a zero/near-zero unusable edge. Implementer must
  inspect the existing V1 parser/schema to pin the exact final list for
  V2.
- **Diagnostics** — describe uncertainty/shape but never invalidate
  otherwise-usable evidence. Expected: graph is open, graph has multiple
  connected components, graph has no closed cycle, `axisHint` disagrees
  with endpoint geometry, `roleHint`/`axisHint` uncertain, a
  candidate/extraneous edge exists where deterministically detectable.

**Do NOT make "single closed cycle" a V2 structural requirement.** Do not
add any Attempt3-specific (or any other specific job's) exception into the
general validator.

---

## 17. V2 prompt direction (not yet written)

The V2 prompt must **not** require: a continuous complete perimeter, a
closed polygon, or invented closure.

It should instruct the model to:
- report visually supported physical boundary candidates,
- preserve jogs/recesses rather than bridging over them,
- not invent hidden continuations for occluded/missing evidence,
- not discard visible evidence merely because the resulting graph doesn't
  close,
- treat openings carefully — an opening does not automatically mean the
  physical wall ceases to exist at that point,
- report uncertainty (via `perceptionNotes`/hint fields) instead of
  "repairing" the topology itself,
- never output metric information (same prohibition as V1).

**But V2's prompt must not ask the model to perform Phase1C's final
semantic classification** — V2 is perception evidence only; KEEP/REJECT/
SPLIT/gap/deferred decisions stay downstream.

---

## 18. Reconnaissance already completed for V2 **[VERIFIED by this agent at `HEAD = 99f57e0`]**

A grep for `EnvelopeTopologyV1` / `envelope_topology_schema_v1` /
`envelope_topology_validators_v1` / `parseEnvelopeTopologyV1` /
`envelopeTopologyV1ToRawTopology` across the repo returns 24 file hits,
but the **real** blast radius for introducing V2 (without touching V1) is
substantially narrower.

**Real code dependencies:**
- `_shared/envelope_topology_schema_v1.ts`,
  `_shared/envelope_topology_validators_v1.ts` — the V1 contract itself.
  Frozen, do not touch.
- `_shared/envelope_topology_debug_metrics_v1.ts` — imports the V1 type;
  its `computeTopologyCoverageDebug` shoelace-area calculation depends
  specifically on `polygonOrder`. **This cannot be reused as-is for V2**
  (V2 has no `polygonOrder`) — a V2-equivalent debug-metrics module, if
  wanted at all, needs its own area/coverage approach or must omit
  polygon-area metrics. Not yet decided whether V2 needs equivalent debug
  metrics at all — flag to Yaron if unclear.
- `analyze-sketch-v2-envelope-topology/index.ts` — the sole current V1
  producer (see open question §19.B).
- `analyze-sketch-v2-canonical-topology/index.ts` — H-B's function;
  consumes V1 via `parseEnvelopeTopologyV1` / `envelopeTopologyV1ToRawTopology`
  (see open question §19.C).
- `_shared/phase1c/adapter.ts` — `envelopeTopologyV1ToRawTopology`, the
  one place V1 shape gets reshaped into Phase1C's `RawTopology`.

**Most `_shared/phase1c/*` files consume the already-adapted `RawTopology`
(or the envelope only as prompt-building context) and are *likely* able to
remain unchanged — but the next agent must verify this file-by-file before
implementation**, not assume it from this note alone.

**Documentation-only mentions (confirmed by reading each hit, not just
counting the grep match):**
- `claude/phase2b-part-b/src/witness-perception-schema.ts` — one comment
  citing V1's OpenAI strict-mode convention as precedent; no actual
  dependency.
- `claude/SHIFT_HANDOFF_2026-09-16.md` — prior handoff narrative, no code
  dependency.

**Test fixtures referencing V1** (`claude/phase1c-a/src/fixtures/sample_envelope.ts`,
5 files under `claude/phase1c-a/src/__tests__/*.test.ts`,
`claude/phase1c-b/src/fixtures/attempt3.ts`) can remain exactly as
historical V1 tests — irrelevant to V2 unless new, separate V2-specific
fixtures/tests are wanted later.

---

## 19. V2 decisions still OPEN — do not pretend these were decided

**This is where the next agent should continue.** These four questions
were asked by the outgoing agent because Yaron's design message was cut
off mid-sentence earlier in this conversation; they remain genuinely
unresolved as of this handoff.

**A. Artifact stage name.** Does V2 persist under
`stage = "envelope_topology"` (same stage as V1) with
`payload.topology.schemaVersion = "envelope_topology_v2"` as the
in-payload discriminator, or under a new stage value such as
`"envelope_topology_v2"`? Needs the minimum coherent migration and a clean
H-B selection story either way.

**B. Producer strategy.** Does the existing
`analyze-sketch-v2-envelope-topology/index.ts` become the V2 producer
(meaning V1 and V2 rows would then coexist, produced by the same
function), or does a new sibling Edge Function produce V2 while the V1
producer stays byte-for-byte historical/untouched? Prefer minimum coherent
blast radius, but do not silently redefine what the existing V1 producer's
artifacts mean.

**C. H-B compatibility / selection.** H-B currently selects the newest
`status:"valid"` `envelope_topology` artifact and parses it as V1. V2's
structural validity bar is intentionally looser than V1's (§16), so H-B
needs an explicit schema-aware selection and parsing path once V2 exists.
Must NOT: parse a V2 payload as V1, select a historical invalid v3-style
artifact, or weaken the newest-valid authority policy just to make any
specific historical artifact selectable. Likely future flow: a
structurally-valid V2 artifact -> an explicit V2 parser -> an explicit
V2-to-`RawTopology` adapter -> Phase1C -> canonical construction. Whether
a temporary V1 fallback path is useful or safe during the transition is
itself undecided.

**D. Existing real job / history.** Do not backfill or rewrite the real
job's (`98861ede-...`) historical v1/v2/v3 rows just to make H-C
retroactively "pass" under V2. Prefer generating new V2 artifacts only
from new production runs going forward; the historical Attempt3/v3
evidence stays reference material (§12), never live production data to be
rewritten.

Do not guess any of these. If Yaron answers them directly in a future
message, treat that as authoritative and this section as resolved/closed.

---

## 20. Immediate next task for the incoming agent

**Do not restart architecture discovery from zero** — §1-§19 of this file
is the accumulated state; re-derive git facts (§2) to confirm nothing
moved, but do not re-litigate settled decisions.

1. Get Yaron's answers to the four open questions in §19.
2. Finish the **minimum coherent** `EnvelopeTopologyV2` production plan,
   resolving only those four open decisions — do not expand scope beyond
   them.
3. Present, before writing any code: exact files to add; exact files to
   modify; exact files left untouched; the exact V2 schema; the exact
   validator result shape (fatal vs. diagnostic, per §16); the exact
   V2-to-`RawTopology` adapter; the exact producer behavior; the exact
   H-B schema-aware selection behavior; the debug-metrics decision (§18);
   what tests (if any) get added; an estimated implementation size.
4. Target vertical slice:
   `real plan -> EnvelopeTopologyV2 RAW -> Phase1C -> ApprovedPlan -> CanonicalTopology -> visual inspection`.
5. **Get to that vertical slice quickly.** Yaron has explicitly said he
   wants forward progress after roughly 16 hours of architecture/
   infrastructure work on this sub-effort — favor the smallest coherent
   implementation that still preserves every locked invariant in §15/§16,
   rather than another large architecture-only cycle. Do not spend a
   whole additional planning cycle before producing this slice once §19
   is answered.
6. Follow this project's established phase discipline throughout: plan ->
   explicit approval -> narrow implementation (ideally one new file, as
   with H-B) -> full audit -> explicit approval -> commit -> push (or the
   patch-file fallback per §2) — never skip straight to implementation.

---

## 21. What comes immediately after V2 (future, not now)

Once a real `canonical_topology` is successfully produced end-to-end and
visually checked, the intended next steps are, in order:
Phase2C (`MeasurementWitness` deterministic proof/binding) -> constraint
solver -> rooms/global walls -> openings -> stairs/special elements ->
final deterministic validation -> 3D. **Do not prematurely start any of
these while canonical production is still blocked upstream by V1/V2.**

---

## 22. Security / operational notes

- **No credentials or tokens are included anywhere in this file.** This
  agent checked the working tree for stray `.env`/credential files before
  writing this handoff — none found **[VERIFIED — none found in this
  sandbox's copy of the repo]**.
- **SECURITY ACTION REQUIRED:** a legacy Supabase `service_role`
  credential was exposed during CLI inspection earlier in this project
  (outside this agent's own actions/session). Rotate it once the current
  runtime work is safely complete. **[REPORTED — this agent never saw,
  handled, or persisted the actual credential value, and does not know
  further detail beyond the fact that it needs rotation.]**
- The real H-C invocation (§10) authenticated as the actual, real,
  anonymous job's owner using a legitimate Supabase Auth session/JWT —
  **never** a forged token and never a service-role bypass of normal auth.
  Continue that practice: never forge JWTs or bypass production auth in
  any future verification run.

---

## 23. Final next-agent checklist

1. Verify `HEAD` — `git fetch origin main && git rev-parse HEAD origin/main`
   — confirm it still matches (or note what changed) before relying on
   any file/line reference in this document.
2. Confirm `git status --short` is clean before starting any new work.
3. Re-read §19 (open V2 production-semantics questions) and get Yaron's
   answers before writing any V2 code.
4. Re-confirm the blast-radius list in §18 file-by-file for the
   `_shared/phase1c/*` files this agent flagged as "likely unaffected but
   not yet individually confirmed."
5. Do not touch anything listed as frozen in §3.
6. Do not commit or push this handoff file, or any other change, until
   Yaron explicitly reviews and approves it.
7. Follow the plan -> approval -> narrow implementation -> audit ->
   approval -> commit -> push/patch discipline for the V2 work itself,
   exactly as every prior phase in this project was done.
