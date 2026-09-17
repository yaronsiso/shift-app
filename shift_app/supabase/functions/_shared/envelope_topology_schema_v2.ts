// _shared/envelope_topology_schema_v2.ts
//
// EnvelopeTopologyV2 — successor contract to EnvelopeTopologyV1, designed
// specifically to fix V1's structural mismatch with what Phase1C actually
// needs to consume (see V1's real-world failure: a richer, honest 26-edge
// perception rejected outright because it wasn't a single closed polygon).
//
// V2's responsibility: the AI returns OBSERVED IMAGE-SPACE TOPOLOGY
// EVIDENCE — not a canonical, closed polygon. The graph itself
// (vertices + edges) IS the evidence. A missing edge stays missing. Nothing
// here ever synthesizes closure to satisfy a schema.
//
// LOCKED DECISIONS (do not relitigate without a new, explicit instruction):
//   - NO `polygonOrder` field. Not optional, not nullable, not reinterpreted
//     as an open traversal. It is not in this schema at all, and it is
//     additionally listed in FORBIDDEN_FIELD_NAMES below as defense in
//     depth against a provider echoing it back anyway.
//   - `axisHint` is retained but is explicitly NON-AUTHORITATIVE — an
//     axis-hint/geometry mismatch is a diagnostic in the V2 validator, never
//     fatal. See envelope_topology_validators_v2.ts.
//   - No explicit component/polyline/gap objects. Disconnected structure is
//     represented naturally by the plain edge list. Gap/opening-
//     continuation/source-occlusion/deferred-issue semantics stay Phase1C's
//     job and never move upstream into this contract.
//   - Semantic ambiguity is allowed (extra candidate edges, disconnected
//     edges/components, open chains, uncertain hints). Structural
//     corruption is NEVER an acceptable way to express ambiguity — see
//     envelope_topology_validators_v2.ts for the fatal/diagnostic split.
//
// This file intentionally does NOT import anything from
// envelope_topology_schema_v1.ts. V1 stays frozen forever; V2 is a fully
// separate, additive contract so V1 never has to change, and so a future
// edit to either file can never silently affect the other.
//
// Same OpenAI strict-mode conventions as V1 (see that file's header,
// verified unchanged at HEAD 3b83f10):
//   - Every key under `properties` must also appear in `required` — strict
//     mode does not support "optional" properties in the normal JSON Schema
//     sense.
//   - Genuine optionality is expressed as `type: [X, "null"]` (with `null`
//     also added to `enum` where applicable), never by omitting the key
//     from `required`.
//   - Every object sets `additionalProperties: false`.
//   - `jobId` is not part of this schema, for the same reason as V1: it is
//     not an AI-owned field. It must be injected server-side, after
//     parsing, exactly as analyze-sketch-v2-envelope-topology/index.ts
//     already does for V1.

export const ENVELOPE_TOPOLOGY_V2_JSON_SCHEMA = {
  name: "envelope_topology_v2",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "vertices", "edges", "perceptionNotes"],
    properties: {
      schemaVersion: { type: "string", enum: ["envelope_topology_v2"] },

      vertices: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "imagePct", "cornerAngleHint"],
          properties: {
            id: { type: "string" },
            imagePct: {
              type: "object",
              additionalProperties: false,
              required: ["xPct", "yPct"],
              properties: {
                xPct: { type: "number" },
                yPct: { type: "number" },
              },
            },
            cornerAngleHint: {
              type: ["string", "null"],
              enum: ["orthogonal_90", "acute", "obtuse", "uncertain", null],
            },
          },
        },
      },

      edges: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "fromVertexId", "toVertexId", "axisHint", "roleHint"],
          properties: {
            id: { type: "string" },
            fromVertexId: { type: "string" },
            toVertexId: { type: "string" },
            axisHint: {
              type: "string",
              enum: ["horizontal", "vertical", "diagonal_or_unknown"],
            },
            roleHint: {
              type: "string",
              enum: ["exterior_wall", "opening", "uncertain"],
            },
          },
        },
      },

      // No polygonOrder. This is the entire point of V2 — see file header.

      perceptionNotes: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["vertexId", "edgeId", "note"],
          properties: {
            vertexId: { type: ["string", "null"] },
            edgeId: { type: ["string", "null"] },
            note: { type: "string" },
          },
        },
      },
    },
  },
} as const;

// ---- TypeScript types mirroring the schema exactly -------------------

export interface ImagePctV2 {
  xPct: number;
  yPct: number;
}

export interface EnvelopeTopologyVertexV2 {
  id: string;
  imagePct: ImagePctV2;
  cornerAngleHint: "orthogonal_90" | "acute" | "obtuse" | "uncertain" | null;
}

export type EdgeAxisHintV2 = "horizontal" | "vertical" | "diagonal_or_unknown";
export type EdgeRoleHintV2 = "exterior_wall" | "opening" | "uncertain";

export interface EnvelopeTopologyEdgeV2 {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  axisHint: EdgeAxisHintV2;
  roleHint: EdgeRoleHintV2;
}

export interface EnvelopeTopologyPerceptionNoteV2 {
  vertexId: string | null;
  edgeId: string | null;
  note: string;
}

export interface EnvelopeTopologyV2 {
  schemaVersion: "envelope_topology_v2";
  vertices: EnvelopeTopologyVertexV2[];
  edges: EnvelopeTopologyEdgeV2[];
  perceptionNotes: EnvelopeTopologyPerceptionNoteV2[] | null;
}

// Fields that must NEVER appear on parsed objects, even if a provider fails
// to honor additionalProperties:false. Defense in depth only — the schema
// above is the primary control. Same list as V1's, PLUS "polygonOrder"
// itself: V2's whole point is that no closed-polygon traversal is ever
// required or accepted, so a provider echoing polygonOrder back (e.g. via
// prompt leakage from V1 examples) must be rejected outright, not silently
// ignored.
const FORBIDDEN_FIELD_NAMES_V2 = [
  "meters",
  "lengthMeters",
  "scale",
  "metersPerPct",
  "area",
  "areaMeters",
  "dimensionRefs",
  "paramT",
  "world",
  "x",
  "z",
  "polygonOrder",
] as const;

export class EnvelopeTopologyV2ForbiddenFieldError extends Error {
  constructor(public path: string, public field: string) {
    super(
      `EnvelopeTopologyV2 payload contains forbidden field "${field}" at ${path}. ` +
        `The AI perception call must never emit metric, scale, area, dimensionRef, ` +
        `or polygonOrder data — polygonOrder was V1's closed-polygon requirement and ` +
        `is explicitly not part of V2; metric facts are derived downstream in code ` +
        `from PageDimensions.`,
    );
    this.name = "EnvelopeTopologyV2ForbiddenFieldError";
  }
}

/**
 * Defense-in-depth parser: walks the raw parsed JSON and throws if any
 * forbidden field name appears anywhere in the object tree, or if any object
 * has keys outside what the schema defines. This does NOT replace the JSON
 * Schema's `additionalProperties: false` — it exists for providers/paths
 * that don't enforce strict schemas at generation time. Mirrors
 * envelope_topology_schema_v1.ts's assertNoForbiddenFields exactly, kept as
 * an independent copy rather than a shared import so V1 and V2 never share
 * a code path that could couple their behavior.
 */
export function assertNoForbiddenFieldsV2(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenFieldsV2(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((FORBIDDEN_FIELD_NAMES_V2 as readonly string[]).includes(key)) {
        throw new EnvelopeTopologyV2ForbiddenFieldError(path, key);
      }
      assertNoForbiddenFieldsV2((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

export function parseEnvelopeTopologyV2(raw: unknown): EnvelopeTopologyV2 {
  assertNoForbiddenFieldsV2(raw);
  // Structural narrowing is intentionally minimal here, exactly like V1's
  // parser — full structural validation (referential integrity, degenerate
  // edges, etc.) is envelope_topology_validators_v2.ts's job, not this
  // parser's. This function's only job is the forbidden-field firewall plus
  // a cast.
  return raw as EnvelopeTopologyV2;
}
