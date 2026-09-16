import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAnchorExistsInCanonicalTopology,
  topologyAnchorUnionExcludesGapsAndIssues,
  bindingConfidenceIsMinOfEndpoints,
} from "../invariants";
import { anchorExistsInCanonicalTopology } from "../anchor";
import {
  attempt3Canonical,
} from "../fixtures/attempt3-canonical";
import { TopologyAnchor } from "../types/model";
import {
  canonicalGapExists,
  canonicalDeferredIssueExists,
} from "../types/canonical_topology_v1";

// ---- contextual gap/deferred refs cannot become anchors --------------------
test("a CanonicalGap id is not a valid VERTEX or EDGE_POINT anchor target", () => {
  // The gap exists in the candidate (as a gap, correctly)...
  assert.equal(canonicalGapExists(attempt3Canonical, "gap-op-06"), true);
  // ...but attempting to anchor on it as if it were a vertex must fail: no
  // TopologyAnchor variant can reference a gap id and have it resolve true,
  // because anchorExistsInCanonicalTopology only ever checks vertices/edges.
  const asVertexAnchor: TopologyAnchor = {
    kind: "VERTEX",
    canonicalVertexId: "gap-op-06",
  };
  assert.equal(
    anchorExistsInCanonicalTopology(attempt3Canonical, asVertexAnchor),
    false
  );
});

test("a DeferredIssue id is not a valid VERTEX or EDGE_POINT anchor target", () => {
  assert.equal(
    canonicalDeferredIssueExists(attempt3Canonical, "deferred-op-05"),
    true
  );
  const asVertexAnchor: TopologyAnchor = {
    kind: "VERTEX",
    canonicalVertexId: "deferred-op-05",
  };
  assert.equal(
    anchorExistsInCanonicalTopology(attempt3Canonical, asVertexAnchor),
    false
  );
});

test("TopologyAnchor union type structurally excludes gap/issue kinds", () => {
  const vertexAnchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const edgeAnchor: TopologyAnchor = {
    kind: "EDGE_POINT",
    canonicalEdgeId: "canon-e9",
    paramT: 0.3,
  };
  assert.equal(topologyAnchorUnionExcludesGapsAndIssues(vertexAnchor), true);
  assert.equal(topologyAnchorUnionExcludesGapsAndIssues(edgeAnchor), true);
});

// ---- topology input remains immutable --------------------------------------
test("reading a canonical anchor does not mutate the CanonicalTopologyCandidate", () => {
  const before = JSON.stringify(attempt3Canonical);
  const anchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  checkAnchorExistsInCanonicalTopology(attempt3Canonical, anchor);
  checkAnchorExistsInCanonicalTopology(attempt3Canonical, {
    kind: "VERTEX",
    canonicalVertexId: "v4", // RAW-only, deliberately absent
  });
  const after = JSON.stringify(attempt3Canonical);
  assert.equal(before, after);
});

test("CanonicalTopologyCandidate fixture fields are readonly at the type level (compile-time enforced)", () => {
  // This test's real enforcement is at tsc time (readonly arrays/fields in
  // topology-input.ts) — this assertion just documents intent and confirms
  // the object identity is unchanged after repeated reads within one test run.
  const verticesRef = attempt3Canonical.vertices;
  checkAnchorExistsInCanonicalTopology(attempt3Canonical, {
    kind: "VERTEX",
    canonicalVertexId: "v9",
  });
  assert.equal(attempt3Canonical.vertices, verticesRef);
});

// ---- ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION (invariant-level check) --
test("bindingConfidenceIsMinOfEndpoints invariant check agrees with actual MIN semantics", () => {
  assert.equal(bindingConfidenceIsMinOfEndpoints("HIGH", "LOW", "LOW"), true);
  assert.equal(bindingConfidenceIsMinOfEndpoints("HIGH", "LOW", "HIGH"), false);
  assert.equal(bindingConfidenceIsMinOfEndpoints("MEDIUM", "MEDIUM", "MEDIUM"), true);
  assert.equal(bindingConfidenceIsMinOfEndpoints("NONE", "HIGH", "NONE"), true);
});
