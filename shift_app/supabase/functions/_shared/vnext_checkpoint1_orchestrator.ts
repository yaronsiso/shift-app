// supabase/functions/_shared/vnext_checkpoint1_orchestrator.ts
//
// Pure orchestration logic for SHIFT VNext Checkpoint 1: fires the
// Geometry and Evidence calls in TRUE PARALLEL (Promise.all over two
// already-started promises — see runParallelObservations below) and
// records per-call and total wall-clock timing.
//
// Deliberately extracted out of the Deno Edge Function handler and kept
// free of any Deno-specific API (fetch/env/serve) so the parallelism
// behavior itself — the thing the spec explicitly asks to be tested,
// "parallel orchestration behavior where testable" — can be exercised
// under plain Node with mocked async callables, without needing a Deno
// runtime, network access, or real OpenAI credentials. The real Edge
// Function (analyze-sketch-vnext-checkpoint1/index.ts) supplies real
// fetch-backed callables to this same function; this file has no idea
// whether it's being called for real or under test.
import { safeErrorVNext, type SafeErrorVNext } from "./vnext_safe_errors.ts";
//
// TRUE PARALLEL, not "sequential but labeled parallel": both callables
// are INVOKED with the same explicit signed URL argument,
// starting their own promises) BEFORE either is awaited. This file's own
// test (validate_vnext_orchestration_test.mjs) proves this with a shared
// start-order recorder, not just by reading the code.

export interface ObservationCallResult<T> {
  ok: true;
  parsed: T;
  usage: Record<string, unknown>;
}

export interface ObservationCallFailure {
  ok: false;
  detail: SafeErrorVNext;
}

export type ObservationCallOutcome<T> = ObservationCallResult<T> | ObservationCallFailure;

export interface ParallelObservationsResult<G, E> {
  geometry: ObservationCallOutcome<G>;
  evidence: ObservationCallOutcome<E>;
  geometryDurationMs: number;
  evidenceDurationMs: number;
  // Wall-clock time for BOTH calls together. For true concurrent
  // execution this should be close to max(geometryDurationMs,
  // evidenceDurationMs), never their sum — the stability/timing report
  // downstream surfaces this raw, unjudged, so a regression to
  // accidental sequential execution is visible in the numbers themselves
  // rather than hidden behind a "parallel: true" label.
  totalWallClockMs: number;
}

/**
 * Runs `callGeometry` and `callEvidence` concurrently with `signedUrl`.
 * Both are invoked
 * synchronously (in the same tick, before either Promise is awaited) so
 * their underlying work genuinely overlaps rather than running one after
 * the other. Never rejects: a failure in either call is captured as
 * `{ok: false, detail}` in that call's own outcome so the other call's
 * result (and its timing) is never lost to an unrelated failure.
 */
export async function runParallelObservations<G, E>(
  signedUrl: string,
  callGeometry: (signedUrl: string) => Promise<ObservationCallOutcome<G>>,
  callEvidence: (signedUrl: string) => Promise<ObservationCallOutcome<E>>,
  now: () => number = () => Date.now(),
): Promise<ParallelObservationsResult<G, E>> {
  const wallClockStart = now();

  let geometryDurationMs = 0;
  let evidenceDurationMs = 0;

  const geometryPromise = (async () => {
    const start = now();
    try {
      const result = await callGeometry(signedUrl);
      geometryDurationMs = now() - start;
      return result;
    } catch {
      geometryDurationMs = now() - start;
      return { ok: false as const, detail: safeErrorVNext({ category: "orchestration", code: "geometry_call_threw", stage: "geometry", message: "Geometry call failed", status: null, requestId: null }) };
    }
  })();

  const evidencePromise = (async () => {
    const start = now();
    try {
      const result = await callEvidence(signedUrl);
      evidenceDurationMs = now() - start;
      return result;
    } catch {
      evidenceDurationMs = now() - start;
      return { ok: false as const, detail: safeErrorVNext({ category: "orchestration", code: "evidence_call_threw", stage: "evidence", message: "Evidence call failed", status: null, requestId: null }) };
    }
  })();

  // Both promises above are already running by this point (JS functions
  // execute synchronously up to their first await when called) — this
  // Promise.all is purely for collecting both results, not for starting
  // them "at the same time" as a side effect of being listed together.
  const [geometry, evidence] = await Promise.all([geometryPromise, evidencePromise]);

  const totalWallClockMs = now() - wallClockStart;

  return { geometry, evidence, geometryDurationMs, evidenceDurationMs, totalWallClockMs };
}
