// supabase/functions/_shared/resolved_page_dimensions_v3.ts
//
// Session 23 follow-up #8 (Yaron's architecture decision after tracing the
// data flow with Claude): two completely disconnected pipelines were both
// deciding "the building's overall dimensions" --
//
//   OLD: image -> analyze-sketch-v2-measurements (AI decides chains itself)
//        -> axis_extent_resolver.ts -> analyze-sketch-v2-envelope
//
//   NEW: image+strips -> analyze-sketch-v2-page-dimensions (raw evidence
//        only) -> dimension_chain_builder_v3.ts (code builds chains)
//        -> dimension_extent_grouping_v3.ts (code corroborates/conflicts)
//        -> dimension_chain_resolver_v3.ts (resolveAuthoritativeExtentV3)
//        -> analyze-sketch-v2-envelope
//
// Everything upstream of this file (session 23's whole chain of
// follow-ups) already produces a correct ResolvedExtentV3 per axis. This
// file does NOT recompute anything -- it is a pure, thin adapter that
// reshapes the two ResolvedExtentV3 objects (already computed once in
// analyze-sketch-v2-page-dimensions/index.ts and stored in its artifact
// payload) into the canonical contract Stage 1 (envelope) actually reads.
//
// Why a separate canonical type instead of Stage 1 reading ResolvedExtentV3
// directly: ResolvedExtentV3's status vocabulary ("resolved" | "conflict" |
// "missing" | "unresolved") is PageDimensions' own internal detail (the
// difference between "missing" and "unresolved" is about *why* nothing
// converted, not something Stage 1's hard gate needs to distinguish -- it
// only needs to know "do I have a trustworthy number or not"). Collapsing
// that into "resolved" | "conflict" | "insufficient" here keeps Stage 1's
// gate condition simple and keeps PageDimensions free to add more nuance
// to its own internal status later without Stage 1 having to change.
//
// evidenceIds below are the resolved extent's sourceChainIds (chain ids,
// not raw measurement ids) -- the most specific provenance already
// available on ResolvedExtentV3 without extra plumbing.

import type { Confidence } from "./dimension_evidence_schema_v3.ts";
import type { ResolvedExtentV3 } from "./dimension_chain_resolver_v3.ts";

export type ResolvedAxisStatus = "resolved" | "conflict" | "insufficient";

export interface ResolvedPageDimensionsAxis {
  status: ResolvedAxisStatus;
  extentM: number | null;
  confidence: Confidence;
  evidenceIds: string[];
  extentGroupId: string | null;
}

export interface ResolvedPageDimensions {
  horizontal: ResolvedPageDimensionsAxis;
  vertical: ResolvedPageDimensionsAxis;
}

function toAxisStatus(status: ResolvedExtentV3["status"]): ResolvedAxisStatus {
  if (status === "resolved") return "resolved";
  if (status === "conflict") return "conflict";
  // "missing" (no chain even reached overall-candidate coverage) and
  // "unresolved" (reached it but couldn't convert to meters) both mean
  // the same thing to Stage 1: no trustworthy number to build from.
  return "insufficient";
}

function findExtentGroupId(extent: ResolvedExtentV3): string | null {
  if (extent.status !== "resolved" || extent.sourceChainIds.length === 0) return null;
  const sorted = [...extent.sourceChainIds].sort();
  const match = extent.extentGroups.find((g) => {
    if (g.memberChainIds.length !== sorted.length) return false;
    const gSorted = [...g.memberChainIds].sort();
    return gSorted.every((id, i) => id === sorted[i]);
  });
  return match ? match.groupId : null;
}

function toAxis(extent: ResolvedExtentV3): ResolvedPageDimensionsAxis {
  return {
    status: toAxisStatus(extent.status),
    extentM: extent.status === "resolved" ? extent.valueM : null,
    confidence: extent.confidence,
    evidenceIds: extent.sourceChainIds,
    extentGroupId: findExtentGroupId(extent),
  };
}

/**
 * Pure adapter: reshapes the two already-computed ResolvedExtentV3 results
 * (one per axis) into the canonical contract Stage 1 reads. Never
 * recomputes anything, never touches raw measurements or chains directly.
 */
export function toResolvedPageDimensions(
  horizontalExtent: ResolvedExtentV3,
  verticalExtent: ResolvedExtentV3,
): ResolvedPageDimensions {
  return {
    horizontal: toAxis(horizontalExtent),
    vertical: toAxis(verticalExtent),
  };
}

/**
 * Stage 1's hard gate, per Yaron's explicit condition: both axes must be
 * resolved with a non-null extent. A conflict or insufficient axis blocks
 * the same way -- Stage 1 never distinguishes further, and never calls
 * OpenAI's envelope model, builds a fallback guess, or re-resolves
 * dimensions itself when this returns true.
 */
export function shouldBlockStage1FromPageDimensions(resolved: ResolvedPageDimensions): boolean {
  return !(
    resolved.horizontal.status === "resolved" &&
    resolved.vertical.status === "resolved" &&
    resolved.horizontal.extentM != null &&
    resolved.vertical.extentM != null
  );
}

