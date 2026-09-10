// supabase/functions/_shared/floor_plan_schema_v2.ts
//
// Schema v2 — a NEW, PARALLEL type/schema definition. Not wired into any
// Edge Function yet. v1 (floor_plan_schema.ts, used today by the live
// analyze-sketch v15) is completely UNCHANGED and untouched by this file.
// v2 exists so the new staged pipeline (session 20, "Scope + Crop" first,
// per Yaron + ChatGPT-reviewed plan) has a geometry representation to grow
// into stage by stage, without risking the production v1/v15 path at all.
//
// What changed vs v1, and why (ChatGPT's reviewed critique, session 20 —
// see project docs claude/49-51 for the full discussion):
//
//   1. Room.origin/widthM/lengthM (implies a bounding rectangle) -> Room.polygon
//      (an ordered vertex loop, any shape). An L-shaped room, a diagonal wall,
//      a niche are all just more vertices, not a special case requiring a
//      different field. v1 already computed room area from wall graph
//      traversal (not width*length), so this isn't a correctness fix to an
//      existing bug so much as removing a redundant, misleading field that a
//      non-rectangular room can't meaningfully fill in.
//
//   2. Walls used to live duplicated inside each room's own `walls` array —
//      nothing guaranteed two neighbouring rooms describing a shared wall
//      would agree on its coordinates (e.g. room A's wall (0,0)-(5,0) vs.
//      room B's "same" wall (0,0)-(4.97,0.02) — both individually valid
//      JSON, but two different walls in the actual building). v2 makes Wall
//      a global, top-level array, each with its own `id`. Room references
//      its walls by `wallIds: string[]` — one wall, one source of truth.
//      Critical for a consistent 3D reconstruction later.
//
//   3. Several fields were `number` (required, non-nullable) in a strict:true
//      JSON schema even when a real sketch may simply not show that
//      measurement (wall thickness/height, a stair landing's size). A
//      strict non-nullable number forces the model to invent a value it
//      does not have. v2 makes every field that can genuinely be "not shown
//      in this drawing" nullable instead — null is an honest answer, not a
//      failure, matching the project's existing "honesty over invented
//      confidence" rule (v1's stairs.steps already does this; v2 extends
//      the same principle to wall/room dimensions).
//
//   4. Room/building area is never asked of the model in v2 at all — no
//      totalAreaSqm field, model or otherwise. Area is only ever computed
//      in code from polygon/wall coordinates (Shoelace formula, the same
//      approach v14/v15 already use for their cross-check). The model's job
//      is perception (what shape is this), not arithmetic.
//
// openings/stairs/specialElements keep the same shape/detection intent as
// v1 for now — this round only touches geometry representation, not
// opening/stair/special-element detection logic (explicitly out of scope
// per Yaron's instructions for this step).
//
// Nothing in this file is consumed by Stage 0 ("scope") — Stage 0 only
// needs DrawingScope/DRAWING_SCOPE_JSON_SCHEMA, which it imports read-only
// from the existing ../_shared/floor_plan_schema.ts (v1 file, unchanged).
// This file is written now as its own reviewable artifact, ahead of the
// later stages (envelope/rooms/walls/openings/stairs) that will actually
// produce/consume FloorPlanAnalysisV2.

export interface Point2D {
  x: number;
  y: number;
}

// Placeholder for now — a single fixed convention (meters; axes per the
// existing prompts' "longest exterior side = x" rule). Kept as its own
// type so a later stage can extend it (e.g. an explicit origin corner /
// winding-direction convention) without another schema-shape change.
export interface CoordinateSystem {
  units: "meters";
}

export interface WallOpening {
  id: string;
  type: "door" | "window";
  distanceFromStart: number | null; // null if position genuinely not measurable
  width: number | null;
  height: number | null;
  sillHeight: number | null;
}

// v2: a wall is a first-class, globally-identified object — never
// duplicated inside a room. Rooms reference walls by id (Room.wallIds).
export interface Wall {
  id: string;
  start: Point2D;
  end: Point2D;
  thicknessM: number | null; // null if not shown/measurable in the drawing
  heightM: number | null;
  openings: WallOpening[];
}

export type Confidence = "high" | "medium" | "low";

// v2: a room is its own polygon (ordered vertex loop), not a bounding
// rectangle — any shape is just more vertices, not a special case.
export interface Room {
  id: string;
  roomType: string; // "unknown" allowed and expected when unclear
  labelHe: string; // "" allowed when no legible label exists
  roomConfidence: Confidence;
  polygon: Point2D[];
  heightM: number | null;
  floorMaterial: string | null;
  wallIds: string[]; // references into FloorPlanAnalysisV2.walls — not an embedded copy
}

// Unchanged in spirit from v1 — the outer boundary of the building as its
// own polygon, walked in order. null when the model genuinely cannot trace
// a continuous outer boundary (an honest "I don't know", not a guess).
export interface BuildingEnvelope {
  vertices: Point2D[];
}

export interface StairsSteps {
  count: number | null;
  treadDepthM: number | null;
  riserHeightM: number | null;
}

export interface StairsLanding {
  position: Point2D;
  widthM: number | null; // v2: nullable (v1 required this even when unreadable)
  depthM: number | null; // v2: nullable
}

export interface Stairs {
  id: string;
  type: "straight" | "l_shaped" | "u_shaped" | "spiral" | "unknown";
  position: Point2D;
  directionDeg: number | null;
  widthM: number | null;
  steps: StairsSteps;
  landings: StairsLanding[];
  confidence: Confidence;
}

export interface SpecialElement {
  id: string;
  description: string;
  approxLocation: Point2D;
  confidence: Confidence;
}

// v2 top-level shape. Note what's absent compared to v1's FloorPlanAnalysis:
// no totalAreaSqm anywhere — area is never a model output in v2, only ever
// computed in code from polygon/wall coordinates after the fact.
export interface FloorPlanAnalysisV2 {
  coordinateSystem: CoordinateSystem;
  buildingEnvelope: BuildingEnvelope | null;
  walls: Wall[]; // global, top-level — the single source of truth for every wall
  rooms: Room[];
  stairs: Stairs[];
  specialElements: SpecialElement[];
  confidence: Confidence;
  notes: string;
}

// --- JSON Schema (for a future strict:true response_format, once a later
// stage actually produces FloorPlanAnalysisV2 — NOT used by Stage 0 or by
// anything else yet). Mirrors the style/conventions of the v1 schema file.

const POINT2D_SCHEMA_V2 = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const COORDINATE_SYSTEM_SCHEMA_V2 = {
  type: "object",
  properties: {
    units: { type: "string", enum: ["meters"] },
  },
  required: ["units"],
  additionalProperties: false,
} as const;

const WALL_OPENING_SCHEMA_V2 = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["door", "window"] },
    distanceFromStart: { type: ["number", "null"] },
    width: { type: ["number", "null"] },
    height: { type: ["number", "null"] },
    sillHeight: { type: ["number", "null"] },
  },
  required: ["id", "type", "distanceFromStart", "width", "height", "sillHeight"],
  additionalProperties: false,
} as const;

const WALL_SCHEMA_V2 = {
  type: "object",
  properties: {
    id: { type: "string" },
    start: POINT2D_SCHEMA_V2,
    end: POINT2D_SCHEMA_V2,
    thicknessM: { type: ["number", "null"] },
    heightM: { type: ["number", "null"] },
    openings: { type: "array", items: WALL_OPENING_SCHEMA_V2 },
  },
  required: ["id", "start", "end", "thicknessM", "heightM", "openings"],
  additionalProperties: false,
} as const;

const CONFIDENCE_SCHEMA_V2 = {
  type: "string",
  enum: ["high", "medium", "low"],
} as const;

const ROOM_SCHEMA_V2 = {
  type: "object",
  properties: {
    id: { type: "string" },
    roomType: { type: "string" },
    labelHe: { type: "string" },
    roomConfidence: CONFIDENCE_SCHEMA_V2,
    polygon: { type: "array", items: POINT2D_SCHEMA_V2 },
    heightM: { type: ["number", "null"] },
    floorMaterial: { type: ["string", "null"] },
    wallIds: { type: "array", items: { type: "string" } },
  },
  required: [
    "id",
    "roomType",
    "labelHe",
    "roomConfidence",
    "polygon",
    "heightM",
    "floorMaterial",
    "wallIds",
  ],
  additionalProperties: false,
} as const;

const BUILDING_ENVELOPE_SCHEMA_V2 = {
  type: "object",
  properties: {
    vertices: { type: "array", items: POINT2D_SCHEMA_V2 },
  },
  required: ["vertices"],
  additionalProperties: false,
} as const;

const STAIRS_STEPS_SCHEMA_V2 = {
  type: "object",
  properties: {
    count: { type: ["number", "null"] },
    treadDepthM: { type: ["number", "null"] },
    riserHeightM: { type: ["number", "null"] },
  },
  required: ["count", "treadDepthM", "riserHeightM"],
  additionalProperties: false,
} as const;

const STAIRS_LANDING_SCHEMA_V2 = {
  type: "object",
  properties: {
    position: POINT2D_SCHEMA_V2,
    widthM: { type: ["number", "null"] },
    depthM: { type: ["number", "null"] },
  },
  required: ["position", "widthM", "depthM"],
  additionalProperties: false,
} as const;

const STAIRS_SCHEMA_V2 = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: ["straight", "l_shaped", "u_shaped", "spiral", "unknown"],
    },
    position: POINT2D_SCHEMA_V2,
    directionDeg: { type: ["number", "null"] },
    widthM: { type: ["number", "null"] },
    steps: STAIRS_STEPS_SCHEMA_V2,
    landings: { type: "array", items: STAIRS_LANDING_SCHEMA_V2 },
    confidence: CONFIDENCE_SCHEMA_V2,
  },
  required: [
    "id",
    "type",
    "position",
    "directionDeg",
    "widthM",
    "steps",
    "landings",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SPECIAL_ELEMENT_SCHEMA_V2 = {
  type: "object",
  properties: {
    id: { type: "string" },
    description: { type: "string" },
    approxLocation: POINT2D_SCHEMA_V2,
    confidence: CONFIDENCE_SCHEMA_V2,
  },
  required: ["id", "description", "approxLocation", "confidence"],
  additionalProperties: false,
} as const;

export const FLOOR_PLAN_JSON_SCHEMA_V2 = {
  type: "object",
  properties: {
    coordinateSystem: COORDINATE_SYSTEM_SCHEMA_V2,
    buildingEnvelope: { anyOf: [BUILDING_ENVELOPE_SCHEMA_V2, { type: "null" }] },
    walls: { type: "array", items: WALL_SCHEMA_V2 },
    rooms: { type: "array", items: ROOM_SCHEMA_V2 },
    stairs: { type: "array", items: STAIRS_SCHEMA_V2 },
    specialElements: { type: "array", items: SPECIAL_ELEMENT_SCHEMA_V2 },
    confidence: CONFIDENCE_SCHEMA_V2,
    notes: { type: "string" },
  },
  required: [
    "coordinateSystem",
    "buildingEnvelope",
    "walls",
    "rooms",
    "stairs",
    "specialElements",
    "confidence",
    "notes",
  ],
  additionalProperties: false,
} as const;
