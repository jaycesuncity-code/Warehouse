// Pure floor-plan geometry for the map (map inches; X east, Y south). No three.js here.

import type { Opening, Point, ShelfBase, Zone } from "../shared/contract";
import {
  DEFAULT_WALL_HEIGHT_IN,
  formatFtIn,
  frontDir,
  normalizeDeg,
  rotationForFront,
  round16,
  shelfCenter,
  shelfCorners,
  shelfToMap,
  widthDir,
} from "./units";

export type Vec = { x: number; y: number };
type Footprint = Pick<ShelfBase, "x_in" | "y_in" | "rotation_deg" | "width_in" | "depth_in">;

const EPS = 1e-6;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const P = (p: Point): Vec => ({ x: p[0], y: p[1] });

// ---------------------------------------------------------------------------
// Polygons and zones
// ---------------------------------------------------------------------------

export function pointInPolygon(p: Vec, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polygonBounds(poly: Point[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function polygonCentroid(poly: Point[]): Vec {
  // Area-weighted centroid; falls back to the mean for degenerate shapes.
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < EPS)
    return { x: poly.reduce((s, p) => s + p[0], 0) / poly.length, y: poly.reduce((s, p) => s + p[1], 0) / poly.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** A label point inside the polygon (centroid if inside, else the widest interior point on a scanline). */
export function labelPoint(poly: Point[]): Vec {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = polygonBounds(poly);
  let best: Vec = c;
  let bestW = -1;
  for (let k = 1; k < 20; k++) {
    const y = b.minY + ((b.maxY - b.minY) * k) / 20;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b2) => a - b2);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > bestW) {
        bestW = xs[i + 1] - xs[i];
        best = { x: (xs[i] + xs[i + 1]) / 2, y };
      }
    }
  }
  return best;
}

/** Smallest zone containing the point (zones may nest or touch). */
export function zoneAt(zones: Zone[], p: Vec): Zone | null {
  let best: Zone | null = null;
  let bestArea = Infinity;
  for (const z of zones) {
    if (pointInPolygon(p, z.polygon_in)) {
      const a = polygonArea(z.polygon_in);
      if (a < bestArea) {
        best = z;
        bestArea = a;
      }
    }
  }
  return best;
}

export function zoneForShelf(zones: Zone[], shelf: Footprint): Zone | null {
  return zoneAt(zones, shelfCenter(shelf));
}

// ---------------------------------------------------------------------------
// Edges and walls
// ---------------------------------------------------------------------------

export interface ZoneEdge {
  index: number;
  a: Vec;
  b: Vec;
  length: number;
  inward: Vec; // unit normal pointing into the zone
  name: string; // "west wall", "north wall" …
  startName: string; // compass name of the start end ("S end")
  endName: string;
  open: boolean;
}

function compass(v: Vec): "north" | "south" | "east" | "west" | null {
  if (Math.abs(v.x) < 0.05 && v.y < 0) return "north";
  if (Math.abs(v.x) < 0.05 && v.y > 0) return "south";
  if (Math.abs(v.y) < 0.05 && v.x > 0) return "east";
  if (Math.abs(v.y) < 0.05 && v.x < 0) return "west";
  return null;
}

export function zoneEdges(zone: Zone): ZoneEdge[] {
  const poly = zone.polygon_in;
  return poly.map((p, i) => {
    const a = P(p);
    const b = P(poly[(i + 1) % poly.length]);
    const d = norm(sub(b, a));
    let n: Vec = { x: -d.y, y: d.x };
    const mid = mul(add(a, b), 0.5);
    if (!pointInPolygon(add(mid, mul(n, 1)), poly)) n = mul(n, -1);
    // The wall sits on the side opposite the inward normal ("west wall" faces east into the room).
    const side = compass(mul(n, -1));
    const name = side ? `${side} wall` : `edge ${i}`;
    const startSide = compass(norm(sub(a, b)));
    const endSide = compass(norm(sub(b, a)));
    const short = (s: string | null) => (s ? `${s[0].toUpperCase()} end` : null);
    return {
      index: i,
      a,
      b,
      length: len(sub(b, a)),
      inward: n,
      name,
      startName: short(startSide) ?? "start",
      endName: short(endSide) ?? "end",
      open: zone.open_edges.includes(i),
    };
  });
}

export interface WallSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  height: number;
}

export interface OpeningPiece {
  opening: Opening;
  /** Lintel from opening height to wall height (doors only). */
  lintel: WallSeg | null;
}

/**
 * Wall segments for drawing and collision: every walled zone edge, merged where zones share a
 * wall, with opening gaps cut out. Lintels are added above doors only.
 */
export function buildWalls(
  zones: Zone[],
  openings: Opening[],
  defaultHeight = DEFAULT_WALL_HEIGHT_IN,
): { walls: WallSeg[]; pieces: OpeningPiece[] } {
  type Line = { dir: Vec; off: number; intervals: [number, number, number][] }; // [t0, t1, height]
  const lines = new Map<string, Line>();
  const keyFor = (a: Vec, b: Vec) => {
    let d = norm(sub(b, a));
    if (d.x < -EPS || (Math.abs(d.x) < EPS && d.y < 0)) d = mul(d, -1);
    const off = cross(d, a);
    return { key: `${d.x.toFixed(4)},${d.y.toFixed(4)}|${off.toFixed(2)}`, d, off };
  };
  for (const z of zones) {
    const h = z.wall_height_in ?? defaultHeight;
    const poly = z.polygon_in;
    for (let i = 0; i < poly.length; i++) {
      if (z.open_edges.includes(i)) continue;
      const a = P(poly[i]);
      const b = P(poly[(i + 1) % poly.length]);
      if (len(sub(b, a)) < EPS) continue;
      const { key, d, off } = keyFor(a, b);
      const t0 = dot(d, a);
      const t1 = dot(d, b);
      const line = lines.get(key) ?? { dir: d, off, intervals: [] };
      line.intervals.push([Math.min(t0, t1), Math.max(t0, t1), h]);
      lines.set(key, line);
    }
  }
  const walls: WallSeg[] = [];
  const pieces: OpeningPiece[] = openings.map((o) => ({ opening: o, lintel: null }));
  for (const line of lines.values()) {
    // union intervals (keep the tallest height where they overlap)
    const iv = line.intervals.sort((p, q) => p[0] - q[0]);
    const merged: [number, number, number][] = [];
    for (const cur of iv) {
      const last = merged[merged.length - 1];
      if (last && cur[0] <= last[1] + 0.01) {
        last[1] = Math.max(last[1], cur[1]);
        last[2] = Math.max(last[2], cur[2]);
      } else merged.push([...cur]);
    }
    // openings lying on this line
    const cuts: [number, number, OpeningPiece][] = [];
    for (const pc of pieces) {
      const o = pc.opening;
      const a = { x: o.x1_in, y: o.y1_in };
      const b = { x: o.x2_in, y: o.y2_in };
      const dist = (p: Vec) => Math.abs(cross(line.dir, p) - line.off);
      if (dist(a) > 1 || dist(b) > 1) continue;
      const t0 = dot(line.dir, a);
      const t1 = dot(line.dir, b);
      cuts.push([Math.min(t0, t1), Math.max(t0, t1), pc]);
    }
    const n: Vec = { x: -line.dir.y, y: line.dir.x };
    const at = (t: number): Vec => add(mul(line.dir, t), mul(n, line.off * (cross(line.dir, n) > 0 ? 1 : -1)));
    for (const [s0, s1, h] of merged) {
      let pieces2: [number, number][] = [[s0, s1]];
      for (const [c0, c1, pc] of cuts) {
        if (c1 <= s0 || c0 >= s1) continue;
        if (pc.opening.kind === "door" && pc.opening.height_in < h) {
          const pa = at(Math.max(c0, s0));
          const pb = at(Math.min(c1, s1));
          pc.lintel = { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, height: h };
        }
        pieces2 = pieces2.flatMap(([a, b]) => {
          const out: [number, number][] = [];
          if (c0 > a) out.push([a, Math.min(c0, b)]);
          if (c1 < b) out.push([Math.max(c1, a), b]);
          return out;
        });
      }
      for (const [a, b] of pieces2) {
        if (b - a < 0.25) continue;
        const pa = at(a);
        const pb = at(b);
        walls.push({ x1: round16(pa.x), y1: round16(pa.y), x2: round16(pb.x), y2: round16(pb.y), height: h });
      }
    }
  }
  return { walls, pieces };
}

// ---------------------------------------------------------------------------
// Shelf footprints, overlap, warnings
// ---------------------------------------------------------------------------

export function footprint(s: Footprint): Vec[] {
  return shelfCorners(s).map(P);
}

function project(poly: Vec[], axis: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** Overlap depth of two convex polygons (SAT). 0 when they only touch or are apart. */
export function overlapDepth(a: Vec[], b: Vec[]): number {
  let minDepth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const axis = norm({ x: -e.y, y: e.x });
      const [a0, a1] = project(a, axis);
      const [b0, b1] = project(b, axis);
      const d = Math.min(a1, b1) - Math.max(a0, b0);
      if (d <= 0) return 0;
      minDepth = Math.min(minDepth, d);
    }
  }
  return minDepth;
}

export function shelvesOverlap(a: Footprint, b: Footprint, tolerance = 0.25): boolean {
  return overlapDepth(footprint(a), footprint(b)) > tolerance;
}

/** True when every corner (nudged ½" inward) and the centre is inside some zone. */
export function insideAnyZone(zones: Zone[], s: Footprint): boolean {
  const c = shelfCenter(s);
  const pts = footprint(s).map((p) => add(p, mul(norm(sub(c, p)), 0.5)));
  return [c, ...pts].every((p) => zones.some((z) => pointInPolygon(p, z.polygon_in)));
}

export interface ClearanceConfig {
  door: number;
  overhead: number;
  opening: number;
}
export const DEFAULT_CLEARANCE: ClearanceConfig = { door: 36, overhead: 120, opening: 36 };

/** Rectangle kept clear on both sides of an opening (swing / overhead door approach). */
export function openingClearance(o: Opening, cfg: ClearanceConfig = DEFAULT_CLEARANCE): Vec[] {
  const a = { x: o.x1_in, y: o.y1_in };
  const b = { x: o.x2_in, y: o.y2_in };
  const d = norm(sub(b, a));
  const n = { x: -d.y, y: d.x };
  const depth = cfg[o.kind] ?? 36;
  return [add(a, mul(n, depth)), add(b, mul(n, depth)), add(b, mul(n, -depth)), add(a, mul(n, -depth))];
}

function raySegment(origin: Vec, dir: Vec, a: Vec, b: Vec): number | null {
  const e = sub(b, a);
  const den = cross(dir, e);
  if (Math.abs(den) < EPS) return null;
  const w = sub(a, origin);
  const t = cross(w, e) / den;
  const s = cross(w, dir) / den;
  if (t > EPS && s >= -EPS && s <= 1 + EPS) return t;
  return null;
}

/**
 * Clear aisle in front of a shelf: rays from points along the front face, straight out, to the
 * nearest other shelf. Returns the narrowest distance and the facing shelf, or null if open.
 */
export function aisleWidth<T extends Footprint & { shelf_id: string }>(
  shelf: Footprint,
  others: T[],
  maxIn = 240,
): { width: number; facing: T } | null {
  const f = frontDir(shelf.rotation_deg);
  let best: { width: number; facing: T } | null = null;
  const samples = 7;
  for (let k = 0; k < samples; k++) {
    const u = (shelf.width_in * (k + 0.5)) / samples;
    const o0 = shelfToMap(shelf, u, 0);
    const origin = { x: o0.x, y: o0.y };
    for (const other of others) {
      const poly = footprint(other);
      for (let i = 0; i < 4; i++) {
        const t = raySegment(origin, f, poly[i], poly[(i + 1) % 4]);
        if (t != null && t <= maxIn && (!best || t < best.width - EPS)) best = { width: round16(t), facing: other };
      }
    }
  }
  return best;
}

export interface WarningConfig {
  minAisleIn: number;
  highPileIn: number;
  clearance: ClearanceConfig;
}
export const DEFAULT_WARNINGS: WarningConfig = { minAisleIn: 36, highPileIn: 144, clearance: DEFAULT_CLEARANCE };

export interface ShelfWarning {
  kind: "overlap" | "outside" | "opening" | "aisle" | "high_pile";
  message: string;
}

export function shelfWarnings<
  T extends Footprint & { shelf_id: string; name: string; height_in: number; zone_id: string | null },
>(
  shelf: T,
  ctx: { shelves: T[]; zones: Zone[]; openings: Opening[] },
  cfg: WarningConfig = DEFAULT_WARNINGS,
): ShelfWarning[] {
  const out: ShelfWarning[] = [];
  const fp = footprint(shelf);
  const others = ctx.shelves.filter((s) => s.shelf_id !== shelf.shelf_id);
  const overl = others.filter((o) => overlapDepth(fp, footprint(o)) > 0.25);
  if (overl.length) out.push({ kind: "overlap", message: `Overlaps ${overl.map((o) => o.name).join(", ")}` });
  if (!insideAnyZone(ctx.zones, shelf)) out.push({ kind: "outside", message: "Not fully inside a zone" });
  for (const o of ctx.openings) {
    if (overlapDepth(fp, openingClearance(o, cfg.clearance)) > 0.25) {
      out.push({
        kind: "opening",
        message: `Blocks ${o.kind === "overhead" ? "overhead door" : o.kind} ${o.tag} (clearance ${formatFtIn(cfg.clearance[o.kind])})`,
      });
    }
  }
  const aisle = aisleWidth(shelf, others);
  if (aisle && aisle.width < cfg.minAisleIn)
    out.push({
      kind: "aisle",
      message: `Aisle to ${aisle.facing.name} is ${formatFtIn(aisle.width)} (min ${formatFtIn(cfg.minAisleIn)})`,
    });
  const zone = ctx.zones.find((z) => z.zone_id === shelf.zone_id) ?? zoneForShelf(ctx.zones, shelf);
  if (zone && /high-pile/i.test(zone.notes) && shelf.height_in > cfg.highPileIn)
    out.push({
      kind: "high_pile",
      message: `${zone.name}: "${zone.notes}". This unit is ${formatFtIn(shelf.height_in)} tall (reminder above ${formatFtIn(cfg.highPileIn)}; not a code check)`,
    });
  return out;
}

// ---------------------------------------------------------------------------
// Place from wall (Jayce's paper measurement log)
// ---------------------------------------------------------------------------

export interface PlaceFromWallInput {
  zone: Zone;
  edgeIndex: number;
  fromEnd: "start" | "end";
  /** Along the wall, from the chosen end to the nearest end of the unit. */
  offsetIn: number;
  /** Gap between the wall and the back of the unit (0 = against the wall). */
  gapIn: number;
  width_in: number;
  depth_in: number;
}

export function placeFromWall(i: PlaceFromWallInput): {
  x_in: number;
  y_in: number;
  rotation_deg: number;
  wall_ref: string;
} {
  const edge = zoneEdges(i.zone)[i.edgeIndex];
  if (!edge) throw new Error("No such wall");
  const along = norm(sub(edge.b, edge.a));
  const origin = i.fromEnd === "start" ? edge.a : edge.b;
  const dirFromEnd = i.fromEnd === "start" ? along : mul(along, -1);
  const rotation_deg = rotationForFront(edge.inward.x, edge.inward.y);
  const u = widthDir(rotation_deg);
  // The unit spans [offset, offset + width] along the wall measured from the chosen end.
  const sNear = i.offsetIn;
  const sFar = i.offsetIn + i.width_in;
  // Left end (u = 0) is whichever end the width direction starts from.
  const leftS = dot(u, dirFromEnd) > 0 ? sNear : sFar;
  const backLeft = add(add(origin, mul(dirFromEnd, leftS)), mul(edge.inward, i.gapIn));
  const frontLeft = add(backLeft, mul(edge.inward, i.depth_in));
  const endName = i.fromEnd === "start" ? edge.startName : edge.endName;
  return {
    x_in: round16(frontLeft.x),
    y_in: round16(frontLeft.y),
    rotation_deg: normalizeDeg(rotation_deg),
    wall_ref: `${i.zone.name} ${edge.name}, ${formatFtIn(i.offsetIn)} from ${endName}, ${i.gapIn > 0 ? `${formatFtIn(i.gapIn)} off the wall` : "against the wall"}`,
  };
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export type SnapGrid = 0 | 1 | 6 | 12;

export interface SnapContext {
  grid: SnapGrid;
  /** Edges of other shelves and walls to snap to. */
  segments: { a: Vec; b: Vec; label: string }[];
  /** Corners of other shelves. */
  points: { p: Vec; label: string }[];
  threshold?: number; // inches
}

export function snapTargets(others: Footprint[], walls: WallSeg[]): Pick<SnapContext, "segments" | "points"> {
  const segments: SnapContext["segments"] = [];
  const points: SnapContext["points"] = [];
  for (const o of others) {
    const fp = footprint(o);
    fp.forEach((p, i) => {
      points.push({ p, label: "shelf corner" });
      segments.push({ a: p, b: fp[(i + 1) % 4], label: "shelf edge" });
    });
  }
  for (const w of walls) segments.push({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 }, label: "wall" });
  return { segments, points };
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const e = sub(b, a);
  const l2 = dot(e, e);
  if (l2 < EPS) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / l2));
  return add(a, mul(e, t));
}

const roundTo = (v: number, step: number) => (step ? Math.round(v / step) * step : v);

/**
 * Snaps a shelf placement. Priority: corner-to-corner (end-to-end / back-to-back line-ups), then
 * up to two non-parallel edge/wall lines, then the grid. Returns the adjusted front-left corner.
 */
export function snapPlacement(s: Footprint, ctx: SnapContext): { x_in: number; y_in: number; snapped: string | null } {
  const th = ctx.threshold ?? 4;
  let pos = { x: s.x_in, y: s.y_in };
  const corners = (p: Vec) => footprint({ ...s, x_in: p.x, y_in: p.y });

  // 1) corner to corner
  let best: { d: number; delta: Vec; label: string } | null = null;
  for (const c of corners(pos)) {
    for (const t of ctx.points) {
      const d = len(sub(t.p, c));
      if (d < th && (!best || d < best.d)) best = { d, delta: sub(t.p, c), label: t.label };
    }
  }
  if (best) {
    pos = add(pos, best.delta);
    return { x_in: round16(pos.x), y_in: round16(pos.y), snapped: best.label };
  }

  // 2) edges / walls (up to two non-parallel lines)
  const used: Vec[] = [];
  const labels: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    let bestLine: { d: number; delta: Vec; dir: Vec; label: string } | null = null;
    for (const c of corners(pos)) {
      for (const seg of ctx.segments) {
        const dir = norm(sub(seg.b, seg.a));
        if (used.some((u) => Math.abs(cross(u, dir)) < 0.17)) continue; // parallel to a line we already snapped to
        const q = closestOnSegment(c, seg.a, seg.b);
        const d = len(sub(q, c));
        if (d < th && d > EPS && (!bestLine || d < bestLine.d))
          bestLine = { d, delta: sub(q, c), dir, label: seg.label };
        if (d <= EPS && (!bestLine || 0 < bestLine.d))
          bestLine = { d: 0, delta: { x: 0, y: 0 }, dir, label: seg.label };
      }
    }
    if (!bestLine) break;
    pos = add(pos, bestLine.delta);
    used.push(bestLine.dir);
    labels.push(bestLine.label);
  }
  if (used.length === 1 && ctx.grid) {
    // Grid-snap along the line we're sliding on (axis-aligned lines only).
    const d = used[0];
    if (Math.abs(d.y) < 0.01) pos.x = roundTo(pos.x, ctx.grid);
    else if (Math.abs(d.x) < 0.01) pos.y = roundTo(pos.y, ctx.grid);
  }
  if (used.length) return { x_in: round16(pos.x), y_in: round16(pos.y), snapped: labels.join(" + ") };

  // 3) grid
  if (ctx.grid)
    return { x_in: round16(roundTo(pos.x, ctx.grid)), y_in: round16(roundTo(pos.y, ctx.grid)), snapped: null };
  return { x_in: round16(pos.x), y_in: round16(pos.y), snapped: null };
}

// ---------------------------------------------------------------------------
// Walk-mode collision
// ---------------------------------------------------------------------------

export type Seg = { a: Vec; b: Vec };

export function collisionSegments(walls: WallSeg[], shelves: Footprint[]): Seg[] {
  const segs: Seg[] = walls.map((w) => ({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } }));
  for (const s of shelves) {
    const fp = footprint(s);
    for (let i = 0; i < 4; i++) segs.push({ a: fp[i], b: fp[(i + 1) % 4] });
  }
  return segs;
}

/** Moves from `from` toward `to`, sliding along walls/shelves so a circle of `radius` never crosses them. */
export function collideMove(from: Vec, to: Vec, radius: number, segs: Seg[]): Vec {
  const delta = sub(to, from);
  // A slow running frame can cross a wall before endpoint projection runs. Resolve small steps
  // from the approaching side so contact is reached and tangential movement is preserved.
  // Normal walk frames need at most four steps; retain bounded work for an unexpectedly large move.
  const steps = Math.min(64, Math.max(1, Math.ceil(len(delta) / Math.max(radius / 2, 0.5))));
  if (steps === 1) return collideStep(from, to, radius, segs);
  const step = mul(delta, 1 / steps);
  let position = from;
  let adjusted = false;
  for (let index = 0; index < steps; index++) {
    const target = add(position, step);
    const next = collideStep(position, target, radius, segs);
    adjusted ||= next.x !== target.x || next.y !== target.y;
    position = next;
  }
  // An unobstructed path ends at its exact requested point, without accumulated rounding drift.
  return adjusted ? position : to;
}

function collideStep(from: Vec, to: Vec, radius: number, segs: Seg[]): Vec {
  let p = { ...to };
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of segs) {
      const q = closestOnSegment(p, s.a, s.b);
      const d = len(sub(p, q));
      if (d < radius) {
        const n = d > EPS ? norm(sub(p, q)) : norm(sub(from, q));
        p = add(q, mul(n, radius + 0.01));
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Don't tunnel through thin walls on big steps: if the straight path crosses a segment, stay put.
  for (const s of segs) {
    const e = sub(s.b, s.a);
    const dp = sub(p, from);
    const den = cross(dp, e);
    if (Math.abs(den) < EPS) continue;
    const w = sub(s.a, from);
    const t = cross(w, e) / den;
    const u = cross(w, dp) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) return from;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Fit checks
// ---------------------------------------------------------------------------

/** How many parts fit in a box by bounding box (best of the six orientations). */
export function fitCount(box: { w: number; h: number; d: number }, part: { w: number; h: number; d: number }): number {
  const perms: [number, number, number][] = [
    [part.w, part.h, part.d],
    [part.w, part.d, part.h],
    [part.h, part.w, part.d],
    [part.h, part.d, part.w],
    [part.d, part.w, part.h],
    [part.d, part.h, part.w],
  ];
  let best = 0;
  for (const [a, b, c] of perms) {
    if (a <= 0 || b <= 0 || c <= 0) continue;
    const n = Math.floor(box.w / a + EPS) * Math.floor(box.h / b + EPS) * Math.floor(box.d / c + EPS);
    best = Math.max(best, n);
  }
  return best;
}

export function boxFits(box: { w: number; h: number; d: number }, inner: { w: number; h: number; d: number }): boolean {
  return fitCount(box, inner) >= 1;
}

export { shelfCenter, shelfCorners };
