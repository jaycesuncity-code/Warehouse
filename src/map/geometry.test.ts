import { describe, expect, it } from "vitest";
import type { Zone } from "../shared/contract";
import { DEMO_OPENINGS, DEMO_SHELVES, DEMO_ZONES } from "../shared/mock/demo-data";
import { overlappingSlots, slotBoundsProblem } from "../shared/mock/rules";
import { frontDir, mapToShelf, shelfCorners, shelfToMap, sheetToMap } from "../shared/units";
import {
  aisleWidth,
  buildWalls,
  collideMove,
  fitCount,
  insideAnyZone,
  placeFromWall,
  shelfWarnings,
  snapPlacement,
  snapTargets,
  zoneEdges,
} from "./geometry";

const W126 = DEMO_ZONES.find((z) => z.name === "WAREHOUSE 126") as Zone;
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);
const box = (s: { x_in: number; y_in: number; rotation_deg: number; width_in: number; depth_in: number }) => {
  const c = shelfCorners(s);
  return {
    minX: Math.min(...c.map((p) => p[0])),
    maxX: Math.max(...c.map((p) => p[0])),
    minY: Math.min(...c.map((p) => p[1])),
    maxY: Math.max(...c.map((p) => p[1])),
  };
};

describe("shelf (u,v) -> map footprint, all four rotations and a free angle", () => {
  const base = { x_in: 100, y_in: 200, width_in: 48, depth_in: 24 };
  it("0°: width east, back north", () =>
    expect(box({ ...base, rotation_deg: 0 })).toEqual({ minX: 100, maxX: 148, minY: 176, maxY: 200 }));
  it("90°: width south, back east", () =>
    expect(box({ ...base, rotation_deg: 90 })).toEqual({ minX: 100, maxX: 124, minY: 200, maxY: 248 }));
  it("180°: width west, back south", () =>
    expect(box({ ...base, rotation_deg: 180 })).toEqual({ minX: 52, maxX: 100, minY: 200, maxY: 224 }));
  it("270°: width north, back west", () =>
    expect(box({ ...base, rotation_deg: 270 })).toEqual({ minX: 76, maxX: 100, minY: 152, maxY: 200 }));
  it("free angle 37.5° round-trips and keeps its size", () => {
    const s = { ...base, rotation_deg: 37.5 };
    const p = shelfToMap(s, 30, 10);
    const q = mapToShelf(s, p.x, p.y);
    near(q.u, 30);
    near(q.v, 10);
    const c = shelfCorners(s);
    near(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), 48);
    near(Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]), 24);
  });
});

describe("Place from wall — every wall of WAREHOUSE 126", () => {
  const edges = zoneEdges(W126);
  const unit = { width_in: 96, depth_in: 24 };
  it("names the walls by compass side", () => {
    expect(edges.map((e) => e.name)).toEqual(["north wall", "east wall", "south wall", "west wall"]);
  });
  it("west wall, 20'-3\" from the S end, against the wall = demo shelf A1 (24, 960, 270°)", () => {
    const r = placeFromWall({ zone: W126, edgeIndex: 3, fromEnd: "start", offsetIn: 243, gapIn: 0, ...unit });
    expect(r).toMatchObject({ x_in: 24, y_in: 960, rotation_deg: 270 });
    expect(r.wall_ref).toContain("west wall");
    expect(r.wall_ref).toContain("S end");
  });
  it("west wall from the N end", () => {
    const r = placeFromWall({ zone: W126, edgeIndex: 3, fromEnd: "end", offsetIn: 120, gapIn: 0, ...unit });
    expect(r).toMatchObject({ rotation_deg: 270 });
    expect(box({ ...r, ...unit })).toEqual({ minX: 0, maxX: 24, minY: 120, maxY: 216 });
  });
  it("north wall: faces south (0°), back on Y = 0", () => {
    const r = placeFromWall({ zone: W126, edgeIndex: 0, fromEnd: "start", offsetIn: 100, gapIn: 0, ...unit });
    expect(r).toMatchObject({ x_in: 100, y_in: 24, rotation_deg: 0 });
    expect(box({ ...r, ...unit })).toEqual({ minX: 100, maxX: 196, minY: 0, maxY: 24 });
  });
  it("east wall: faces west (90°), back on X = 483", () => {
    const r = placeFromWall({ zone: W126, edgeIndex: 1, fromEnd: "start", offsetIn: 100, gapIn: 0, ...unit });
    expect(r).toMatchObject({ x_in: 459, y_in: 100, rotation_deg: 90 });
    expect(box({ ...r, ...unit })).toEqual({ minX: 459, maxX: 483, minY: 100, maxY: 196 });
  });
  it('south wall: faces north (180°), measured from the E end, 2" off the wall', () => {
    const r = placeFromWall({ zone: W126, edgeIndex: 2, fromEnd: "start", offsetIn: 100, gapIn: 2, ...unit });
    expect(r).toMatchObject({ rotation_deg: 180 });
    expect(box({ ...r, ...unit })).toEqual({ minX: 287, maxX: 383, minY: 1177, maxY: 1201 });
    expect(r.wall_ref).toContain("E end");
    expect(r.wall_ref).toContain('2" off the wall');
  });
  it("front always faces into the room", () => {
    for (let i = 0; i < 4; i++) {
      const r = placeFromWall({ zone: W126, edgeIndex: i, fromEnd: "start", offsetIn: 200, gapIn: 0, ...unit });
      const f = frontDir(r.rotation_deg);
      near(f.x, edges[i].inward.x);
      near(f.y, edges[i].inward.y);
    }
  });
});

describe("survey-sheet conversion", () => {
  it("sheet origin (SW corner of 120) is map Y 1947", () =>
    expect(sheetToMap({ x: 0, y: 0 })).toEqual({ x: 0, y: 1947 }));
  it("sheet Y 264 (22') is the north edge of 120 at map Y 1683", () =>
    expect(sheetToMap({ x: 10, y: 264 }).y).toBe(1683));
});

describe("snapping", () => {
  const { walls } = buildWalls(DEMO_ZONES, DEMO_OPENINGS);
  const s = { x_in: 213.4, y_in: 401.2, rotation_deg: 0, width_in: 48, depth_in: 24 };
  it("1 ft grid", () =>
    expect(snapPlacement(s, { grid: 12, segments: [], points: [] })).toMatchObject({ x_in: 216, y_in: 396 }));
  it("6 in and 1 in grids; off leaves it alone (rounded to 1/16)", () => {
    expect(snapPlacement(s, { grid: 6, segments: [], points: [] })).toMatchObject({ x_in: 216, y_in: 402 });
    expect(snapPlacement(s, { grid: 1, segments: [], points: [] })).toMatchObject({ x_in: 213, y_in: 401 });
    expect(snapPlacement(s, { grid: 0, segments: [], points: [] })).toMatchObject({ x_in: 213.375, y_in: 401.1875 });
  });
  it('pulls a unit 2.5" off the west wall back flush', () => {
    const u = { x_in: 26.5, y_in: 500, rotation_deg: 270, width_in: 48, depth_in: 24 };
    const r = snapPlacement(u, { grid: 0, ...snapTargets([], walls) });
    expect(r.x_in).toBe(24);
    expect(r.snapped).toContain("wall");
  });
  it("lines a unit up end-to-end with A1 (corner to corner)", () => {
    const a1 = DEMO_SHELVES.find((x) => x.name === "A1")!;
    // A1 spans Y 864..960 on the west wall; drop a 48" unit 3" north of it.
    const u = { x_in: 24, y_in: 861, rotation_deg: 270, width_in: 48, depth_in: 24 };
    const r = snapPlacement(u, { grid: 12, ...snapTargets([a1], walls) });
    expect(r).toMatchObject({ x_in: 24, y_in: 864 });
  });
  it("back-to-back: snaps the back face onto another unit's back", () => {
    const a = { shelf_id: "a", x_in: 100, y_in: 524, rotation_deg: 0, width_in: 48, depth_in: 24 }; // back on Y 500
    const b = { x_in: 148, y_in: 477, rotation_deg: 180, width_in: 48, depth_in: 24 }; // back on Y 501 -> 500
    const r = snapPlacement(b, { grid: 0, ...snapTargets([a], []) });
    expect(r).toMatchObject({ x_in: 148, y_in: 476 });
  });
});

describe("slots: overlap and out of bounds", () => {
  const grid = {
    cols: 12,
    rows: [0, 1, 2].map((i) => ({
      row_index: i,
      row_label: i ? String(i) : "G",
      elevation_in: 4 + i * 20,
      clear_height_in: 19,
    })),
  };
  const slots = [
    { slot_id: "a", row_index: 0, col_start: 1, width_span: 2, height_span: 1 },
    { slot_id: "b", row_index: 0, col_start: 5, width_span: 3, height_span: 2 },
  ];
  it("finds overlaps (and ignores the slot being resized)", () => {
    expect(
      overlappingSlots(slots, { row_index: 1, col_start: 6, width_span: 1, height_span: 1 }).map((s) => s.slot_id),
    ).toEqual(["b"]);
    expect(overlappingSlots(slots, { row_index: 0, col_start: 3, width_span: 2, height_span: 1 })).toEqual([]);
    expect(
      overlappingSlots(slots, { row_index: 0, col_start: 1, width_span: 5, height_span: 1 }, "a").map((s) => s.slot_id),
    ).toEqual(["b"]);
  });
  it("explains slot_out_of_bounds", () => {
    expect(slotBoundsProblem({ ...grid, cols: 6 }, slots[1])).toMatch(/columns 5–7; the shelf has 6/);
    expect(slotBoundsProblem({ ...grid, rows: grid.rows.slice(0, 1) }, slots[1])).toMatch(/2 row/);
    expect(slotBoundsProblem(grid, slots[1])).toBeNull();
  });
});

describe("aisle width", () => {
  const a = { shelf_id: "a", name: "A", x_in: 0, y_in: 24, rotation_deg: 0, width_in: 96, depth_in: 24 }; // front on Y 24, faces south
  const b = { shelf_id: "b", name: "B", x_in: 96, y_in: 54, rotation_deg: 180, width_in: 96, depth_in: 24 }; // front on Y 54, faces north
  it("measures the clear aisle to the facing unit", () => {
    expect(aisleWidth(a, [b])).toEqual({ width: 30, facing: b });
    expect(aisleWidth(b, [a])?.width).toBe(30);
  });
  it("is null with nothing in front", () => expect(aisleWidth(a, [])).toBeNull());
  it('warns below the 36" default, never blocks', () => {
    const w = shelfWarnings(
      { ...a, height_in: 84, zone_id: null },
      {
        shelves: [
          { ...a, height_in: 84, zone_id: null },
          { ...b, height_in: 84, zone_id: null },
        ],
        zones: [],
        openings: [],
      },
    );
    expect(w.find((x) => x.kind === "aisle")?.message).toMatch(/2'-6"/);
  });
});

describe("warnings", () => {
  const zones = DEMO_ZONES;
  const openings = DEMO_OPENINGS;
  const ctx = (s: object) => ({ shelves: [s as never], zones, openings });
  it("high-pile reminder in WAREHOUSE 126 above 12'", () => {
    const tall = {
      shelf_id: "t",
      name: "T",
      x_in: 200,
      y_in: 400,
      rotation_deg: 0,
      width_in: 48,
      depth_in: 24,
      height_in: 168,
      zone_id: W126.zone_id,
    };
    expect(shelfWarnings(tall, ctx(tall)).map((w) => w.kind)).toContain("high_pile");
    expect(shelfWarnings({ ...tall, height_in: 120 }, ctx(tall)).map((w) => w.kind)).not.toContain("high_pile");
  });
  it("blocking overhead door 36's clearance", () => {
    const s = {
      shelf_id: "o",
      name: "O",
      x_in: 24,
      y_in: 640,
      rotation_deg: 270,
      width_in: 48,
      depth_in: 24,
      height_in: 84,
      zone_id: W126.zone_id,
    };
    expect(shelfWarnings(s, ctx(s)).find((w) => w.kind === "opening")?.message).toMatch(/overhead door 36/);
  });
  it("outside every zone (office side)", () => {
    const s = {
      shelf_id: "x",
      name: "X",
      x_in: 0,
      y_in: 300,
      rotation_deg: 0,
      width_in: 48,
      depth_in: 24,
      height_in: 84,
      zone_id: null,
    };
    expect(insideAnyZone(zones, { ...s, x_in: 10 })).toBe(true);
    expect(insideAnyZone(zones, { ...s, x_in: -30 })).toBe(false);
  });
});

describe("walls, walking, fit", () => {
  it("cuts overhead door 36 out of the west wall and adds no lintel over overhead doors", () => {
    const { walls, pieces } = buildWalls(DEMO_ZONES, DEMO_OPENINGS);
    const west = walls.filter((w) => w.x1 === 0 && w.x2 === 0);
    expect(west.some((w) => Math.min(w.y1, w.y2) <= 529.5 && Math.max(w.y1, w.y2) >= 697.5)).toBe(false);
    expect(pieces.find((p) => p.opening.tag === "36")!.lintel).toBeNull();
    expect(pieces.find((p) => p.opening.tag === "40")!.lintel).not.toBeNull();
  });
  it("walking can't pass through a wall", () => {
    const segs = [{ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }];
    const p = collideMove({ x: 20, y: 50 }, { x: -20, y: 50 }, 9, segs);
    expect(p.x).toBeGreaterThan(0);
  });
  it("fit check by bounding box", () => {
    // best of six orientations: 15/1.25 x 7/1 x 18/1.25 -> 12 x 7 x 14
    expect(fitCount({ w: 15, h: 7, d: 18 }, { w: 1.25, h: 1.25, d: 1 })).toBe(12 * 7 * 14);
    expect(fitCount({ w: 15, h: 7, d: 18 }, { w: 20, h: 8, d: 30 })).toBe(0);
  });
});
