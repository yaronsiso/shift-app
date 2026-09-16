import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveBindingStatus,
  deriveBindingConfidence,
  deriveWitnessType,
  buildMeasurementWitnessBinding,
} from "../binding";
import { EndpointResolution, TopologyAnchor } from "../types/model";

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

function ambiguousEndpoint(): EndpointResolution {
  return {
    selectedAnchor: null,
    selectedProofStrength: "NONE",
    endpointConfidence: "NONE",
    ambiguityReason: "AMBIGUOUS_COMPETING_CANDIDATES",
  };
}

const anchorA: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
const anchorB: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v10" };

// ---- UNBOUND ----------------------------------------------------------------
test("0 resolved endpoints => UNBOUND", () => {
  const status = deriveBindingStatus(unresolvedEndpoint(), unresolvedEndpoint());
  assert.equal(status, "UNBOUND");
});

// ---- PARTIALLY_BOUND (both directions) --------------------------------------
test("start resolved, end null => PARTIALLY_BOUND", () => {
  const status = deriveBindingStatus(
    resolvedEndpoint(anchorA, "MEDIUM"),
    unresolvedEndpoint()
  );
  assert.equal(status, "PARTIALLY_BOUND");
});

test("start null, end resolved => PARTIALLY_BOUND (the previously-buggy direction)", () => {
  const status = deriveBindingStatus(
    unresolvedEndpoint(),
    resolvedEndpoint(anchorB, "MEDIUM")
  );
  assert.equal(status, "PARTIALLY_BOUND");
});

// ---- BOUND -------------------------------------------------------------------
test("both endpoints resolved => BOUND", () => {
  const status = deriveBindingStatus(
    resolvedEndpoint(anchorA, "MEDIUM"),
    resolvedEndpoint(anchorB, "HIGH")
  );
  assert.equal(status, "BOUND");
});

// ---- AMBIGUOUS ----------------------------------------------------------------
test("ambiguity on start => AMBIGUOUS even if end is resolved", () => {
  const status = deriveBindingStatus(
    ambiguousEndpoint(),
    resolvedEndpoint(anchorB, "MEDIUM")
  );
  assert.equal(status, "AMBIGUOUS");
});

test("ambiguity on end => AMBIGUOUS even if start is resolved", () => {
  const status = deriveBindingStatus(
    resolvedEndpoint(anchorA, "MEDIUM"),
    ambiguousEndpoint()
  );
  assert.equal(status, "AMBIGUOUS");
});

// ---- weakest-endpoint binding confidence (MIN) ------------------------------
test("bindingConfidence = MIN(start, end) — LOW beats HIGH", () => {
  const confidence = deriveBindingConfidence(
    resolvedEndpoint(anchorA, "HIGH"),
    resolvedEndpoint(anchorB, "LOW")
  );
  assert.equal(confidence, "LOW");
});

test("bindingConfidence = MIN(start, end) — MEDIUM beats HIGH", () => {
  const confidence = deriveBindingConfidence(
    resolvedEndpoint(anchorA, "MEDIUM"),
    resolvedEndpoint(anchorB, "HIGH")
  );
  assert.equal(confidence, "MEDIUM");
});

test("bindingConfidence = NONE when either endpoint is NONE", () => {
  const confidence = deriveBindingConfidence(
    unresolvedEndpoint(),
    resolvedEndpoint(anchorB, "HIGH")
  );
  assert.equal(confidence, "NONE");
});

// ---- aggregate witnessType cannot raise endpoint confidence -----------------
test("witnessType classification never appears in, or influences, bindingConfidence", () => {
  const start = resolvedEndpoint(anchorA, "LOW");
  const end = resolvedEndpoint(anchorB, "HIGH");
  const binding = buildMeasurementWitnessBinding(start, end);
  // Regardless of what witnessType comes out as, bindingConfidence must
  // remain the strict MIN — LOW — never elevated toward HIGH or MEDIUM.
  // (witnessType itself is OTHER_INFERENCE here since one endpoint is LOW;
  // MIXED is reserved for VERIFIED+PROJECTED combinations — see the
  // dedicated MIXED-classification test below. The point under test is
  // that whatever witnessType is computed, it never feeds back into
  // bindingConfidence.)
  assert.equal(binding.bindingConfidence, "LOW");
  assert.equal(binding.witnessType, "OTHER_INFERENCE");
});

test("MIXED witnessType (one HIGH, one MEDIUM endpoint) still reports strict MIN=MEDIUM confidence", () => {
  const start = resolvedEndpoint(anchorA, "HIGH");
  const end = resolvedEndpoint(anchorB, "MEDIUM");
  const binding = buildMeasurementWitnessBinding(start, end);
  assert.equal(binding.witnessType, "MIXED");
  // Even though one endpoint is HIGH, bindingConfidence must not be
  // elevated above the weaker endpoint's MEDIUM.
  assert.equal(binding.bindingConfidence, "MEDIUM");
});

test("DIRECT_VERIFIED witnessType (both HIGH) still just reports MIN=HIGH, not a bonus", () => {
  const start = resolvedEndpoint(anchorA, "HIGH");
  const end = resolvedEndpoint(anchorB, "HIGH");
  const binding = buildMeasurementWitnessBinding(start, end);
  assert.equal(binding.bindingConfidence, "HIGH");
  assert.equal(binding.witnessType, "DIRECT_VERIFIED");
});
