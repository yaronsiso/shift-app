// supabase/functions/analyze-sketch-v2-canonical-topology/index.ts
//
// PART H — Production integration of Phase1C-A (Parts A-D) and Phase1C-B,
// per Yaron's locked PART H-A/H-B decisions. BRAND NEW, SEPARATE Edge
// Function. Does not replace, call, or modify any existing function —
// `analyze-sketch-v2-scope` / `-page-dimensions` / `-envelope` /
// `-envelope-topology` all coexist unchanged.
//
// What this function does, and nothing more:
//   1. Given a jobId whose "envelope_topology" stage has already produced
//      at least one artifact with payload.status==="valid", take the
//      NEWEST such valid artifact as input authority (a newer invalid /
//      forbidden_field_error attempt for the same job does NOT invalidate
//      an older valid one — see POLICY 1 below).
//   2. Runs the existing, closed, already-tested Phase1C-A/Phase1C-B
//      pipeline against it, ONE OpenAI Structured Outputs call, no retry:
//        envelopeTopologyV1ToRawTopology
//          -> buildSemanticPlanProposalRequest -> (one OpenAI call)
//          -> parseAndCheckSemanticPlanProposalResponse
//          -> validateSemanticPlan
//          -> buildApprovedPlan
//          -> [if BUILT] constructCanonicalTopology (embeds validateCandidate
//             internally — see POLICY 2 below, this file never calls
//             validateCandidate itself)
//   3. Persists TWO new artifact stages under the existing, unmodified
//      analysis_artifacts table (no new migration, `stage` is free text):
//        - "semantic_plan"      -- diagnostic/evidence only, never contains
//                                  CanonicalTopologyCandidate geometry.
//        - "canonical_topology" -- the sole authoritative canonical
//                                  geometry artifact, written ONLY after
//                                  buildApprovedPlan returned BUILT, the
//                                  constructor ran without throwing, AND
//                                  every candidate.validationResults entry
//                                  passed.
//
// ==========================================================================
// POLICY 1 — ENVELOPE TOPOLOGY AUTHORITY (locked, this session)
// ==========================================================================
// Input authority = FILTER valid -> THEN select latest. Concretely: fetch
// every "envelope_topology" artifact for this job ordered by version desc,
// take the newest one whose payload.status==="valid", and record every
// higher-versioned artifact skipped over (invalid / forbidden_field_error)
// as `skippedNewerInvalidVersions` for full traceability in the persisted
// `semantic_plan` artifact. A newer failed attempt never invalidates an
// older valid one — envelope_topology's own design deliberately never
// touches analysis_jobs.status/current_stage on invalid/forbidden_field_error,
// treating each attempt as independent (see that function's file header).
// This must never be silent: `sourceEnvelopeTopologyArtifactVersion` and
// `skippedNewerInvalidVersions` are always persisted in `semantic_plan`,
// whether or not anything was actually skipped.
//
// ==========================================================================
// POLICY 2 — CANONICAL VALIDATION FAILURE (locked, this session)
// ==========================================================================
// constructCanonicalTopology already calls validateCandidate INTERNALLY
// (see supabase/functions/_shared/phase1c/construct.ts) and returns the
// result embedded as candidate.validationResults — this file inspects that
// embedded result and does NOT call validateCandidate a second time. If
// ANY candidate.validationResults entry has passed===false, that is
// classified as TECHNICAL_FAILURE (a BUILT ApprovedPlan followed by a
// failing canonical invariant indicates an internal contract/invariant
// violation, not a normal semantic blocking outcome) — NOT persisted as
// canonical_topology, NOT converted into SEMANTIC_BLOCKED, and the job is
// marked failed via the existing failJob convention, with the failing rule
// names/details included in the (500-char-truncated) error_message.
// CODE-AUDIT CORRECTION (this session): a best-effort `semantic_plan`
// diagnostic row (status:"technical_failure", rule names/details only,
// never candidate geometry) is now attempted before failJob, purely so
// this should-be-impossible state stays diagnosable in production — its
// own outcome is never inspected and never changes the TECHNICAL_FAILURE
// result or overrides the original diagnostic detail.
//
// ==========================================================================
// POLICY 3 — SHARED ATTEMPT/VERSION NUMBERING (code-audit correction, this
// session)
// ==========================================================================
// The next shared attempt/version for `semantic_plan` and
// `canonical_topology` is 1 + max(latest semantic_plan version, latest
// canonical_topology version) for this job — derived from BOTH stages via
// one query, never from canonical_topology alone. canonical_topology is
// only ever written on full success, so deriving the counter from it alone
// would silently reuse the same version number across repeated BLOCKED
// reruns, repeated diagnostic-TECHNICAL_FAILURE reruns, or a "semantic_plan
// exists but canonical_topology does not" partial-persistence state. No DB
// migration, no unique constraint, no transaction framework — same
// read-then-insert convention every other stage already uses, just reading
// the right two stages.
//
// Explicitly NOT done here (frozen / out of scope, per Yaron's locked
// decisions):
//   - No orchestrator/webhook — this is a single, stateless Edge Function
//     invoked directly, same shape as every other stage.
//   - No refactor of the local callOpenAiJsonSchema pattern into a shared
//     module — duplicated here exactly like in every other stage file.
//   - No modification whatsoever to _shared/phase1c/*, canonical_topology_v1.ts,
//     envelope_topology_schema_v1.ts, or any other existing file.
//   - No corrective/semantic retry of the OpenAI call (unlike `envelope`'s
//     one-time geometry-mismatch retry) — Part B is a single-shot call.
//   - No render/3D, Phase2B/witness/solver, Flutter, or DB migration work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseEnvelopeTopologyV1,
  type EnvelopeTopologyV1,
} from "../_shared/envelope_topology_schema_v1.ts";
import type {
  CanonicalTopologyCandidate,
  ValidationResult,
} from "../_shared/canonical_topology_v1.ts";
import { envelopeTopologyV1ToRawTopology } from "../_shared/phase1c/adapter.ts";
import type { RawTopology, ApprovedPlan } from "../_shared/phase1c/model.ts";
import { buildSemanticPlanProposalRequest } from "../_shared/phase1c/build_semantic_plan_request.ts";
import { parseAndCheckSemanticPlanProposalResponse } from "../_shared/phase1c/parse_semantic_plan_proposal_response.ts";
import type { ReferentialIntegrityResult } from "../_shared/phase1c/referential_integrity.ts";
import { validateSemanticPlan } from "../_shared/phase1c/semantic_plan_validator_v1.ts";
import type { SemanticPlanValidationResultV1 } from "../_shared/phase1c/semantic_plan_validation_result_v1.ts";
import { buildApprovedPlan } from "../_shared/phase1c/approved_plan_builder_v1.ts";
import type { ApprovedPlanBlockingReason } from "../_shared/phase1c/approved_plan_build_result_v1.ts";
import { constructCanonicalTopology } from "../_shared/phase1c/construct.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Duplicated local wrapper — same pattern as every existing stage file
// (scope / page-dimensions / envelope / envelope-topology). Per locked
// decision: no refactor into a shared module.
async function callOpenAiJsonSchema(
  messages: Array<{ role: string; content: unknown }>,
  schemaName: string,
  schema: unknown,
): Promise<
  | { ok: true; parsed: unknown; usage: Record<string, unknown> }
  | { ok: false; detail: string }
> {
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

interface EnvelopeTopologyArtifactRow {
  version: number;
  payload: {
    status: "valid" | "invalid" | "forbidden_field_error";
    topology: EnvelopeTopologyV1 | null;
  };
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

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") {
    return jsonResponse({ error: "bad_request", detail: "jobId is required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- auth: normal-user pattern only (same as `envelope` / `scope` /
  // `page-dimensions`) — no service_role dual-auth path, per Part H-A
  // recommendation (no ops-testing requirement was locked for this stage).
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized", detail: "invalid token" }, 401);
  }
  const userId = userData.user.id;

  // --- verify the job exists and belongs to this user ----------------------

  const { data: jobRow, error: jobFetchError } = await supabase
    .from("analysis_jobs")
    .select("id, user_id")
    .eq("id", jobId)
    .single();

  if (jobFetchError || !jobRow) {
    return jsonResponse({ error: "not_found", detail: "job not found" }, 404);
  }
  const job = jobRow as { id: string; user_id: string };
  if (job.user_id !== userId) {
    return jsonResponse({ error: "forbidden", detail: "job does not belong to this user" }, 403);
  }

  async function failJob(errorMessage: string) {
    await supabase
      .from("analysis_jobs")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }

  // --- POLICY 1: select newest envelope_topology artifact whose
  // payload.status==="valid", recording every skipped newer invalid /
  // forbidden_field_error version for traceability. -------------------------

  const { data: envelopeTopologyArtifacts, error: envelopeTopologyFetchError } = await supabase
    .from("analysis_artifacts")
    .select("version, payload")
    .eq("job_id", jobId)
    .eq("stage", "envelope_topology")
    .order("version", { ascending: false });

  if (envelopeTopologyFetchError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check envelope_topology stage", jobId },
      500,
    );
  }
  if (!envelopeTopologyArtifacts || envelopeTopologyArtifacts.length === 0) {
    return jsonResponse(
      {
        error: "bad_request",
        detail:
          "envelope_topology must complete for this job before canonical-topology can run — call analyze-sketch-v2-envelope-topology first",
        jobId,
      },
      400,
    );
  }

  const rows = envelopeTopologyArtifacts as unknown as EnvelopeTopologyArtifactRow[];
  const skippedNewerInvalidVersions: number[] = [];
  let selectedRow: EnvelopeTopologyArtifactRow | null = null;
  for (const row of rows) {
    if (row.payload?.status === "valid" && row.payload.topology) {
      selectedRow = row;
      break;
    }
    skippedNewerInvalidVersions.push(row.version);
  }

  if (!selectedRow) {
    // No valid envelope_topology artifact exists at any version for this
    // job — a caller/sequencing precondition failure (mirrors
    // page-dimensions' "stage 0 must complete" 400, not a job failure).
    return jsonResponse(
      {
        error: "bad_request",
        detail:
          "no valid envelope_topology artifact exists for this job (all attempts are invalid/forbidden_field_error) — re-run analyze-sketch-v2-envelope-topology until it succeeds",
        jobId,
        skippedNewerInvalidVersions,
      },
      400,
    );
  }

  const sourceEnvelopeTopologyArtifactVersion = selectedRow.version;

  // Defensive re-validation of the stored topology, exactly as the shared
  // parser is meant to be used on a value read back from storage.
  let envelope: EnvelopeTopologyV1;
  try {
    envelope = parseEnvelopeTopologyV1(selectedRow.payload.topology);
  } catch (err) {
    await failJob(`stored envelope_topology artifact failed re-validation: ${String(err)}`);
    return jsonResponse(
      {
        error: "internal_error",
        detail: `stored envelope_topology artifact failed re-validation: ${String(err)}`,
        jobId,
      },
      500,
    );
  }

  // FIX 2 (code-audit correction): parseEnvelopeTopologyV1 only performs a
  // shallow forbidden-field-name check (see envelope_topology_schema_v1.ts's
  // own doc comment) — it does NOT validate structural shape. A malformed
  // stored payload that passes that shallow check (e.g. missing/non-array
  // vertices/edges) would otherwise crash envelopeTopologyV1ToRawTopology's
  // unguarded .map() calls with an uncaught TypeError. Classified as
  // TECHNICAL_FAILURE, exactly like every other unexpected-shape failure in
  // this file — no OpenAI call, no semantic_plan, no canonical_topology are
  // ever reached from this branch.
  let raw: RawTopology;
  try {
    raw = envelopeTopologyV1ToRawTopology(envelope);
  } catch (err) {
    await failJob(`envelopeTopologyV1ToRawTopology threw on stored topology: ${String(err)}`);
    return jsonResponse(
      {
        error: "internal_error",
        detail: `envelopeTopologyV1ToRawTopology threw on stored topology: ${String(err)}`,
        jobId,
      },
      500,
    );
  }

  // FIX 3 (code-audit correction): next shared attempt/version =
  // 1 + max(latest semantic_plan version, latest canonical_topology version)
  // for this job — a single query across BOTH stages (not canonical_topology
  // alone). canonical_topology is written ONLY on full success, so deriving
  // the shared counter from it alone would silently reuse the same version
  // number across repeated BLOCKED reruns, diagnostic TECHNICAL_FAILURE
  // reruns, and the "semantic_plan exists but canonical_topology does not"
  // partial-persistence state. Missing history for either stage counts as 0
  // (no rows -> attempt=1), matching the existing per-stage convention.
  const { data: existingArtifacts, error: versionCheckError } = await supabase
    .from("analysis_artifacts")
    .select("version")
    .eq("job_id", jobId)
    .in("stage", ["semantic_plan", "canonical_topology"])
    .order("version", { ascending: false })
    .limit(1);

  if (versionCheckError) {
    return jsonResponse(
      {
        error: "internal_error",
        detail: "failed to check semantic_plan/canonical_topology version",
        jobId,
      },
      500,
    );
  }
  const attempt =
    existingArtifacts && existingArtifacts.length > 0
      ? ((existingArtifacts[0] as { version: number }).version + 1)
      : 1;

  // --- cropped image: same convention/path as every other stage ------------

  const croppedImagePath = `${userId}/analysis/${jobId}/cropped.jpg`;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("renders")
    .createSignedUrl(croppedImagePath, 600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    await failJob("failed to create signed url for cropped image");
    return jsonResponse(
      {
        error: "internal_error",
        detail: "failed to sign cropped image url (did stage 0 upload a crop for this job?)",
        jobId,
      },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "processing",
      current_stage: "canonical_topology",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const startedAt = Date.now();

  // --- Part B: ONE OpenAI Structured Outputs call, no retry -----------------

  const request = buildSemanticPlanProposalRequest(envelope, signedUrlData.signedUrl);

  const aiResult = await callOpenAiJsonSchema(
    // deno-lint-ignore no-explicit-any
    request.messages as any,
    request.responseFormat.json_schema.name,
    request.responseFormat.json_schema.schema,
  );

  const durationMs = Date.now() - startedAt;

  if (!aiResult.ok) {
    await failJob(aiResult.detail);
    return jsonResponse({ error: "internal_error", detail: aiResult.detail, jobId }, 500);
  }

  // --- Part B structural pipeline: firewall + shape + referential integrity -

  let structural: {
    proposal: ReturnType<typeof parseAndCheckSemanticPlanProposalResponse>["proposal"];
    referentialIntegrity: readonly ReferentialIntegrityResult[];
  };
  try {
    structural = parseAndCheckSemanticPlanProposalResponse(aiResult.parsed, envelope);
  } catch (err) {
    await failJob(`semantic plan proposal response failed structural validation: ${String(err)}`);
    return jsonResponse(
      {
        error: "internal_error",
        detail: `semantic plan proposal response failed structural validation: ${String(err)}`,
        jobId,
      },
      500,
    );
  }

  // --- Part C: deterministic semantic validation ----------------------------

  const validation: SemanticPlanValidationResultV1 = validateSemanticPlan(
    envelope,
    raw,
    structural.proposal,
  );

  // --- Part D: translate to ApprovedPlan, or BLOCKED ------------------------
  //
  // FIX 1 (code-audit correction): approved_plan_builder_v1.ts documents two
  // IMPOSSIBLE_STATE throws for a contract violation between Part C's
  // readiness verdict and Part D's own re-derivation — the exact same
  // "impossible programmer/contract state" category as
  // constructCanonicalTopology's own contradiction throw handled below.
  // Treated identically: TECHNICAL_FAILURE, never reinterpreted as BLOCKED.

  let buildResult: ReturnType<typeof buildApprovedPlan>;
  try {
    buildResult = buildApprovedPlan(envelope, raw, structural.proposal, validation);
  } catch (err) {
    await failJob(`buildApprovedPlan threw on an execution-ready proposal: ${String(err)}`);
    return jsonResponse(
      {
        error: "internal_error",
        detail: `buildApprovedPlan threw on an execution-ready proposal: ${String(err)}`,
        jobId,
      },
      500,
    );
  }

  const semanticPlanBasePayload = {
    schemaVersion: "semantic_plan_proposal_v1" as const,
    proposal: structural.proposal,
    referentialIntegrity: structural.referentialIntegrity,
    validation,
    sourceEnvelopeTopologyArtifactVersion,
    skippedNewerInvalidVersions,
    model: OPENAI_MODEL,
    durationMs,
    attempt,
    usage: aiResult.usage,
  };

  if (buildResult.outcome === "BLOCKED") {
    const blockedReasons: readonly ApprovedPlanBlockingReason[] = buildResult.blockingReasons;

    const { data: semanticPlanRow, error: semanticPlanError } = await supabase
      .from("analysis_artifacts")
      .insert({
        job_id: jobId,
        user_id: userId,
        stage: "semantic_plan",
        version: attempt,
        payload: {
          ...semanticPlanBasePayload,
          buildOutcome: "BLOCKED",
          blockingReasons: blockedReasons,
          status: "blocked",
        },
      })
      .select("id")
      .single();

    if (semanticPlanError || !semanticPlanRow) {
      await failJob("failed to persist blocked semantic_plan artifact");
      return jsonResponse(
        { error: "internal_error", detail: "failed to persist blocked semantic_plan artifact", jobId },
        500,
      );
    }

    await supabase
      .from("analysis_jobs")
      .update({
        status: "stage_complete",
        current_stage: "canonical_topology",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return jsonResponse({
      jobId,
      artifactId: (semanticPlanRow as { id: string }).id,
      status: "blocked",
      blockedReasons: blockedReasons.map((r) => `${r.key}: ${r.details}`),
      sourceEnvelopeTopologyArtifactVersion,
      skippedNewerInvalidVersions,
      durationMs,
      attempt,
    });
  }

  // --- BUILT: construct canonical topology ONCE. constructCanonicalTopology
  // embeds validateCandidate internally (see construct.ts) — its result is
  // inspected below (POLICY 2), never recomputed. -----------------------

  const plan: ApprovedPlan = buildResult.plan;

  let candidate: CanonicalTopologyCandidate;
  try {
    candidate = constructCanonicalTopology(raw, plan, `${jobId}-canonical-${attempt}`);
  } catch (err) {
    // Reserved for an impossible programmer/contract state (e.g.
    // SINGLE_CANONICAL_EDGE_OWNER) — per Part D's own documented contract,
    // never silently swallowed, never reinterpreted as BLOCKED.
    await failJob(`constructCanonicalTopology threw on a BUILT plan: ${String(err)}`);
    return jsonResponse(
      {
        error: "internal_error",
        detail: `constructCanonicalTopology threw on a BUILT plan: ${String(err)}`,
        jobId,
      },
      500,
    );
  }

  // --- POLICY 2: inspect the embedded validationResults; ANY failing entry
  // is TECHNICAL_FAILURE, never SEMANTIC_BLOCKED, never persisted. ----------

  const failingRules: ValidationResult[] = candidate.validationResults.filter((r) => !r.passed);
  if (failingRules.length > 0) {
    // FIX 4 (code-audit correction): canonical_topology must NEVER be
    // written here (locked, unchanged). The ORIGINAL invariant-failure
    // diagnostic below is what failJob/the HTTP response report,
    // unconditionally. Before that, a best-effort semantic_plan diagnostic
    // row is attempted — purely to aid production debugging of what should
    // be an impossible state — containing rule names/details only, NEVER
    // `candidate` or any canonical vertex/edge/gap/coordinate data. Its own
    // success or failure is deliberately never inspected: it must not
    // replace, shadow, or delay the original TECHNICAL_FAILURE reason.
    const detail =
      `canonical topology candidate failed ${failingRules.length} internal validation rule(s) ` +
      `after a BUILT plan: ${failingRules.map((r) => `${r.rule} (${r.details})`).join("; ")}`;

    try {
      await supabase.from("analysis_artifacts").insert({
        job_id: jobId,
        user_id: userId,
        stage: "semantic_plan",
        version: attempt,
        payload: {
          ...semanticPlanBasePayload,
          buildOutcome: "BUILT",
          blockingReasons: [],
          status: "technical_failure",
          canonicalConstructionFailure: {
            reason:
              "constructCanonicalTopology succeeded but candidate.validationResults contained one or more failing entries",
            failingRules: failingRules.map((r) => ({ rule: r.rule, details: r.details })),
          },
        },
      });
    } catch {
      // Swallowed deliberately (best-effort, per locked FIX 4) — see
      // comment above. Falls through to the original failJob/detail below
      // regardless of whether this diagnostic write landed.
    }

    await failJob(detail);
    return jsonResponse({ error: "internal_error", detail, jobId }, 500);
  }

  // --- SUCCESS: persist semantic_plan (diagnostic) then canonical_topology
  // (authoritative). Neither is written unless both gates above passed. ----

  const { data: semanticPlanRow, error: semanticPlanError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "semantic_plan",
      version: attempt,
      payload: {
        ...semanticPlanBasePayload,
        buildOutcome: "BUILT",
        blockingReasons: [],
        status: "success",
      },
    })
    .select("id")
    .single();

  if (semanticPlanError || !semanticPlanRow) {
    await failJob("failed to persist semantic_plan artifact");
    return jsonResponse(
      { error: "internal_error", detail: "failed to persist semantic_plan artifact", jobId },
      500,
    );
  }

  const { data: canonicalTopologyRow, error: canonicalTopologyError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "canonical_topology",
      version: attempt,
      payload: {
        schemaVersion: "canonical_topology_v1",
        candidate,
        validationResults: candidate.validationResults,
        sourceEnvelopeTopologyArtifactVersion,
        status: "success",
        model: OPENAI_MODEL,
        durationMs,
        attempt,
      },
    })
    .select("id")
    .single();

  if (canonicalTopologyError || !canonicalTopologyRow) {
    await failJob("failed to persist canonical_topology artifact");
    return jsonResponse(
      { error: "internal_error", detail: "failed to persist canonical_topology artifact", jobId },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "stage_complete",
      current_stage: "canonical_topology",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return jsonResponse({
    jobId,
    semanticPlanArtifactId: (semanticPlanRow as { id: string }).id,
    canonicalTopologyArtifactId: (canonicalTopologyRow as { id: string }).id,
    status: "success",
    candidateState: candidate.candidateState,
    sourceEnvelopeTopologyArtifactVersion,
    skippedNewerInvalidVersions,
    durationMs,
    attempt,
  });
});
