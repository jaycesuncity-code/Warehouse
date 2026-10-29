/**
 * Pure model for the mini floor plan: zone outlines, openings and shelves in map inches, with the
 * focused shelf's zone framed. The React component only draws what this returns, so geometry can be
 * tested without a browser.
 */
import type { Layout, Point } from '../shared/contract';
import { shelfCorners, shelfLocalToMap, slotFootprintOnMap } from '../shared/units';

export interface PlanZone {
  zone_id: string;
  name: string;
  room_no: string | null;
  points: Point[];
  open_edges: number[];
  focus: boolean;
  /** [minX, minY, maxX, maxY] */
  bbox: [number, number, number, number];
}

export interface PlanShelf {
  shelf_id: string;
  name: string;
  /** front-left, front-right, back-right, back-left */
  points: Point[];
  /** The front edge (where you stand). */
  front: [Point, Point];
  focus: boolean;
}

export interface FloorPlanModel {
  viewBox: { x: number; y: number; w: number; h: number };
  zones: PlanZone[];
  openings: { opening_id: string; kind: string; tag: string | null; a: Point; b: Point }[];
  shelves: PlanShelf[];
  marker: Point | null;
  focusZoneName: string | null;
}

export function bboxOf(points: Point[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function buildFloorPlan(
  layout: Layout,
  shelfId: string,
  slotId?: string | null,
  pad = 110,
): FloorPlanModel {
  const focusShelf = layout.shelves.find((s) => s.shelf_id === shelfId);
  const zones: PlanZone[] = layout.zones.map((z) => ({
    zone_id: z.zone_id,
    name: z.name,
    room_no: z.room_no,
    points: z.polygon_in,
    open_edges: z.open_edges,
    focus: z.zone_id === focusShelf?.zone_id,
    bbox: bboxOf(z.polygon_in),
  }));
  const focusZone = zones.find((z) => z.focus) ?? null;
  const frame =
    focusZone?.bbox ??
    (zones.length
      ? bboxOf(zones.flatMap((z) => z.points))
      : ([0, 0, 480, 1200] as [number, number, number, number]));

  const shelves: PlanShelf[] = layout.shelves.map((s) => {
    const pts = shelfCorners(s);
    return {
      shelf_id: s.shelf_id,
      name: s.name,
      points: pts,
      front: [pts[0], pts[1]],
      focus: s.shelf_id === shelfId,
    };
  });

  let marker: Point | null = null;
  if (focusShelf) {
    const slot = slotId ? focusShelf.slots.find((x) => x.slot_id === slotId) : undefined;
    if (slot) {
      const fp = slotFootprintOnMap(focusShelf, slot);
      marker = [fp.reduce((n, p) => n + p[0], 0) / fp.length, fp.reduce((n, p) => n + p[1], 0) / fp.length];
    } else {
      marker = shelfLocalToMap(focusShelf, focusShelf.width_in / 2, focusShelf.depth_in / 2);
    }
  }

  return {
    viewBox: {
      x: frame[0] - pad,
      y: frame[1] - pad,
      w: frame[2] - frame[0] + pad * 2,
      h: frame[3] - frame[1] + pad * 2,
    },
    zones,
    openings: layout.openings.map((o) => ({
      opening_id: o.opening_id,
      kind: o.kind,
      tag: o.tag,
      a: [o.x1_in, o.y1_in],
      b: [o.x2_in, o.y2_in],
    })),
    shelves,
    marker,
    focusZoneName: focusZone?.name ?? null,
  };
}
