// supabase/functions/_shared/floor_plan_schema.ts
//
// Contract between the sketch-analysis AI step and our future 3D engine.
// v2 — adds per-room confidence and tightens the "don't invent rooms" rule
// after real-sketch testing (session 17, follow-up).

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

export interface FloorPlanAnalysis {
  units: "meters";
  totalAreaSqm: number;
  rooms: Room[];
  confidence: Confidence;
  notes: string;
}

const POINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["x", "y"],
};

const OPENING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["door", "window"] },
    distanceFromStart: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    sillHeight: { type: "number" },
  },
  required: ["type", "distanceFromStart", "width", "height", "sillHeight"],
};

const WALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    start: POINT_SCHEMA,
    end: POINT_SCHEMA,
    thicknessM: { type: "number" },
    heightM: { type: "number" },
    openings: { type: "array", items: OPENING_SCHEMA },
  },
  required: ["start", "end", "thicknessM", "heightM", "openings"],
};

const ROOM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    roomType: {
      type: "string",
      description:
        "Room function. Use the literal value 'unknown' if there is no explicit Hebrew text label AND no unambiguous fixture (toilet bowl, shower stall, bed) drawn in this space. Furniture like a table and chairs does NOT by itself imply kitchen/living-room/dining — never guess a typical house layout without direct evidence in the drawing.",
    },
    labelHe: {
      type: "string",
      description:
        "The exact Hebrew text label written inside or right next to this room in the sketch, verbatim. Empty string '' if no legible room-name label exists — never invent one.",
    },
    roomConfidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Confidence that this is a real, separately walled-off room — not a fixture, a furniture note, or a room fabricated just to fill floor area. 'low' if you are not sure this should be its own room at all.",
    },
    origin: POINT_SCHEMA,
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
};

export const FLOOR_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    units: { type: "string", enum: ["meters"] },
    totalAreaSqm: { type: "number" },
    rooms: { type: "array", items: ROOM_SCHEMA },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["units", "totalAreaSqm", "rooms", "confidence", "notes"],
};
