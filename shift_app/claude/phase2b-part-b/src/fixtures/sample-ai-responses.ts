import { WitnessPerceptionResponse } from "../types/witness-perception";

// Fixture measurements loosely modeled on the real runtime sample already
// audited for this project (job 98861ede...): top_m1 (1669->16.69m,
// horizontal, lineStartPct/lineEndPct populated), left_m19 (1099->10.99m,
// vertical, populated), and m18 (an area measurement with
// lineStartPct/lineEndPct=null — used for the "skipped" case).
export const KNOWN_MEASUREMENT_IDS = new Set(["top_m1", "left_m19", "m18"]);

// A plausible, well-formed AI response: one confident-ish proposal
// (top_m1, PROJECTED_INFERRED — never EXTENSION_LINE_INTERSECTION_VERIFIED
// asserted with unwarranted certainty, per the prompt's own guidance),
// one genuinely ambiguous proposal (left_m19, two candidate anchors, no
// suggestedAnchor), and one skipped measurement (m18, an area reading).
export const SAMPLE_VALID_RESPONSE: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [{ kind: "VERTEX", canonicalVertexId: "v1" }],
        suggestedAnchor: { kind: "VERTEX", canonicalVertexId: "v1" },
        proposedProofRelationType: "EXTENSION_LINE_PROJECTION_INFERRED",
        imageGeometryEvidence: {
          sourceDimensionLineEndpoint: "lineStartPct",
          projectionAxis: "horizontal",
          visualRelationDescription:
            "קצה שמאל של קו המידה מיושר אנכית מעל פינת v1 של המעטפת, אך אין מגע ישיר נראה לעין.",
        },
        evidenceRefs: ["top_m1"],
        proposalConfidence: "medium",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [{ kind: "VERTEX", canonicalVertexId: "v2" }],
        suggestedAnchor: { kind: "VERTEX", canonicalVertexId: "v2" },
        proposedProofRelationType: "EXTENSION_LINE_PROJECTION_INFERRED",
        imageGeometryEvidence: {
          sourceDimensionLineEndpoint: "lineEndPct",
          projectionAxis: "horizontal",
          visualRelationDescription:
            "קצה ימין של קו המידה מיושר אנכית מעל פינת v2.",
        },
        evidenceRefs: ["top_m1"],
        proposalConfidence: "medium",
        notes: "",
      },
    },
    {
      measurementId: "left_m19",
      startEndpointProposal: {
        // Genuine ambiguity: two visually-plausible candidates, no
        // suggestedAnchor — this is a VALID, desired shape, not an error.
        candidateAnchors: [
          { kind: "VERTEX", canonicalVertexId: "v5" },
          { kind: "EDGE_POINT", canonicalEdgeId: "canon-e5", paramT: 0.05 },
        ],
        suggestedAnchor: null,
        proposedProofRelationType: "OTHER_SPATIAL_INFERENCE",
        imageGeometryEvidence: null,
        evidenceRefs: ["left_m19"],
        proposalConfidence: "low",
        notes: "לא ברור אם הקו מתייחס לפינה עצמה או לנקודה על הקיר ליד הפינה.",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "הקצה התחתון של קו המידה יוצא מחוץ לתמונה החתוכה, אין מספיק מידע.",
      },
    },
  ],
  skipped: [{ measurementId: "m18", reason: "מידת שטח (area) - לא רלוונטי כ-distance witness למעטפת." }],
};

// Malformed variants, each isolating exactly one sanitation failure mode.

export const RESPONSE_WITH_UNKNOWN_MEASUREMENT_ID: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "does_not_exist",
      startEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_RAW_ONLY_VERTEX: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        // v4 is confirmed RAW-only (Phase 1C-B's e3/e4 are both REJECT) —
        // never a real CanonicalVertex. Must be rejected.
        candidateAnchors: [{ kind: "VERTEX", canonicalVertexId: "v4" }],
        suggestedAnchor: { kind: "VERTEX", canonicalVertexId: "v4" },
        proposedProofRelationType: "OTHER_SPATIAL_INFERENCE",
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_REJECTED_EDGE: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        // e3 is REJECT_NOT_ENVELOPE in Phase 1B/1C — never a CanonicalEdge.
        candidateAnchors: [{ kind: "EDGE_POINT", canonicalEdgeId: "canon-e3", paramT: 0.5 }],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_GAP_AS_ANCHOR: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        // gap-op-06 is a real CanonicalGap id, but gaps are never valid
        // VERTEX/EDGE_POINT anchor targets — proposing it as if it were a
        // vertex id must be rejected the same way any nonexistent vertex
        // id would be.
        candidateAnchors: [{ kind: "VERTEX", canonicalVertexId: "gap-op-06" }],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_PARAM_T_NEGATIVE: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [{ kind: "EDGE_POINT", canonicalEdgeId: "canon-e2", paramT: -0.1 }],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_PARAM_T_ABOVE_ONE: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [{ kind: "EDGE_POINT", canonicalEdgeId: "canon-e2", paramT: 1.2 }],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_SUGGESTED_NOT_IN_CANDIDATES: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [{ kind: "VERTEX", canonicalVertexId: "v1" }],
        // v2 was never proposed as a candidate for THIS endpoint — even
        // though v2 is a real canonical vertex, it cannot be "suggested"
        // here without appearing in candidateAnchors first.
        suggestedAnchor: { kind: "VERTEX", canonicalVertexId: "v2" },
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_EMPTY_CANDIDATES_AND_NULL_SUGGESTED: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "אין מספיק מידע חזותי.",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "אין מספיק מידע חזותי.",
      },
    },
  ],
  skipped: [],
};

export const RESPONSE_WITH_DUPLICATE_MEASUREMENT_ID: WitnessPerceptionResponse = {
  candidates: [
    {
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
    {
      // Same measurementId returned twice — must be flagged, second copy
      // rejected (or both, per implementation — see the dedicated test).
      measurementId: "top_m1",
      startEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
      endEndpointProposal: {
        candidateAnchors: [],
        suggestedAnchor: null,
        proposedProofRelationType: null,
        imageGeometryEvidence: null,
        evidenceRefs: [],
        proposalConfidence: "low",
        notes: "",
      },
    },
  ],
  skipped: [],
};
