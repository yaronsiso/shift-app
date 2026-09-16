import test from "node:test";
import assert from "node:assert/strict";
import { tryConstructTopologySpan } from "../span";
import { buildMeasurementWitnessBinding } from "../binding";
import { EndpointResolution, TopologyAnchor } from "../types/model";

const anchorA: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
const anchorB: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v10" };

function resolvedEndpoint(
  anchor: TopologyAnchor,
  confidence: EndpointResolution["endpointConfidence"]
): EndpointResolution {
  return {
    selectedAnchor: anchor,
    selectedProofStrength: confidence,
    endpointConfidence: confidence,
    ambiguityReason: null,
  };
}

function unresolvedEndpoint(): EndpointResolution {
  return {
    selectedAnchor: null,
    selectedProofStrength: "NONE",
    endpointConfidence: "NONE",
    ambiguityReason: null,
  };
}

// ---- TopologySpan only from two bound endpoints ----------------------------
test("BOUND binding produces a TopologySpan", () => {
  const binding = buildMeasurementWitnessBinding(
    resolvedEndpoint(anchorA, "MEDIUM"),
    resolvedEndpoint(anchorB, "HIGH")
  );
  const span = tryConstructTopologySpan(binding);
  assert.notEqual(span, null);
  assert.deepEqual(span!.fromAnchor, anchorA);
  assert.deepEqual(span!.toAnchor, anchorB);
  assert.equal(span!.bindingConfidence, "MEDIUM"); // MIN(MEDIUM, HIGH)
});

test("UNBOUND binding produces no TopologySpan", () => {
  const binding = buildMeasurementWitnessBinding(
    unresolvedEndpoint(),
    unresolvedEndpoint()
  );
  assert.equal(tryConstructTopologySpan(binding), null);
});

test("PARTIALLY_BOUND binding produces no TopologySpan", () => {
  const binding = buildMeasurementWitnessBinding(
    resolvedEndpoint(anchorA, "MEDIUM"),
    unresolvedEndpoint()
  );
  assert.equal(tryConstructTopologySpan(binding), null);
});

test("AMBIGUOUS binding produces no TopologySpan", () => {
  const ambiguous: EndpointResolution = {
    selectedAnchor: null,
    selectedProofStrength: "NONE",
    endpointConfidence: "NONE",
    ambiguityReason: "AMBIGUOUS_COMPETING_CANDIDATES",
  };
  const binding = buildMeasurementWitnessBinding(
    ambiguous,
    resolvedEndpoint(anchorB, "HIGH")
  );
  assert.equal(tryConstructTopologySpan(binding), null);
});
