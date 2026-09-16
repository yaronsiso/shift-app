# SHIFT Envelope Constraint Solver — Handoff, 2026-09-16

## Phase 1B + 1C: COMPLETE, APPROVED, DELIVERED

Full semantic audit (e1-e26) of RAW Attempt #3 EnvelopeTopologyV1 artifact
(job 98861ede-1d27-462c-bdf6-2f5893b34c4a) is done. Canonical topology
construction (Phase 1C-B) is implemented, tested, and delivered as a
standalone TypeScript package: phase1c-b-complete.zip (9 files: types/model.ts,
construct.ts, validate.ts, report.ts, fixtures/attempt3.ts, __tests__/construct.test.ts,
tsconfig.json, package.json, types/node-builtins.d.ts).

Verified output for Attempt #3: 14 CanonicalEdges, 2 CanonicalGaps (v13
opening-continuation-unknown, e24 source-occluded-by-legend), 3 DeferredIssues
(v21/v1 endpoint discontinuity, v19/v20 geometry misalignment, mw1 unconfirmed
boundary candidate), 4 connected components, candidateState=OPEN_WITH_GAPS.
21/21 tests pass, tsc clean, all 12 structural validation rules pass.

This package has NOT yet been integrated into the actual repo/pipeline code —
it was built and tested in an isolated sandbox (Claude has no direct repo
access). Next integration step: copy these files into the real project
structure and wire them to actually consume a live Attempt #3 (or later)
artifact instead of the bundled fixture.

## Current Phase

Phase 1C-B: COMPLETE / APPROVED
Phase 2-A Witness Promotion Design: COMPLETE / APPROVED
Phase 2-B Witness Promotion Implementation: NOT STARTED

Current checkpoint before Phase 2-B implementation:
verify the current page_dimensions measurement geometry contract and runtime evidence,
especially the exact semantics and runtime population of lineStartPct / lineEndPct.

Do not implement Phase 2-B until this checkpoint is resolved.

## Authority Rules

- PageDimensions is the measurement authority.
- CanonicalTopologyCandidate is the topology authority.
- RAW/AUDITED entities do not automatically qualify as TopologyAnchors.
- AI proposes perception evidence; deterministic code validates proof and promotion.
- Measurement evidence must never mutate topology.
- No numeric-only matching.
- No global meters-per-pixel scale.
- No topology repair or gap closure in Phase 2.

## Next Required Verification

Inspect:
- dimension_evidence_schema_v3.ts
- PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA
- runtime page_dimensions artifact

Determine exact semantics of:
- bboxPct
- lineStartPct
- lineEndPct

Classify lineStartPct/lineEndPct as:
DIMENSION_LINE
EXTENSION_WITNESS
PROJECTED_SPAN
or AMBIGUOUS

Then determine separately:

CAN_SUPPORT_PROJECTED_INFERRED = YES / PARTIAL / NO
CAN_SUPPORT_EXTENSION_LINE_VERIFIED = YES / PARTIAL / NO

No Phase 2-B code until this verification is complete.

## No production code has been changed by this work.

Everything above is design/audit/planning + one standalone delivered package
not yet wired in. Stage0/PageDimensions/Stage1 edge functions are untouched.
