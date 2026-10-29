import { describe, expect, it } from 'vitest';
import type { ShelfGeometry } from './contract';
import { DEMO_DATA } from './mock/demo-data';
import {
  binExceedsSlot,
  formatDims,
  formatFtIn,
  formatInches,
  mapToSheet,
  niceZoneName,
  ordinal,
  parseLength,
  parseLengthDetailed,
  roundToEighth,
  roundToSixteenth,
  shelfCorners,
  shelfFacing,
  shelfLocalToMap,
  sheetToMap,
  slotFootprintOnMap,
  slotRect,
} from './units';

describe('parseLength', () => {
  const inch = (s: string) => parseLength(s, 'in');
  it('reads every form named in the contract', () => {
    expect(inch(`40'-3"`)).toBe(483);
    expect(inch(`40' 3`)).toBe(483);
    expect(inch('40-3')).toBe(483);
    expect(inch('40 3')).toBe(483);
    expect(inch(`40.25'`)).toBe(483);
    expect(inch('483"')).toBe(483);
    expect(inch('483')).toBe(483);
    expect(inch(`7'-8 1/2"`)).toBe(92.5);
  });
  it('a bare number is feet in a feet field and inches in an inch field', () => {
    expect(parseLength('40', 'ft')).toBe(480);
    expect(parseLength('40', 'in')).toBe(40);
    expect(parseLength('40.25', 'ft')).toBe(483);
    expect(parseLength('8 1/2', 'in')).toBe(8.5); // mixed number, not 8 ft 1/2 in
    expect(parseLength('8 1/2', 'ft')).toBe(102);
  });
  it('is forgiving about spelling and spacing', () => {
    expect(inch(`  40 ft 3 in `)).toBe(483);
    expect(inch(`40ft 3in`)).toBe(483);
    expect(inch(`40 feet`)).toBe(480);
    expect(inch(`40′ 3″`)).toBe(483);
    expect(inch(`12'`)).toBe(144);
    expect(inch(`3/4"`)).toBe(0.75);
    expect(inch('1/2')).toBe(0.5);
    expect(inch('-24')).toBe(-24);
    expect(inch(`-2'-6"`)).toBe(-30);
    expect(inch('0')).toBe(0);
    expect(inch('7-1/2')).toBe(84.5);
  });
  it('rounds to 1/16 in and rejects nonsense with a plain message', () => {
    expect(inch('0.03')).toBe(0);
    expect(inch('0.04')).toBe(0.0625);
    expect(roundToSixteenth(1.4)).toBe(1.375);
    expect(inch('')).toBeNull();
    expect(inch('abc')).toBeNull();
    expect(inch('4..5')).toBeNull();
    expect(inch(`4'x5`)).toBeNull();
    const bad = parseLengthDetailed('forty', 'in');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Could not read/);
  });
});

describe('formatFtIn', () => {
  it('formats feet-inches rounded to 1/8 in', () => {
    expect(formatFtIn(483)).toBe(`40'-3"`);
    expect(formatFtIn(1947)).toBe(`162'-3"`);
    expect(formatFtIn(120)).toBe(`10'-0"`);
    expect(formatFtIn(92.5)).toBe(`7'-8 1/2"`);
    expect(formatFtIn(8.5)).toBe(`8 1/2"`);
    expect(formatFtIn(0.5)).toBe(`1/2"`);
    expect(formatFtIn(0)).toBe(`0"`);
    expect(formatFtIn(12)).toBe(`1'-0"`);
    expect(formatFtIn(12.125)).toBe(`1'-0 1/8"`);
    expect(formatFtIn(-30)).toBe(`-2'-6"`);
  });
  it('rounds to 1/8 and carries', () => {
    expect(formatFtIn(100.0625)).toBe(`8'-4 1/8"`);
    expect(formatFtIn(4.99)).toBe(`5"`);
    expect(formatFtIn(11.99)).toBe(`1'-0"`);
    expect(formatFtIn(3.3)).toBe(`3 1/4"`);
    expect(roundToEighth(3.3)).toBe(3.25);
  });
  it('round-trips with the parser', () => {
    for (const v of [0, 0.5, 8.5, 12, 92.5, 483, 1947, 1203, 637, 997.125]) {
      expect(parseLength(formatFtIn(v), 'in')).toBe(v);
    }
  });
  it('formats plain inches and dimension triples', () => {
    expect(formatInches(483)).toBe('483"');
    expect(formatInches(1.4375)).toBe('1.4375"');
    expect(formatDims(1.25, 1.25, 1)).toBe(`1 1/4" × 1 1/4" × 1"`);
    expect(formatDims(null, null, null)).toBeNull();
    expect(formatDims(44, null, 1.5)).toBe(`3'-8" × ? × 1 1/2"`);
  });
  it('title-cases zone names and builds ordinals', () => {
    expect(niceZoneName('STORAGE - PARTS & TOOLS 121')).toBe('Storage - Parts & Tools 121');
    expect(niceZoneName('WAREHOUSE 126')).toBe('Warehouse 126');
    expect(niceZoneName('ROOM (NO LABEL)')).toBe('Room (No Label)');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '112th',
    ]);
  });
});

describe('survey sheet <-> map conversion', () => {
  it('sheet (0,0) is map (0,1947)', () => {
    expect(sheetToMap([0, 0])).toEqual([0, 1947]);
  });
  it('converts both ways and is its own inverse', () => {
    expect(sheetToMap([100, 1947])).toEqual([100, 0]);
    expect(mapToSheet([483, 0])).toEqual([483, 1947]);
    for (const p of [
      [0, 0],
      [12.5, 900],
      [1201, 1947],
      [-60, 30.25],
    ] as [number, number][]) {
      expect(mapToSheet(sheetToMap(p))).toEqual(p);
      expect(sheetToMap(mapToSheet(p))).toEqual(p);
    }
    // the SW corner of STORAGE - FILTERS 120 (sheet origin) is the polygon's (0,1947) corner
    const filters = DEMO_DATA.zones.find((z) => z.name === 'STORAGE - FILTERS 120')!;
    expect(filters.polygon_in).toContainEqual(sheetToMap([0, 0]));
  });
});

function shelfAt(
  rotation_deg: number,
): Pick<ShelfGeometry, 'x_in' | 'y_in' | 'rotation_deg' | 'width_in' | 'depth_in'> {
  return { x_in: 100, y_in: 200, rotation_deg, width_in: 96, depth_in: 24 };
}

describe('shelf local (u, v) -> map (X, Y)', () => {
  it('rotation 0: front faces south, width runs east, depth runs north (back is north of the front)', () => {
    const s = shelfAt(0);
    expect(shelfLocalToMap(s, 0, 0)).toEqual([100, 200]);
    expect(shelfLocalToMap(s, 96, 0)).toEqual([196, 200]); // right end is east
    expect(shelfLocalToMap(s, 0, 24)).toEqual([100, 176]); // back is north (-Y)
    expect(shelfFacing(0)).toBe('south');
  });
  it('rotation 90: front faces west, width runs south', () => {
    const s = shelfAt(90);
    expect(shelfLocalToMap(s, 96, 0)).toEqual([100, 296]);
    expect(shelfLocalToMap(s, 0, 24)).toEqual([124, 200]); // back is east
    expect(shelfFacing(90)).toBe('west');
  });
  it('rotation 180: front faces north, width runs west', () => {
    const s = shelfAt(180);
    expect(shelfLocalToMap(s, 96, 0)).toEqual([4, 200]);
    expect(shelfLocalToMap(s, 0, 24)).toEqual([100, 224]); // back is south
    expect(shelfFacing(180)).toBe('north');
  });
  it('rotation 270: front faces east, width runs north', () => {
    const s = shelfAt(270);
    expect(shelfLocalToMap(s, 96, 0)).toEqual([100, 104]);
    expect(shelfLocalToMap(s, 0, 24)).toEqual([76, 200]); // back is west
    expect(shelfFacing(270)).toBe('east');
    expect(shelfFacing(-90)).toBe('east');
    expect(shelfFacing(45)).toBeNull();
  });
  it('free angles use the same formula', () => {
    const [x, y] = shelfLocalToMap(shelfAt(45), 10, 0);
    expect(x).toBeCloseTo(100 + 10 * Math.SQRT1_2, 9);
    expect(y).toBeCloseTo(200 + 10 * Math.SQRT1_2, 9);
  });

  const bbox = (pts: [number, number][]) => ({
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  });
  const shelf = (name: string) => DEMO_DATA.shelves.find((s) => s.name === name)!;

  it('A1 (270) stands against the warehouse west wall facing east', () => {
    const a1 = shelf('A1');
    const b = bbox(shelfCorners(a1));
    expect(b).toEqual({ minX: 0, maxX: 24, minY: 864, maxY: 960 });
    const [fl, fr, br] = shelfCorners(a1);
    expect(fl[0]).toBe(24); // front face is on the east side (x = 24) ...
    expect(br[0]).toBe(0); // ... back against x = 0, the west wall
    expect(fr[1]).toBeLessThan(fl[1]); // viewer's right is north (smaller Y)
  });
  it('A2 (270) sits north of A1 with no overlap', () => {
    expect(bbox(shelfCorners(shelf('A2')))).toEqual({ minX: 0, maxX: 24, minY: 744, maxY: 840 });
  });
  it('B1 (180) faces north inside STORAGE - PARTS & TOOLS 121', () => {
    const b1 = shelf('B1');
    expect(bbox(shelfCorners(b1))).toEqual({ minX: 144, maxX: 240, minY: 1651, maxY: 1675 });
    const [fl, , br] = shelfCorners(b1);
    expect(br[1]).toBeGreaterThan(fl[1]); // back is south of the front, so the front faces north
  });
  it('F1 (90) faces west inside STORAGE - FILTERS 120', () => {
    const f1 = shelf('F1');
    expect(bbox(shelfCorners(f1))).toEqual({ minX: 447.5, maxX: 471.5, minY: 1728, maxY: 1824 });
    const [fl, , br] = shelfCorners(f1);
    expect(br[0]).toBeGreaterThan(fl[0]); // back is east, front faces west
  });
  it('every demo shelf is inside its zone', () => {
    for (const s of DEMO_DATA.shelves) {
      const zone = DEMO_DATA.zones.find((z) => z.zone_id === s.zone_id)!;
      for (const [x, y] of shelfCorners(s))
        expect(pointInPolygon(x, y, zone.polygon_in), `${s.name} ${x},${y}`).toBe(true);
    }
  });
});

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  // boundary counts as inside (shelves may touch walls)
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const onEdge =
      Math.abs((yj - yi) * (x - xi) - (xj - xi) * (y - yi)) < 1e-6 &&
      x >= Math.min(xi, xj) - 1e-6 &&
      x <= Math.max(xi, xj) + 1e-6 &&
      y >= Math.min(yi, yj) - 1e-6 &&
      y <= Math.max(yi, yj) + 1e-6;
    if (onEdge) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('slot rectangles', () => {
  const a1 = DEMO_DATA.shelves.find((s) => s.name === 'A1')!;
  it('uses cell width, deck elevation and clear height', () => {
    // 96 in / 12 cols = 8 in cells; rows: G deck top 4, pitch 16, clear 15
    expect(slotRect(a1, { row_index: 0, col_start: 1, width_span: 3, height_span: 1 })).toEqual({
      left: 0,
      bottom: 4,
      width: 24,
      height: 15,
    });
    expect(slotRect(a1, { row_index: 1, col_start: 5, width_span: 4, height_span: 1 })).toEqual({
      left: 32,
      bottom: 20,
      width: 32,
      height: 15,
    });
  });
  it('a two-row slot reaches the top of the upper row clear height', () => {
    // rows 2 and 3: bottom 36, top = 52 + 15 = 67
    expect(slotRect(a1, { row_index: 2, col_start: 1, width_span: 3, height_span: 2 })).toEqual({
      left: 0,
      bottom: 36,
      width: 24,
      height: 31,
    });
  });
  it('the slot footprint on the map is its width across the full shelf depth', () => {
    const pts = slotFootprintOnMap(a1, { row_index: 0, col_start: 1, width_span: 3, height_span: 1 });
    // A1 is rotation 270: u runs north (-Y) from y=960, v runs west (-X) from x=24
    expect(pts).toEqual([
      [24, 960],
      [24, 936],
      [0, 936],
      [0, 960],
    ]);
  });
  it('flags a bin that is bigger than its slot', () => {
    const base = { row_index: 0, col_start: 1, width_span: 1, height_span: 1 };
    expect(binExceedsSlot(a1, { ...base, bin_width_in: 8, bin_height_in: 15, bin_depth_in: 24 })).toBe(false);
    expect(binExceedsSlot(a1, { ...base, bin_width_in: 9, bin_height_in: 10, bin_depth_in: 10 })).toBe(true);
    expect(binExceedsSlot(a1, { ...base, bin_width_in: null, bin_height_in: null, bin_depth_in: null })).toBe(
      false,
    );
  });
});
