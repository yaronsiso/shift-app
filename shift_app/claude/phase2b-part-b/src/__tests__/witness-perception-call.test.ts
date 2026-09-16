import test from "node:test";
import assert from "node:assert/strict";
import { buildWitnessPerceptionRequest } from "../witness-perception-call";
import { WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA } from "../witness-perception-schema";
import { attempt3Canonical } from "../fixtures/attempt3-canonical";

test("buildWitnessPerceptionRequest includes the cropped image URL and system prompt", () => {
  const request = buildWitnessPerceptionRequest({
    canonicalTopology: attempt3Canonical,
    measurements: [
      {
        id: "top_m1",
        rawText: "1669",
        axis: "horizontal",
        bboxPct: { xMinPct: 50, yMinPct: -7, xMaxPct: 54, yMaxPct: -6 },
        lineStartPct: { xPct: 6.14, yPct: -6.7 },
        lineEndPct: { xPct: 96.86, yPct: -6.7 },
        referenceTypeHint: "building",
      },
    ],
    croppedImageUrl: "https://example.test/signed-url",
  });

  assert.equal(request.schemaName, "witness_perception_v1");
  const userMessage = request.messages[1] as { content: unknown[] };
  const imageBlock = userMessage.content.find(
    (b: any) => b.type === "image_url"
  ) as { image_url: { url: string } };
  assert.equal(imageBlock.image_url.url, "https://example.test/signed-url");
});

test("buildWitnessPerceptionRequest does not invent extra OpenAI calls (single request shape only)", () => {
  const request = buildWitnessPerceptionRequest({
    canonicalTopology: attempt3Canonical,
    measurements: [],
    croppedImageUrl: "https://example.test/signed-url",
  });
  // Exactly system + user, no assistant turns, no retry scaffolding.
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[0]!.role, "system");
  assert.equal(request.messages[1]!.role, "user");
});

// ---- schema-level forbidden-field guarantee --------------------------------
test("the JSON Schema has strict:true and additionalProperties:false at every object level", () => {
  const schema = WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA;
  assert.equal(schema.strict, true);
  assert.equal(schema.schema.additionalProperties, false);

  const candidateSchema = (schema.schema.properties.candidates as any).items;
  assert.equal(candidateSchema.additionalProperties, false);

  const startProposalSchema = candidateSchema.properties.startEndpointProposal;
  assert.equal(startProposalSchema.additionalProperties, false);

  const anchorSchema = startProposalSchema.properties.candidateAnchors.items;
  assert.equal(anchorSchema.additionalProperties, false);
});

test("no forbidden authority-layer property name appears anywhere in the JSON Schema tree", () => {
  const forbidden = [
    "selectedAnchor",
    "proofStatus",
    "proofStrength",
    "endpointConfidence",
    "bindingStatus",
    "bindingConfidence",
    "TopologySpan",
    "promotionEligible",
    "promotionStatus",
    "PromotedConstraintCandidate",
    "ConstraintEquation",
    "distanceM",
    "worldCoordinate",
  ];
  const serialized = JSON.stringify(WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA);
  for (const field of forbidden) {
    assert.equal(serialized.includes(field), false, `schema must not mention "${field}"`);
  }
});

// ---- vertex coordinates are included in the request ------------------------
test("vertex coordinates (xPct/yPct) are included in the user message text sent to the AI", () => {
  const request = buildWitnessPerceptionRequest({
    canonicalTopology: attempt3Canonical,
    measurements: [],
    croppedImageUrl: "https://example.test/signed-url",
  });
  const userMessage = request.messages[1] as { content: unknown[] };
  const textBlock = userMessage.content.find((b: any) => b.type === "text") as { text: string };
  // v2's real canonical coordinate, verbatim from the actual Phase 1C-B
  // snapshot (coordinate: {x: 83.4, y: 20.3}) — not a placeholder, not
  // recomputed. If this specific value appears, the real coordinate made
  // it into the prompt text unmodified.
  const v2 = attempt3Canonical.vertices.find((v) => v.canonicalVertexId === "v2")!;
  assert.ok(v2.coordinate.x === 83.4 && v2.coordinate.y === 20.3);
  assert.ok(
    textBlock.text.includes("VERTEX v2") && textBlock.text.includes("xPct=83.4") && textBlock.text.includes("yPct=20.3"),
    "prompt text must include v2's real xPct/yPct coordinate"
  );
});

// ---- Attempt3 canonical coordinates remain unchanged ------------------------
test("Attempt3 canonical vertex coordinates match the real Phase 1C-B snapshot exactly, unmodified", () => {
  // Spot-check several real coordinates straight from
  // attempt3-actual-candidate.json (the unmodified runtime snapshot) —
  // proves the fixture loader did not recompute, round, or otherwise alter
  // any coordinate value while adding the new field.
  const byId = new Map(attempt3Canonical.vertices.map((v) => [v.canonicalVertexId, v.coordinate]));
  assert.deepEqual(byId.get("v2"), { x: 83.4, y: 20.3 });
  assert.deepEqual(byId.get("v1"), { x: 35, y: 20.3 });
  assert.deepEqual(byId.get("v13"), { x: 50.6, y: 92.7 });
});

// ---- edge references remain canonical only ----------------------------------
test("edge descriptions reference only canonical fromVertexId/toVertexId, no invented edge-level geometry", () => {
  const request = buildWitnessPerceptionRequest({
    canonicalTopology: attempt3Canonical,
    measurements: [],
    croppedImageUrl: "https://example.test/signed-url",
  });
  const userMessage = request.messages[1] as { content: unknown[] };
  const textBlock = userMessage.content.find((b: any) => b.type === "text") as { text: string };
  // e2's real canonical endpoints (v2 -> v3), and no separate coordinate
  // pair invented for the edge itself (no "EDGE e2: xPct=" anywhere).
  assert.ok(textBlock.text.includes("EDGE canon-e2 (v2 -> v3)"));
  assert.equal(/EDGE canon-e2:\s*xPct=/.test(textBlock.text), false);
});

// ---- gaps/deferred issues are never sent as anchor targets ------------------
test("gaps and deferred issues never appear in the canonical-topology description sent to the AI", () => {
  const request = buildWitnessPerceptionRequest({
    canonicalTopology: attempt3Canonical,
    measurements: [],
    croppedImageUrl: "https://example.test/signed-url",
  });
  const userMessage = request.messages[1] as { content: unknown[] };
  const textBlock = userMessage.content.find((b: any) => b.type === "text") as { text: string };
  // Real gap/deferred-issue ids from the actual snapshot must never appear
  // as if they were vertex/edge anchor targets.
  assert.equal(textBlock.text.includes("gap-op-06"), false);
  assert.equal(textBlock.text.includes("gap-op-07"), false);
  assert.equal(textBlock.text.includes("deferred-op-02"), false);
  assert.equal(textBlock.text.includes("deferred-op-05"), false);
  assert.equal(textBlock.text.includes("deferred-op-08"), false);
});
