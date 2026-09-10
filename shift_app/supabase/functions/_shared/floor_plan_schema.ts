// supabase/functions/_shared/floor_plan_schema.ts
//
// v14 — extends the schema (unchanged since v2) that analyze-sketch v3-v13
// used. Session 20 (10.9.2026): a professional multi-room floor plan
// exposed three gaps this schema had no way to represent at all:
//   1. No way to say "the building envelope is not a simple rectangle" as
//      a first-class fact — every test run on a real non-rectangular plan
//      still came back as a set of perfect axis-aligned rectangles. The
//      Wall.start/end fields were already free {x,y} points (nothing
//      forced axis-alignment), so this was a prompting/attention problem,
//      not a schema limitation — but v14 adds an explicit buildingEnvelope
//      polygon so the model has a dedicated place to describe the outer
//      shape *before* carving it into rooms, instead of jumping straight
//      to rectangles room-by-room.
//   2. No representation for a staircase at all — it had nowhere to go
//      except being silently dropped or mis-described as a room/wall.
//   3. No representation for "I see something here but don't know what
//      it is" other than roomType:"unknown" (which still forces it to be
//      a *room*). Detail/cross-section drawings elsewhere on the same
//      sheet, or genuinely unrecognised elements, had no honest home.
//
// v14 also stops trusting the model's own totalAreaSqm as the sole source
// of truth for the building's overall size (three identical-input test
// runs on the same complex plan returned 58.8 / 81.56 / 101.32 sqm - see
// session 20 notes). totalAreaSqm stays in the schema (kept for
// diagnostics/comparison — the validator now checks it against a
// **geometrically computed** area from buildingEnvelope/room polygons,
// and flags a large mismatch as a retry-worthy issue), but the figure the
// app actually uses going forward is computed in index.ts from
// coordinates, not asked of the model.

export interface Point2D {
  x: number;
  y: number;
}

export interface WallOpening {
  type: "door" | "window";
  distanceFromStart: number;
  width: number;
  height: number;
  sillHeight: number;
}

export interface Wall {
  start: Point2D;
  end: Point2D;
  thicknessM: number;
  heightM: number;
  openings: WallOpening[];
}

export type Confidence = "high" | "medium" | "low";

export interface Room {
  id: string;
  roomType: string; // "unknown" allowed and expected when unclear
  labelHe: string; // "" allowed when no legible label exists
  roomConfidence: Confidence;
  origin: Point2D;
  widthM: number;
  lengthM: number;
  heightM: number;
  floorMaterial: string | null;
  walls: Wall[];
}

// v14 — the outer boundary of the building as its own polygon, walked in
// order (each vertex connects to the next, and the last connects back to
// the first). Not required to be a rectangle or even axis-aligned: a
// diagonal corner is just a vertex whose neighbours aren't at 0/90/180/270
// degrees from it. null when the model genuinely cannot trace a continuous
// outer boundary (e.g. too much of the sheet is illegible) - that is an
// honest "I don't know", not something to force a guess on.
export interface BuildingEnvelope {
  vertices: Point2D[];
}

export interface StairsSteps {
  count: number | null; // null, not a guess, if the drawing doesn't show it
  treadDepthM: number | null;
  riserHeightM: number | null;
}

export interface StairsLanding {
  position: Point2D;
  widthM: number;
  depthM: number;
}

// v14 — a staircase is its own object, never folded into rooms/walls.
export interface Stairs {
  id: string;
  type: "straight" | "l_shaped" | "u_shaped" | "spiral" | "unknown";
  position: Point2D; // approximate start point of the flight
  directionDeg: number | null; // null if not confidently determinable
  widthM: number | null;
  steps: StairsSteps;
  landings: StairsLanding[];
  confidence: Confidence;
}

// v14 — anything visible that is clearly not furniture-inside-a-room, not
// a wall, not an opening, and not a staircase, but also isn't confidently
// one specific thing either (a column, a niche, an unlabeled built-in
// element, a detail/cross-section drawing elsewhere on the same sheet).
// Exists so the model has a truthful place to put "I see something here"
// instead of either inventing a room for it or silently dropping it.
export interface SpecialElement {
  id: string;
  description: string; // short free-text description in Hebrew
  approxLocation: Point2D;
  confidence: Confidence;
}

export interface FloorPlanAnalysis {
  units: "meters";
  totalAreaSqm: number; // model's own estimate - kept for diagnostics only, see note above
  buildingEnvelope: BuildingEnvelope | null;
  rooms: Room[];
  stairs: Stairs[];
  specialElements: SpecialElement[];
  confidence: Confidence;
  notes: string;
}

// v14 — Stage 0 ("scope") output: a separate, much smaller schema used
// only for the first pass, which identifies which part of the image is
// the actual floor plan to analyze before any room/wall extraction
// happens. All coordinates are percentages of the full image (0-100), not
// meters - this pass doesn't do any architectural reading at all, just
// answers "where on this sheet is the floor plan, and what should be
// ignored".
export interface BboxPct {
  xMinPct: number;
  yMinPct: number;
  xMaxPct: number;
  yMaxPct: number;
}

export interface ExcludedRegion {
  bboxPct: BboxPct;
  reason: string; // free-text Hebrew, e.g. "פרט חתך של חדר רחצה, לא חלק מתוכנית הקומה"
}

export interface DrawingScope {
  mainFloorPlanBboxPct: BboxPct;
  excludedRegions: ExcludedRegion[];
  scopeConfidence: number; // 0-1
}

const POINT2D_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const WALL_OPENING_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["door", "window"] },
    distanceFromStart: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    sillHeight: { type: "number" },
  },
  required: ["type", "distanceFromStart", "width", "height", "sillHeight"],
  additionalProperties: false,
} as const;

const WALL_SCHEMA = {
  type: "object",
  properties: {
    start: POINT2D_SCHEMA,
    end: POINT2D_SCHEMA,
    thicknessM: { type: "number" },
    heightM: { type: "number" },
    openings: { type: "array", items: WALL_OPENING_SCHEMA },
  },
  required: ["start", "end", "thicknessM", "heightM", "openings"],
  additionalProperties: false,
} as const;

const CONFIDENCE_SCHEMA = {
  type: "string",
  enum: ["high", "medium", "low"],
} as const;

const ROOM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    roomType: { type: "string" },
    labelHe: { type: "string" },
    roomConfidence: CONFIDENCE_SCHEMA,
    origin: POINT2D_SCHEMA,
    widthM: { type: "number" },
    lengthM: { type: "number" },
    heightM: { type: "number" },
    floorMaterial: { type: ["string", "null"] },
    walls: { type: "array", items: WALL_SCHEMA },
  },
  required: [
    "id",
    "roomType",
    "labelHe",
    "roomConfidence",
    "origin",
    "widthM",
    "lengthM",
    "heightM",
    "floorMaterial",
    "walls",
  ],
  additionalProperties: false,
} as const;

const BUILDING_ENVELOPE_SCHEMA = {
  type: "object",
  properties: {
    vertices: { type: "array", items: POINT2D_SCHEMA },
  },
  required: ["vertices"],
  additionalProperties: false,
} as const;

const STAIRS_STEPS_SCHEMA = {
  type: "object",
  properties: {
    count: { type: ["number", "null"] },
    treadDepthM: { type: ["number", "null"] },
    riserHeightM: { type: ["number", "null"] },
  },
  required: ["count", "treadDepthM", "riserHeightM"],
  additionalProperties: false,
} as const;

const STAIRS_LANDING_SCHEMA = {
  type: "object",
  properties: {
    position: POINT2D_SCHEMA,
    widthM: { type: "number" },
    depthM: { type: "number" },
  },
  required: ["position", "widthM", "depthM"],
  additionalProperties: false,
} as const;

const STAIRS_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: ["straight", "l_shaped", "u_shaped", "spiral", "unknown"],
    },
    position: POINT2D_SCHEMA,
    directionDeg: { type: ["number", "null"] },
    widthM: { type: ["number", "null"] },
    steps: STAIRS_STEPS_SCHEMA,
    landings: { type: "array", items: STAIRS_LANDING_SCHEMA },
    confidence: CONFIDENCE_SCHEMA,
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

const SPECIAL_ELEMENT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    description: { type: "string" },
    approxLocation: POINT2D_SCHEMA,
    confidence: CONFIDENCE_SCHEMA,
  },
  required: ["id", "description", "approxLocation", "confidence"],
  additionalProperties: false,
} as const;

export const FLOOR_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    units: { type: "string", enum: ["meters"] },
    totalAreaSqm: { type: "number" },
    buildingEnvelope: {
      anyOf: [BUILDING_ENVELOPE_SCHEMA, { type: "null" }],
    },
    rooms: { type: "array", items: ROOM_SCHEMA },
    stairs: { type: "array", items: STAIRS_SCHEMA },
    specialElements: { type: "array", items: SPECIAL_ELEMENT_SCHEMA },
    confidence: CONFIDENCE_SCHEMA,
    notes: { type: "string" },
  },
  required: [
    "units",
    "totalAreaSqm",
    "buildingEnvelope",
    "rooms",
    "stairs",
    "specialElements",
    "confidence",
    "notes",
  ],
  additionalProperties: false,
} as const;

const BBOX_PCT_SCHEMA = {
  type: "object",
  properties: {
    xMinPct: { type: "number" },
    yMinPct: { type: "number" },
    xMaxPct: { type: "number" },
    yMaxPct: { type: "number" },
  },
  required: ["xMinPct", "yMinPct", "xMaxPct", "yMaxPct"],
  additionalProperties: false,
} as const;

const EXCLUDED_REGION_SCHEMA = {
  type: "object",
  properties: {
    bboxPct: BBOX_PCT_SCHEMA,
    reason: { type: "string" },
  },
  required: ["bboxPct", "reason"],
  additionalProperties: false,
} as const;

export const DRAWING_SCOPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    mainFloorPlanBboxPct: BBOX_PCT_SCHEMA,
    excludedRegions: { type: "array", items: EXCLUDED_REGION_SCHEMA },
    scopeConfidence: { type: "number" },
  },
  required: ["mainFloorPlanBboxPct", "excludedRegions", "scopeConfidence"],
  additionalProperties: false,
} as const;
