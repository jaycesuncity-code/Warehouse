// Units and coordinates (contract §1 and §4).
// - Storage/API: inches, rounded to 1/16 in.
// - Display: feet-inches, rounded to 1/8 in.
// - Map coordinates: origin = NW corner of WAREHOUSE 126, X east, Y south.
// - Survey-sheet coordinates: origin = outside SW corner of STORAGE - FILTERS 120, Y north.

import type { Point, Row, ShelfBase, SlotBase } from "../shared/contract";

/** Overall in-scope footprint (100'-1" x 162'-3"). */
export const FOOTPRINT_X_IN = 1201;
export const FOOTPRINT_Y_IN = 1947;
/** Default wall height when a zone has none (UNVERIFIED: A-1 gives no ceiling height). */
export const DEFAULT_WALL_HEIGHT_IN = 192;
export const DECK_THICKNESS_IN = 1;

export function round16(x: number): number {
  return Math.round(x * 16) / 16;
}

// ---------------------------------------------------------------------------
// Parse / format
// ---------------------------------------------------------------------------

const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`;
const FRAC = String.raw`\d+\/\d+`;

/** Parses an inch expression: "8", "8.5", "8 1/2", "1/2", optionally with a trailing ". */
function parseInchExpr(s: string): number | null {
  const t = s.trim().replace(/(″|"|''|in\.?|inches?)$/i, "").trim();
  if (t === "") return 0;
  let m = new RegExp(`^(${NUM})\\s+(${FRAC})$`).exec(t);
  if (m) return parseFloat(m[1]) + fracValue(m[2]);
  m = new RegExp(`^(${FRAC})$`).exec(t);
  if (m) return fracValue(m[1]);
  m = new RegExp(`^(${NUM})$`).exec(t);
  if (m) return parseFloat(m[1]);
  return null;
}

function fracValue(f: string): number {
  const [a, b] = f.split("/").map(Number);
  return b ? a / b : NaN;
}

export type LengthUnit = "ft" | "in";

/**
 * Parses a length typed by a person and returns inches (rounded to 1/16), or null if it
 * can't be read. Accepts 40'-3", 40' 3, 40-3, 40 3, 40.25', 483", 483, 7'-8 1/2", 8 1/2".
 * A bare number means feet in a feet field and inches in an inch field.
 */
export function parseLength(input: string, bareUnit: LengthUnit = "in"): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/[’`]/g, "'").replace(/[”″]/g, '"');
  if (s === "") return null;
  let sign = 1;
  if (/^-\s*[\d.]/.test(s)) {
    sign = -1;
    s = s.replace(/^-\s*/, "");
  }
  let result: number | null;

  const ftIdx = s.indexOf("'");
  if (ftIdx >= 0 && s[ftIdx + 1] !== "'") {
    const feet = s.slice(0, ftIdx).trim();
    if (!new RegExp(`^(${NUM})$`).test(feet)) return null;
    const rest = s.slice(ftIdx + 1).replace(/^\s*-?\s*/, "");
    const inches = parseInchExpr(rest);
    if (inches == null) return null;
    result = parseFloat(feet) * 12 + inches;
  } else if (/("|''|in\.?|inch(es)?)$/i.test(s)) {
    result = parseInchExpr(s);
  } else {
    // No unit marks. "40-3" / "40 3" / "40 3 1/2" = feet-inches; "8 1/2" = mixed number; "483" = bare.
    const bare = new RegExp(`^(${NUM})$`).exec(s);
    if (bare) {
      const n = parseFloat(bare[1]);
      result = bareUnit === "ft" ? n * 12 : n;
    } else {
      const mixed = new RegExp(`^(${NUM})\\s+(${FRAC})$`).exec(s);
      if (mixed) {
        const n = parseFloat(mixed[1]) + fracValue(mixed[2]);
        result = bareUnit === "ft" ? n * 12 : n;
      } else {
        const fi = new RegExp(`^(${NUM})\\s*[-\\s]\\s*(.+)$`).exec(s);
        if (!fi) return null;
        const inches = parseInchExpr(fi[2]);
        if (inches == null) return null;
        result = parseFloat(fi[1]) * 12 + inches;
      }
    }
  }
  if (result == null || !Number.isFinite(result)) return null;
  return round16(sign * result);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function fracText(eighths: number): string {
  if (eighths === 0) return "";
  const g = gcd(eighths, 8);
  return `${eighths / g}/${8 / g}`;
}

/** Inches -> `40'-3"`, `7'-8 1/2"`, `6 1/2"` (rounded to 1/8 in). */
export function formatFtIn(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches)) return "—";
  const sign = inches < 0 ? "-" : "";
  let eighthsTotal = Math.round(Math.abs(inches) * 8);
  const feet = Math.floor(eighthsTotal / 96);
  eighthsTotal -= feet * 96;
  const whole = Math.floor(eighthsTotal / 8);
  const frac = fracText(eighthsTotal % 8);
  const inchPart = frac ? (whole ? `${whole} ${frac}` : frac) : `${whole}`;
  if (feet === 0) return `${sign}${inchPart}"`;
  return `${sign}${feet}'-${inchPart}"`;
}

/** Inches -> `15"`, `7 1/2"` (never converts to feet). */
export function formatIn(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches)) return "—";
  const sign = inches < 0 ? "-" : "";
  const e = Math.round(Math.abs(inches) * 8);
  const whole = Math.floor(e / 8);
  const frac = fracText(e % 8);
  return `${sign}${frac ? (whole ? `${whole} ${frac}` : frac) : whole}"`;
}

// ---------------------------------------------------------------------------
// Survey sheet <-> map
// ---------------------------------------------------------------------------

/** Survey sheet (origin SW corner of 120, Y north) -> map (origin NW corner of 126, Y south). */
export function sheetToMap(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x, y: round16(FOOTPRINT_Y_IN - p.y) };
}

/** Map -> survey sheet. The conversion is its own inverse. */
export function mapToSheet(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x, y: round16(FOOTPRINT_Y_IN - p.y) };
}

export function sheetYToMapY(ySheet: number): number {
  return round16(FOOTPRINT_Y_IN - ySheet);
}

// ---------------------------------------------------------------------------
// Shelf local (u, v) <-> map (X, Y)
// ---------------------------------------------------------------------------

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export function normalizeDeg(d: number): number {
  const n = ((d % 360) + 360) % 360;
  return Math.abs(n - 360) < 1e-9 ? 0 : n;
}

type Placement = Pick<ShelfBase, "x_in" | "y_in" | "rotation_deg">;
type Footprint = Placement & Pick<ShelfBase, "width_in" | "depth_in">;

function cs(rotationDeg: number): [number, number] {
  const r = deg2rad(rotationDeg);
  // Snap exact quarter turns so 270° gives clean integers.
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [Math.abs(c) < 1e-12 ? 0 : c, Math.abs(s) < 1e-12 ? 0 : s];
}

/** Contract §4: X = x + u cos r + v sin r ; Y = y + u sin r - v cos r. */
export function shelfToMap(shelf: Placement, u: number, v: number): { x: number; y: number } {
  const [c, s] = cs(shelf.rotation_deg);
  return { x: shelf.x_in + u * c + v * s, y: shelf.y_in + u * s - v * c };
}

export function mapToShelf(shelf: Placement, x: number, y: number): { u: number; v: number } {
  const [c, s] = cs(shelf.rotation_deg);
  const dx = x - shelf.x_in;
  const dy = y - shelf.y_in;
  return { u: dx * c + dy * s, v: dx * s - dy * c };
}

/** Unit vector the shelf's front faces (into the aisle). */
export function frontDir(rotationDeg: number): { x: number; y: number } {
  const [c, s] = cs(rotationDeg);
  return { x: -s + 0, y: c + 0 };
}

/** Unit vector along the width (left -> right for someone facing the shelf). */
export function widthDir(rotationDeg: number): { x: number; y: number } {
  const [c, s] = cs(rotationDeg);
  return { x: c + 0, y: s + 0 };
}

/** Rotation whose front faces the given direction. */
export function rotationForFront(fx: number, fy: number): number {
  return normalizeDeg(round16(rad2deg(Math.atan2(-fx, fy))));
}

/** Footprint corners: front-left, front-right, back-right, back-left. */
export function shelfCorners(shelf: Footprint): Point[] {
  const pts: [number, number][] = [
    [0, 0],
    [shelf.width_in, 0],
    [shelf.width_in, shelf.depth_in],
    [0, shelf.depth_in],
  ];
  return pts.map(([u, v]) => {
    const p = shelfToMap(shelf, u, v);
    return [p.x, p.y] as Point;
  });
}

export function shelfCenter(shelf: Footprint): { x: number; y: number } {
  return shelfToMap(shelf, shelf.width_in / 2, shelf.depth_in / 2);
}

/** Front-left corner that puts the footprint centre at (cx, cy). */
export function placementFromCenter(
  cx: number,
  cy: number,
  rotationDeg: number,
  width: number,
  depth: number,
): { x_in: number; y_in: number } {
  const [c, s] = cs(rotationDeg);
  return {
    x_in: round16(cx - (width / 2) * c - (depth / 2) * s),
    y_in: round16(cy - (width / 2) * s + (depth / 2) * c),
  };
}

// ---------------------------------------------------------------------------
// Grid and slots
// ---------------------------------------------------------------------------

export function cellWidth(shelf: Pick<ShelfBase, "width_in" | "cols">): number {
  return shelf.width_in / Math.max(1, shelf.cols);
}

export interface SlotRect {
  left: number; // inches from the shelf's left edge
  width: number;
  bottom: number; // inches above the floor
  height: number;
}

/** Contract §4 slot rectangle. Returns null if the slot's rows don't exist. */
export function slotRect(
  shelf: Pick<ShelfBase, "width_in" | "cols" | "rows">,
  slot: Pick<SlotBase, "row_index" | "col_start" | "width_span" | "height_span">,
): SlotRect | null {
  const cw = cellWidth(shelf);
  const bottomRow = shelf.rows[slot.row_index];
  const topRow = shelf.rows[slot.row_index + slot.height_span - 1];
  if (!bottomRow || !topRow) return null;
  const top = topRow.elevation_in + topRow.clear_height_in;
  return {
    left: (slot.col_start - 1) * cw,
    width: slot.width_span * cw,
    bottom: bottomRow.elevation_in,
    height: top - bottomRow.elevation_in,
  };
}

export function rowLabel(index: number): string {
  return index === 0 ? "G" : String(index);
}

/**
 * Evenly spaced rows: G deck top at 4", decks 1" thick, top row's clear height runs to the
 * shelf height. Matches the demo construction in contract §9.
 */
export function evenRows(count: number, heightIn: number, groundIn = 4): Row[] {
  const n = Math.max(1, Math.round(count));
  const spacing = Math.max(1, Math.floor((heightIn - groundIn + DECK_THICKNESS_IN) / n));
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const elevation = groundIn + i * spacing;
    const clear = i < n - 1 ? spacing - DECK_THICKNESS_IN : Math.max(1, heightIn - elevation);
    rows.push({ row_index: i, row_label: rowLabel(i), elevation_in: round16(elevation), clear_height_in: round16(clear) });
  }
  return rows;
}

/** Recomputes clear heights from elevations (gap to next deck minus deck thickness). */
export function recalcClearHeights(rows: Row[], heightIn: number): Row[] {
  const sorted = [...rows].sort((a, b) => a.elevation_in - b.elevation_in);
  return sorted.map((r, i) => {
    const next = sorted[i + 1];
    const clear = next ? next.elevation_in - DECK_THICKNESS_IN - r.elevation_in : heightIn - r.elevation_in;
    return { row_index: i, row_label: rowLabel(i), elevation_in: round16(r.elevation_in), clear_height_in: round16(Math.max(0, clear)) };
  });
}
