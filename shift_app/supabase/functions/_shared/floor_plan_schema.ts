// supabase/functions/_shared/floor_plan_schema.ts
//
// Contract between the sketch-analysis AI step and our future 3D engine.
// v6 — strengthens WallOpening.type's description to match analyze-sketch
// v9's new rule 16: resolve each opening's type from evidence at its OWN
// position only (never by elimination across a wall's other openings),
// and apply the same type to multiple openings sharing one identical,
// unusual graphic marking convention when at least one is confirmed.
// v5 — strengthens WallOpening.distanceFromStart/width descriptions to
// match analyze-sketch v8's amended rule 15: measurement difficulty at
// a specific opening (unclear/partial grid label, blur, etc.) is never
// grounds to omit the opening entirely — only to estimate it and flag
// lower confidence, paired with the same never-omit language now in
// the prompt.
// v4 — adds a description to WallOpening.distanceFromStart (and width)
// reinforcing exhaustive per-wall opening scanning + grid-cell-counted
// positioning (paired with SYSTEM_PROMPT rules 14-15 in analyze-sketch
// v7: scan every wall's full length for openings, don't stop after the
// first one, and count grid cells to each opening's position instead
// of estimating it).
// v3 — adds a description to WallOpening.type reinforcing door-vs-window
// classification guidance (paired with SYSTEM_PROMPT rule 13 in
// analyze-sketch v6: read explicit text labels first, fall back to
// width/sill-height/interior-vs-exterior-wall heuristics).
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
    type: {
      type: "string",
      enum: ["door", "window"],
      description:
        "Prefer an explicit Hebrew text label at/near this opening ('חלון'->window, 'דלת'/'כניסה'->door) when one exists in the sketch - use it for every labeled opening, not just some. Resolve each opening INDEPENDENTLY from the evidence located at its own specific position - never by first cataloguing which types exist somewhere on the wall and then distributing/guessing which position gets which type; a label near one opening must never be applied to a different nearby opening. If several openings in the sketch share one identical, unusual graphic marking convention that appears nowhere else (e.g. the same distinctively colored/styled dashed line), and one of them is confirmed by its own label or strong evidence, classify the others sharing that exact convention the same way too - unless one of them carries its own conflicting label. When no label and no shared-marking evidence exists, infer from: relative width vs. other openings on the same wall (wider ~0.7-1.0m usually door, narrower usually window), sillHeight (0 = starts at floor = usually door, >0 = raised sill = usually window), and whether the wall is interior-between-two-rooms (almost always door) or exterior (could be either).",
    },
    distanceFromStart: {
      type: "number",
      description:
        "Distance in meters from this wall's `start` point to this opening. Scan the ENTIRE length of every wall for opening markers (a nearby Hebrew label like 'חלון'/'דלת'/'כניסה', or a graphically distinct line style such as dashed/dotted breaking the solid wall line) — do not stop after finding the first one or two on a wall. Once an opening is found, compute this value by counting grid cells from the wall's start to the opening (summing their explicit labeled sizes, same method as the overall wall length) rather than estimating its position visually. If the exact cell count can't be read at that spot — no grid visible there, OR a grid is visible but its label near the opening is unclear/partial/obscured — give your best-effort estimate instead and note the reduced confidence. An opening you have evidence for (per the marker itself) must never be dropped from the output just because its exact position is hard to measure — omission is reserved for openings with no marker evidence at all.",
    },
    width: {
      type: "number",
      description:
        "Opening width in meters. Count grid cells the opening spans (summing their explicit labeled sizes) rather than assuming a 'typical' door/window width. If that count isn't cleanly readable at this specific opening, estimate it instead of omitting the opening — the same reduced-confidence fallback as distanceFromStart, never a reason to leave it out entirely.",
    },
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
