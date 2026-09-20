// supabase/functions/_shared/geometry_observation_schema_vnext.ts
//
// SHIFT VNext Checkpoint 1 — Pass A (Geometry Observation) schema.
import {
  assertMatchesCheckpointSchemaVNext,
  assertSafeIdVNext,
} from "./vnext_runtime_schema_validator.ts";
//
// LOCKED DECISIONS (per SHIFT VNext Checkpoint 1 authorization — do not
// relitigate without a new, explicit instruction):
//   - IMAGE-SPACE OBSERVATIONS ONLY. No authoritative metric coordinate,
//     length, area, or scale field exists anywhere in this schema. See
//     FORBIDDEN_FIELD_NAMES_GEOMETRY_VNEXT below for defense-in-depth.
//   - This is a WIDENED version of envelope_topology_schema_v2.ts's
//     vertex/edge primitive: V2 only asked for the exterior envelope.
//     Here, `roleHint` distinguishes exterior_wall / interior_wall /
//     opening / uncertain on the SAME global vertex/edge graph, so a
//     shared corner between an exterior and an interior wall is one
//     vertex, not two independently-perceived ones.
//   - roomRegions reference vertex ids that already exist in `vertices`
//     (boundaryVertexIds) rather than carrying their own duplicated
//     polygon coordinates — same "one source of truth per coordinate"
//     principle as floor_plan_schema_v2.ts's global Wall[] (see that
//     file's header for the original rationale: two independently-typed
//     copies of "the same" wall/boundary can silently disagree).
//   - Room-region LABEL TEXT belongs exclusively to
//     evidence_observation_schema_vnext.ts's textLabels. This schema only
//     exposes `nearestLabelHint`, an image-space POINTER (not text) to
//     where a label appears to be — the actual OCR text and the final
//     region<->label association are downstream concerns (Evidence pass
//     + a deterministic point-in-polygon match later), never this
//     schema's job.
//   - `axisHint`, `roleHint`, `typeHint`, `swingHint`,
//     `onEdgeIdHint`/`positionAlongEdgePctHint`, `cornerAngleHint` are all
//     explicitly NON-AUTHORITATIVE hints — the model may propose them, but
//     nothing here treats them as proof. Downstream deterministic logic
//     (not yet built — out of scope for Checkpoint 1) owns the real
//     decision.
//   - No dimension/measurement field of any kind exists in this schema —
//     that is entirely evidence_observation_schema_vnext.ts's job. This
//     pass never reads written numbers.
//   - `null`/absence is always a valid, honest answer. Nothing here forces
//     closure of a partial graph, invents a hidden wall, or fabricates an
//     entity that was not actually observed.
//
// Same OpenAI strict-mode conventions as envelope_topology_schema_v2.ts:
//   - Every key under `properties` also appears in `required`.
//   - Genuine optionality is `type: [X, "null"]` (with `null` also added to
//     `enum` where applicable), never omission from `required`.
//   - Every object sets `additionalProperties: false`.
//   - `jobId` is not part of this schema — injected server-side after
//     parsing, same convention as every other stage in this project.

export interface ImagePctVNext {
  xPct: number;
  yPct: number;
}

const IMAGE_PCT_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["xPct", "yPct"],
  properties: {
    xPct: { type: "number", minimum: -2, maximum: 102 },
    yPct: { type: "number", minimum: -2, maximum: 102 },
  },
} as const;

export type CornerAngleHintVNext = "orthogonal_90" | "acute" | "obtuse" | "uncertain" | null;
export type EdgeAxisHintVNext = "horizontal" | "vertical" | "diagonal_or_unknown";
export type EdgeRoleHintVNext = "exterior_wall" | "interior_wall" | "opening" | "uncertain";
export type OpeningTypeHintVNext = "door" | "window" | "uncertain";
export type OpeningSwingHintVNext = "in_left" | "in_right" | "out_left" | "out_right" | "uncertain" | null;
export type StairsTypeHintVNext = "straight" | "l_shaped" | "u_shaped" | "spiral" | "uncertain";
export type StairsContextHintVNext = "interior" | "exterior" | "uncertain";
export type ExteriorFeatureTypeHintVNext =
  | "balcony"
  | "terrace"
  | "paving"
  | "pergola"
  | "canopy"
  | "uncertain";
export type ExteriorBoundaryCompletenessHintVNext = "complete_visible" | "partial_visible" | "unknown";
export type ExteriorEnclosureHintVNext = "enclosed" | "non_enclosed" | "partially_enclosed" | "unknown";
export type RoomRegionRoleHintVNext = "room" | "uncertain";
export type GeometryEvidenceStateVNext = "OBSERVED" | "INFERRED" | "UNKNOWN";

const EVIDENCE_STATE_SCHEMA_VNEXT = {
  type: "string",
  enum: ["OBSERVED", "INFERRED", "UNKNOWN"],
} as const;

export interface GeometryVertexVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  imagePct: ImagePctVNext;
  cornerAngleHint: CornerAngleHintVNext;
}

export interface GeometryEdgeVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  fromVertexId: string;
  toVertexId: string;
  axisHint: EdgeAxisHintVNext;
  roleHint: EdgeRoleHintVNext;
  // Observable wall-FACE geometry only (never a measured thickness — that
  // is Evidence pass's job if a thickness annotation exists at all): does
  // the drawing show this wall as a double line (two roughly-parallel
  // strokes) or a single line? "uncertain" covers ambiguous/unclear cases.
  // This is purely a perception hint about *drawing convention*, feeding
  // a future deterministic thickness-handling decision — not itself a
  // thickness value.
  drawingConventionHint: "single_line" | "double_line" | "uncertain";
}

export interface RoomRegionVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  // References into the SAME `vertices` array above, walked in order
  // around the region's boundary. Never a duplicated coordinate list.
  boundaryVertexIds: string[];
  // A POINTER to where a label appears to sit near this region — never the
  // label text itself. See file header.
  nearestLabelHint: ImagePctVNext | null;
  roleHint: RoomRegionRoleHintVNext;
}

export interface OpeningVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  typeHint: OpeningTypeHintVNext;
  // A HINT at which edge this opening sits on — never proof. A dangling
  // or absent value is expected and non-fatal; a deterministic match
  // against the edge graph is a downstream concern.
  onEdgeIdHint: string | null;
  // 0-100, hint only: roughly how far along the hinted edge (from its
  // fromVertexId) the opening sits.
  positionAlongEdgePctHint: number | null;
  swingHint: OpeningSwingHintVNext;
  anchorImagePct: ImagePctVNext;
}

export interface StairsVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  typeHint: StairsTypeHintVNext;
  contextHint: StairsContextHintVNext;
  anchorImagePct: ImagePctVNext;
  // Degrees, image-space, hint only — direction the flight appears to run.
  directionHint: number | null;
}

export interface ExteriorFeatureVNext {
  id: string;
  evidenceState: GeometryEvidenceStateVNext;
  typeHint: ExteriorFeatureTypeHintVNext;
  // Each nested path is a visible-only sequence of existing wall-graph
  // vertices. Separate fragments stay separate and no path is implicitly
  // connected or closed. A visible closure repeats the first id at the end.
  wallBoundaryVertexPaths: string[][];
  // Independent visible-only exterior-feature polylines that are NOT wall
  // geometry. No missing segment or closing segment is implied.
  visibleBoundaryPathsImagePct: ImagePctVNext[][];
  // Representative visible point only; never proof of boundary or extent.
  anchorImagePct: ImagePctVNext | null;
  boundaryCompletenessHint: ExteriorBoundaryCompletenessHintVNext;
  enclosureHint: ExteriorEnclosureHintVNext;
}

export interface GeometryPerceptionNoteVNext {
  evidenceState: GeometryEvidenceStateVNext;
  vertexId: string | null;
  edgeId: string | null;
  regionId: string | null;
  note: string;
}

export interface GeometryObservationVNext {
  schemaVersion: "geometry_observation_vnext_v1";
  vertices: GeometryVertexVNext[];
  edges: GeometryEdgeVNext[];
  roomRegions: RoomRegionVNext[];
  openings: OpeningVNext[];
  stairs: StairsVNext[];
  exteriorFeatures: ExteriorFeatureVNext[];
  perceptionNotes: GeometryPerceptionNoteVNext[] | null;
}

// ---- JSON Schema (OpenAI strict:true response_format) ---------------------

const VERTEX_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "evidenceState", "imagePct", "cornerAngleHint"],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    imagePct: IMAGE_PCT_SCHEMA_VNEXT,
    cornerAngleHint: {
      type: ["string", "null"],
      enum: ["orthogonal_90", "acute", "obtuse", "uncertain", null],
    },
  },
} as const;

const EDGE_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "evidenceState", "fromVertexId", "toVertexId", "axisHint", "roleHint", "drawingConventionHint"],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    fromVertexId: { type: "string" },
    toVertexId: { type: "string" },
    axisHint: { type: "string", enum: ["horizontal", "vertical", "diagonal_or_unknown"] },
    roleHint: { type: "string", enum: ["exterior_wall", "interior_wall", "opening", "uncertain"] },
    drawingConventionHint: { type: "string", enum: ["single_line", "double_line", "uncertain"] },
  },
} as const;

const ROOM_REGION_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "evidenceState", "boundaryVertexIds", "nearestLabelHint", "roleHint"],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    boundaryVertexIds: { type: "array", items: { type: "string" } },
    nearestLabelHint: { anyOf: [IMAGE_PCT_SCHEMA_VNEXT, { type: "null" }] },
    roleHint: { type: "string", enum: ["room", "uncertain"] },
  },
} as const;

const OPENING_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "evidenceState", "typeHint", "onEdgeIdHint", "positionAlongEdgePctHint", "swingHint", "anchorImagePct"],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    typeHint: { type: "string", enum: ["door", "window", "uncertain"] },
    onEdgeIdHint: { type: ["string", "null"] },
    positionAlongEdgePctHint: { type: ["number", "null"], minimum: 0, maximum: 100 },
    swingHint: {
      type: ["string", "null"],
      enum: ["in_left", "in_right", "out_left", "out_right", "uncertain", null],
    },
    anchorImagePct: IMAGE_PCT_SCHEMA_VNEXT,
  },
} as const;

const STAIRS_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "evidenceState", "typeHint", "contextHint", "anchorImagePct", "directionHint"],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    typeHint: { type: "string", enum: ["straight", "l_shaped", "u_shaped", "spiral", "uncertain"] },
    contextHint: { type: "string", enum: ["interior", "exterior", "uncertain"] },
    anchorImagePct: IMAGE_PCT_SCHEMA_VNEXT,
    directionHint: { type: ["number", "null"], minimum: 0, exclusiveMaximum: 360 },
  },
} as const;

const EXTERIOR_FEATURE_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "evidenceState",
    "typeHint",
    "wallBoundaryVertexPaths",
    "visibleBoundaryPathsImagePct",
    "anchorImagePct",
    "boundaryCompletenessHint",
    "enclosureHint",
  ],
  properties: {
    id: { type: "string" },
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    typeHint: {
      type: "string",
      enum: ["balcony", "terrace", "paving", "pergola", "canopy", "uncertain"],
    },
    wallBoundaryVertexPaths: {
      type: "array",
      items: { type: "array", minItems: 2, items: { type: "string" } },
    },
    visibleBoundaryPathsImagePct: {
      type: "array",
      items: { type: "array", minItems: 2, items: IMAGE_PCT_SCHEMA_VNEXT },
    },
    anchorImagePct: { anyOf: [IMAGE_PCT_SCHEMA_VNEXT, { type: "null" }] },
    boundaryCompletenessHint: {
      type: "string",
      enum: ["complete_visible", "partial_visible", "unknown"],
    },
    enclosureHint: {
      type: "string",
      enum: ["enclosed", "non_enclosed", "partially_enclosed", "unknown"],
    },
  },
} as const;

const PERCEPTION_NOTE_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["evidenceState", "vertexId", "edgeId", "regionId", "note"],
  properties: {
    evidenceState: EVIDENCE_STATE_SCHEMA_VNEXT,
    vertexId: { type: ["string", "null"] },
    edgeId: { type: ["string", "null"] },
    regionId: { type: ["string", "null"] },
    note: { type: "string" },
  },
} as const;

export const GEOMETRY_OBSERVATION_VNEXT_JSON_SCHEMA = {
  name: "geometry_observation_vnext_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "vertices",
      "edges",
      "roomRegions",
      "openings",
      "stairs",
      "exteriorFeatures",
      "perceptionNotes",
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["geometry_observation_vnext_v1"] },
      vertices: { type: "array", items: VERTEX_SCHEMA_VNEXT },
      edges: { type: "array", items: EDGE_SCHEMA_VNEXT },
      roomRegions: { type: "array", items: ROOM_REGION_SCHEMA_VNEXT },
      openings: { type: "array", items: OPENING_SCHEMA_VNEXT },
      stairs: { type: "array", items: STAIRS_SCHEMA_VNEXT },
      exteriorFeatures: { type: "array", items: EXTERIOR_FEATURE_SCHEMA_VNEXT },
      perceptionNotes: { type: ["array", "null"], items: PERCEPTION_NOTE_SCHEMA_VNEXT },
    },
  },
} as const;

// ---- Forbidden-field defense-in-depth --------------------------------------
//
// Same pattern as envelope_topology_schema_v2.ts's
// assertNoForbiddenFieldsV2 / EnvelopeTopologyV2ForbiddenFieldError: the
// JSON Schema's additionalProperties:false is the primary control; this is
// an independent walk of the raw parsed tree so a provider that doesn't
// honor strict mode faithfully still cannot smuggle metric/scale/area data
// into this artifact.

export const FORBIDDEN_FIELD_NAMES_GEOMETRY_VNEXT = [
  "meters",
  "lengthMeters",
  "widthM",
  "heightM",
  "thicknessM",
  "scale",
  "metersPerPct",
  "area",
  "areaMeters",
  "areaSqm",
  "totalAreaSqm",
  "dimensionRefs",
  "valueM",
  "rawText",
  "isOverall",
  "overall",
  "classification",
  "polygonOrder",
  "world",
  "x",
  "z",
] as const;

export class GeometryObservationVNextForbiddenFieldError extends Error {
  constructor(public path: string, public field: string) {
    super(
      `GeometryObservationVNext payload contains forbidden field "${field}" at ${path}. ` +
        `Pass A (geometry) must never emit metric/scale/area data, and must never emit ` +
        `raw dimension text ("rawText") — that belongs exclusively to Pass B (evidence).`,
    );
    this.name = "GeometryObservationVNextForbiddenFieldError";
  }
}

export function assertNoForbiddenFieldsGeometryVNext(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenFieldsGeometryVNext(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((FORBIDDEN_FIELD_NAMES_GEOMETRY_VNEXT as readonly string[]).includes(key)) {
        throw new GeometryObservationVNextForbiddenFieldError(path, key);
      }
      assertNoForbiddenFieldsGeometryVNext((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

export function parseGeometryObservationVNext(raw: unknown): GeometryObservationVNext {
  assertNoForbiddenFieldsGeometryVNext(raw);
  assertMatchesCheckpointSchemaVNext(raw, GEOMETRY_OBSERVATION_VNEXT_JSON_SCHEMA.schema, "geometry");
  const observation = raw as GeometryObservationVNext;
  const entityGroups = [
    ["vertices", observation.vertices],
    ["edges", observation.edges],
    ["roomRegions", observation.roomRegions],
    ["openings", observation.openings],
    ["stairs", observation.stairs],
    ["exteriorFeatures", observation.exteriorFeatures],
  ] as const;
  for (const [groupName, entities] of entityGroups) {
    entities.forEach((entity, index) => assertSafeIdVNext(entity.id, "geometry", `$.${groupName}[${index}].id`));
  }
  observation.edges.forEach((edge, index) => {
    assertSafeIdVNext(edge.fromVertexId, "geometry", `$.edges[${index}].fromVertexId`);
    assertSafeIdVNext(edge.toVertexId, "geometry", `$.edges[${index}].toVertexId`);
  });
  observation.roomRegions.forEach((region, index) =>
    region.boundaryVertexIds.forEach((id, idIndex) =>
      assertSafeIdVNext(id, "geometry", `$.roomRegions[${index}].boundaryVertexIds[${idIndex}]`)
    )
  );
  observation.exteriorFeatures.forEach((feature, featureIndex) =>
    feature.wallBoundaryVertexPaths.forEach((path, pathIndex) =>
      path.forEach((id, idIndex) =>
        assertSafeIdVNext(
          id,
          "geometry",
          `$.exteriorFeatures[${featureIndex}].wallBoundaryVertexPaths[${pathIndex}][${idIndex}]`,
        )
      )
    )
  );
  observation.openings.forEach((opening, index) => {
    if (opening.onEdgeIdHint !== null) assertSafeIdVNext(opening.onEdgeIdHint, "geometry", `$.openings[${index}].onEdgeIdHint`);
  });
  (observation.perceptionNotes ?? []).forEach((note, index) => {
    if (note.vertexId !== null) assertSafeIdVNext(note.vertexId, "geometry", `$.perceptionNotes[${index}].vertexId`);
    if (note.edgeId !== null) assertSafeIdVNext(note.edgeId, "geometry", `$.perceptionNotes[${index}].edgeId`);
    if (note.regionId !== null) assertSafeIdVNext(note.regionId, "geometry", `$.perceptionNotes[${index}].regionId`);
  });
  return observation;
}
