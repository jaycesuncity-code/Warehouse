/**
 * Lengths, coordinates and shelf geometry.
 *
 * Everything is stored in inches (rounded to 1/16) and shown as feet-inches (rounded to 1/8).
 * Map coordinates: origin = NW corner of WAREHOUSE 126, X east, Y south (contract section 1).
 */
import type { Point, ShelfGeometry, SlotGeometry } from './contract';

// ---------------------------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------------------------

export const roundToSixteenth = (n: number): number => Math.round(n * 16) / 16;
export const roundToEighth = (n: number): number => Math.round(n * 8) / 8;

// ---------------------------------------------------------------------------------------------
// Parsing: 40'-3"  40' 3  40-3  40 3  40.25'  483"  483  7'-8 1/2"
// ---------------------------------------------------------------------------------------------

export type LengthUnit = 'ft' | 'in';

export type ParseResult = { ok: true; inches: number } | { ok: false; error: string };

const NUM = String.raw`\d+(?:\.\d+)?`;
const FRAC = String.raw`\d+\/\d+`;
// inches value: "8", "8.5", "8 1/2", "8-1/2", "1/2"
const INCH_VAL = String.raw`(?:${NUM}(?:[\s-]+${FRAC})?|${FRAC})`;

const RE_FT_MARK = new RegExp(String.raw`^(${NUM})'\s*-?\s*(${INCH_VAL})?\s*"?$`);
const RE_IN_MARK = new RegExp(String.raw`^(${INCH_VAL})"$`);
const RE_FT_IN_PAIR = new RegExp(String.raw`^(${NUM})[-\s]\s*(${INCH_VAL})$`);
const RE_PLAIN = new RegExp(String.raw`^(${NUM}(?:\s+${FRAC})?|${FRAC})$`);
const RE_ONLY_FRAC = new RegExp(String.raw`^${FRAC}$`);

function inchValue(text: string): number {
  // "8", "8.5", "8 1/2", "8-1/2", "1/2"
  const parts = text.trim().split(/[\s-]+/);
  let total = 0;
  for (const p of parts) {
    if (p.includes('/')) {
      const [a, b] = p.split('/').map(Number);
      total += b ? a / b : 0;
    } else {
      total += Number(p);
    }
  }
  return total;
}

/**
 * Parse a length typed by a person. A bare number means feet in a feet field and inches in an inch field.
 * Returns inches rounded to 1/16, or a plain-words error.
 */
export function parseLengthDetailed(input: string, defaultUnit: LengthUnit = 'in'): ParseResult {
  let s = (input ?? '')
    .toLowerCase()
    .replace(/[′’‘]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/(\d)\s*(?:feet|foot|ft)\b\.?/g, "$1'")
    .replace(/(\d)\s*(?:inches|inch|in)\b\.?/g, '$1"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return { ok: false, error: 'Type a length, like 40\'-3" or 483' };

  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/\s+(['"])/g, '$1');

  let inches: number | null = null;
  let m: RegExpMatchArray | null;

  if ((m = s.match(RE_FT_MARK))) {
    inches = Number(m[1]) * 12 + (m[2] ? inchValue(m[2]) : 0);
  } else if ((m = s.match(RE_IN_MARK))) {
    inches = inchValue(m[1]);
  } else if ((m = s.match(RE_FT_IN_PAIR))) {
    // "8 1/2" (space, then only a fraction) is a mixed number in the default unit, not 8 ft 1/2 in.
    // A dash always means feet-inches: "40-3", "8-1/2".
    if (RE_ONLY_FRAC.test(m[2]) && !s.includes('-')) {
      const v = inchValue(s);
      inches = defaultUnit === 'ft' ? v * 12 : v;
    } else {
      inches = Number(m[1]) * 12 + inchValue(m[2]);
    }
  } else if ((m = s.match(RE_PLAIN))) {
    const v = inchValue(m[1]);
    inches = defaultUnit === 'ft' ? v * 12 : v;
  }

  if (inches === null || !Number.isFinite(inches)) {
    return { ok: false, error: 'Could not read that length. Try 40\'-3" or 483' };
  }
  return { ok: true, inches: roundToSixteenth(sign * inches) };
}

/** Parse to inches, or null when unreadable. */
export function parseLength(input: string, defaultUnit: LengthUnit = 'in'): number | null {
  const r = parseLengthDetailed(input, defaultUnit);
  return r.ok ? r.inches : null;
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Feet-inches, rounded to 1/8 in by default: 483 -> 40'-3", 8.5 -> 8 1/2", 100.0625 -> 8'-4 1/8". */
export function formatFtIn(inches: number, denominator = 8): string {
  if (!Number.isFinite(inches)) return '';
  const sign = inches < 0 ? '-' : '';
  const units = Math.round(Math.abs(inches) * denominator);
  const whole = Math.floor(units / denominator);
  const fracN = units % denominator;
  const feet = Math.floor(whole / 12);
  const inch = whole % 12;
  let frac = '';
  if (fracN) {
    const g = gcd(fracN, denominator);
    frac = `${fracN / g}/${denominator / g}`;
  }
  let inchText: string;
  if (inch === 0 && frac) inchText = feet > 0 ? `0 ${frac}` : frac;
  else inchText = frac ? `${inch} ${frac}` : `${inch}`;
  return feet > 0 ? `${sign}${feet}'-${inchText}"` : `${sign}${inchText}"`;
}

/** Plain inches for the "parsed value" hint next to inputs: 483 -> 483". */
export function formatInches(inches: number): string {
  if (!Number.isFinite(inches)) return '';
  const r = roundToSixteenth(inches);
  return `${Number.isInteger(r) ? r : r.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}"`;
}

/** W x H x D in feet-inches, skipping missing values; null when nothing is known. */
export function formatDims(w: number | null, h: number | null, d: number | null): string | null {
  const parts = [w, h, d].map((v) => (v == null ? null : formatFtIn(v)));
  if (parts.every((p) => p == null)) return null;
  return parts.map((p) => p ?? '?').join(' × ');
}

// ---------------------------------------------------------------------------------------------
// Survey sheet <-> map coordinates (contract section 1)
// ---------------------------------------------------------------------------------------------

/** 162'-3" = 1947 in: the north-south extent of the in-scope footprint. */
export const SHEET_Y_MAX_IN = 1947;

/** Older paper sheets: origin = outside SW corner of STORAGE - FILTERS 120, Y running north. */
export function sheetToMap(p: Point): Point {
  return [p[0], SHEET_Y_MAX_IN - p[1]];
}
/** Map coordinates back to the older survey sheets (the conversion is its own inverse). */
export function mapToSheet(p: Point): Point {
  return [p[0], SHEET_Y_MAX_IN - p[1]];
}

// ---------------------------------------------------------------------------------------------
// Shelf geometry (contract section 4)
// ---------------------------------------------------------------------------------------------

const RIGHT_ANGLE_TRIG: Record<number, [number, number]> = {
  0: [1, 0],
  90: [0, 1],
  180: [-1, 0],
  270: [0, -1],
};

function cosSin(rotationDeg: number): [number, number] {
  const norm = ((rotationDeg % 360) + 360) % 360;
  const exact = RIGHT_ANGLE_TRIG[norm];
  if (exact) return exact;
  const r = (norm * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

type ShelfPlacement = Pick<ShelfGeometry, 'x_in' | 'y_in' | 'rotation_deg'>;

/**
 * Shelf-local (u, v) to map (X, Y).
 * u = inches from the left edge toward the viewer's right; v = inches from the front face back into the shelf.
 *   X = x_in + u*cos(r) + v*sin(r)
 *   Y = y_in + u*sin(r) - v*cos(r)
 */
export function shelfLocalToMap(shelf: ShelfPlacement, u: number, v: number): Point {
  const [c, s] = cosSin(shelf.rotation_deg);
  return [shelf.x_in + u * c + v * s, shelf.y_in + u * s - v * c];
}

/** The four floor corners: front-left, front-right, back-right, back-left. */
export function shelfCorners(shelf: ShelfPlacement & Pick<ShelfGeometry, 'width_in' | 'depth_in'>): Point[] {
  return [
    shelfLocalToMap(shelf, 0, 0),
    shelfLocalToMap(shelf, shelf.width_in, 0),
    shelfLocalToMap(shelf, shelf.width_in, shelf.depth_in),
    shelfLocalToMap(shelf, 0, shelf.depth_in),
  ];
}

export type Compass = 'north' | 'east' | 'south' | 'west';

/** Which way the shelf front faces, or null for a free angle. 0 = south, 90 = west, 180 = north, 270 = east. */
export function shelfFacing(rotationDeg: number): Compass | null {
  const norm = ((rotationDeg % 360) + 360) % 360;
  switch (norm) {
    case 0:
      return 'south';
    case 90:
      return 'west';
    case 180:
      return 'north';
    case 270:
      return 'east';
    default:
      return null;
  }
}

export function cellWidth(shelf: Pick<ShelfGeometry, 'width_in' | 'cols'>): number {
  return shelf.width_in / shelf.cols;
}

export interface FrontRect {
  /** Inches from the shelf's left edge. */
  left: number;
  /** Inches above the floor (the deck the bin sits on). */
  bottom: number;
  width: number;
  height: number;
}

/**
 * Physical rectangle of a slot on the shelf front (contract section 4):
 *   left = (col_start-1)*cell_width, width = width_span*cell_width,
 *   bottom = rows[row_index].elevation_in,
 *   height = (top of the highest spanned row's clear height) - bottom.
 */
export function slotRect(
  shelf: Pick<ShelfGeometry, 'width_in' | 'cols' | 'rows'>,
  slot: Pick<SlotGeometry, 'row_index' | 'col_start' | 'width_span' | 'height_span'>,
): FrontRect {
  const cw = cellWidth(shelf);
  const rows = shelf.rows;
  const bottomRow = rows[Math.min(slot.row_index, rows.length - 1)];
  const topRow = rows[Math.min(slot.row_index + slot.height_span - 1, rows.length - 1)];
  const bottom = bottomRow ? bottomRow.elevation_in : 0;
  const top = topRow ? topRow.elevation_in + topRow.clear_height_in : bottom;
  return {
    left: (slot.col_start - 1) * cw,
    bottom,
    width: slot.width_span * cw,
    height: Math.max(top - bottom, 0),
  };
}

/** Slot footprint on the map: the slot's width along the shelf, across the full depth. */
export function slotFootprintOnMap(
  shelf: ShelfPlacement & Pick<ShelfGeometry, 'width_in' | 'depth_in' | 'cols' | 'rows'>,
  slot: Pick<SlotGeometry, 'row_index' | 'col_start' | 'width_span' | 'height_span'>,
): Point[] {
  const r = slotRect(shelf, slot);
  return [
    shelfLocalToMap(shelf, r.left, 0),
    shelfLocalToMap(shelf, r.left + r.width, 0),
    shelfLocalToMap(shelf, r.left + r.width, shelf.depth_in),
    shelfLocalToMap(shelf, r.left, shelf.depth_in),
  ];
}

/** True when a bin is larger than the slot it sits in (a warning, never a block). */
export function binExceedsSlot(
  shelf: Pick<ShelfGeometry, 'width_in' | 'cols' | 'rows' | 'depth_in'>,
  slot: Pick<
    SlotGeometry,
    | 'row_index'
    | 'col_start'
    | 'width_span'
    | 'height_span'
    | 'bin_width_in'
    | 'bin_height_in'
    | 'bin_depth_in'
  >,
): boolean {
  const r = slotRect(shelf, slot);
  const eps = 0.01;
  return (
    (slot.bin_width_in != null && slot.bin_width_in > r.width + eps) ||
    (slot.bin_height_in != null && slot.bin_height_in > r.height + eps) ||
    (slot.bin_depth_in != null && slot.bin_depth_in > shelf.depth_in + eps)
  );
}

/** Title-case a zone name for sentences: "STORAGE - PARTS & TOOLS 121" -> "Storage - Parts & Tools 121". */
export function niceZoneName(name: string): string {
  return name.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
