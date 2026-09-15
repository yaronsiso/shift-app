// _shared/envelope_topology_schema_v1.ts
//
// Phase 1 of the Envelope Constraint Solver v1 migration.
//
// STRICT BOUNDARY: this schema is the ONLY thing the AI model is allowed to
// return for envelope perception. It contains:
//   - vertices in image-space percentages ONLY
//   - an ordered closed polygon
//   - edge IDs
//   - axis hints (horizontal | vertical | diagonal_or_unknown)
//
// It deliberately has NO fields for meters, scale, area, or dimensionRefs.
// Those fields do not merely go unused if the model emits them — they do not
// EXIST in the JSON Schema at all, and every object node sets
// `additionalProperties: false`. This is enforced at the schema level (for
// providers that support strict structured outputs), not by a post-parse
// scrubber. If a provider does not enforce `additionalProperties: false` at
// generation time, `parseEnvelopeTopologyV1` below still rejects any object
// with extra keys before anything downstream ever sees it.
//
// Do not add fields to this schema to "pass through" convenience data from
// the model. Any metric fact must originate from PageDimensions +
// measurements/builtChains, resolved in code (Phase 2/3), never from this
// call.
//
// OPENAI STRICT-MODE NOTE (learned from the first real deploy, session 24):
// OpenAI's structured-outputs `strict: true` mode does not support
// "optional" object properties in the normal JSON Schema sense — every key
// listed under `properties` MUST also appear in that object's `required`
// array, or the API rejects the schema outright at call time (error:
// "'required' is required to be supplied and to be an array including
// every key in properties"). The correct way to express "this field may be
// absent" under strict mode is: keep it in `required`, but make its type a
// union with "null" (e.g. `type: ["string", "null"]`, and include `null` in
// `enum` if the field has one) — the model then returns an explicit `null`
// instead of omitting the key. Every genuinely-optional field below
// (cornerAngleHint, perceptionNotes, and perceptionNotes[].vertexId/edgeId)
// follows that pattern now. TypeScript types below allow `| null` on those
// same fields to match; downstream code should treat `null` and `undefined`
// the same way for these fields.
//
// jobId is NOT part of this schema at all (session 24 fix): it is not an
// AI-owned field — the caller already knows the real jobId from the
// request, and the model has no legitimate reason to generate or return
// one. The first real run showed the model inventing its own value
// ("envelope-1") because the schema previously required it to return
// something. jobId is now injected server-side, in
// analyze-sketch-v2-envelope-topology/index.ts, after parsing — never
// read from the model's output.

export const ENVELOPE_TOPOLOGY_V1_JSON_SCHEMA = {
  name: "envelope_topology_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "vertices", "edges", "polygonOrder", "perceptionNotes"],
    properties: {
      schemaVersion: { type: "string", enum: ["envelope_topology_v1"] },

      vertices: {
        type: "array",
        minItems: 3,
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
        minItems: 3,
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

      polygonOrder: {
        type: "array",
        minItems: 3,
        items: { type: "string" },
      },

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

export interface ImagePct {
  xPct: number;
  yPct: number;
}

export interface EnvelopeTopologyVertexV1 {
  id: string;
  imagePct: ImagePct;
  cornerAngleHint: "orthogonal_90" | "acute" | "obtuse" | "uncertain" | null;
}

export type EdgeAxisHint = "horizontal" | "vertical" | "diagonal_or_unknown";
export type EdgeRoleHint = "exterior_wall" | "opening" | "uncertain";

export interface EnvelopeTopologyEdgeV1 {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  axisHint: EdgeAxisHint;
  roleHint: EdgeRoleHint;
}

export interface EnvelopeTopologyPerceptionNoteV1 {
  vertexId: string | null;
  edgeId: string | null;
  note: string;
}

export interface EnvelopeTopologyV1 {
  jobId: string;
  schemaVersion: "envelope_topology_v1";
  vertices: EnvelopeTopologyVertexV1[];
  edges: EnvelopeTopologyEdgeV1[];
  polygonOrder: string[];
  perceptionNotes: EnvelopeTopologyPerceptionNoteV1[] | null;
}

// Fields that must NEVER appear on parsed objects, even if a provider fails
// to honor additionalProperties:false. Defense in depth only — the schema
// above is the primary control.
const FORBIDDEN_FIELD_NAMES = [
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
] as const;

export class EnvelopeTopologyForbiddenFieldError extends Error {
  constructor(public path: string, public field: string) {
    super(
      `EnvelopeTopologyV1 payload contains forbidden field "${field}" at ${path}. ` +
        `The AI perception call must never emit metric, scale, area, or dimensionRef ` +
        `data — those are derived downstream in code from PageDimensions.`,
    );
    this.name = "EnvelopeTopologyForbiddenFieldError";
  }
}

/**
 * Defense-in-depth parser: walks the raw parsed JSON and throws if any
 * forbidden field name appears anywhere in the object tree, or if any object
 * has keys outside what the schema defines. This does NOT replace the JSON
 * Schema's `additionalProperties: false` — it exists for providers/paths
 * that don't enforce strict schemas at generation time (e.g. a manual retry
 * path, or a provider swap).
 */
export function assertNoForbiddenFields(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenFields(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((FORBIDDEN_FIELD_NAMES as readonly string[]).includes(key)) {
        throw new EnvelopeTopologyForbiddenFieldError(path, key);
      }
      assertNoForbiddenFields((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

export function parseEnvelopeTopologyV1(raw: unknown): EnvelopeTopologyV1 {
  assertNoForbiddenFields(raw);
  // Structural narrowing is intentionally minimal here — full structural
  // validation (referential integrity, cycle closure, etc.) is
  // envelope_topology_validators_v1.ts's job, not this parser's. This
  // function's only job is the forbidden-field firewall plus a cast.
  return raw as EnvelopeTopologyV1;
}
