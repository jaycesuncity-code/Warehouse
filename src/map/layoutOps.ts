// Pure helpers that patch the locally cached layout after a write, so the map never refetches
// the whole layout after an edit (handoff: "patch the local copy after each write").

import type { Layout, LayoutShelf, LayoutSlot, Opening, Shelf, ShelfBase, Slot, Zone } from "../shared/contract";

export type DeptLookup = (partId: string) => string | undefined;

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Full slot (with parts) -> layout summary slot. Keeps known departments when lookups miss. */
type Extra = { event_id?: string | null; shelf_id?: string };

export function slotSummary(slot: Slot & Extra, prev?: LayoutSlot, dept?: DeptLookup): LayoutSlot {
  const { parts, shelf_id: _s, event_id: _e, ...base } = slot;
  const part_ids = parts.map((p) => p.part_id);
  const on_hand_total = parts.reduce((a, p) => a + p.on_hand_qty, 0);
  const par_total = parts.reduce((a, p) => a + p.par_qty, 0);
  const departments = new Set<string>();
  for (const id of part_ids) {
    const d = dept?.(id);
    if (d) departments.add(d);
  }
  if (!departments.size && prev && sameIds(prev.part_ids, part_ids))
    prev.departments.forEach((d) => departments.add(d));
  return {
    ...(base as Omit<Slot, "parts">),
    part_count: parts.length,
    on_hand_total,
    par_total,
    low: parts.length > 0 && on_hand_total < par_total,
    part_ids,
    departments: [...departments],
  };
}

/** Full shelf (GET /api/shelves/:id or a write response) -> layout shelf. */
export function toLayoutShelf(shelf: Shelf & Extra, prev?: LayoutShelf, dept?: DeptLookup): LayoutShelf {
  const { slots, event_id: _e, ...base } = shelf;
  const prevSlots = new Map((prev?.slots ?? []).map((s) => [s.slot_id, s]));
  return {
    ...(base as ShelfBase),
    slots: slots.map((s) => slotSummary(s, prevSlots.get(s.slot_id), dept)),
  };
}

export function upsertShelf(layout: Layout, shelf: LayoutShelf, replaceId?: string): Layout {
  const id = replaceId ?? shelf.shelf_id;
  const i = layout.shelves.findIndex((s) => s.shelf_id === id);
  const shelves = layout.shelves.slice();
  if (i >= 0) shelves[i] = shelf;
  else shelves.push(shelf);
  return { ...layout, shelves };
}

export function removeShelf(layout: Layout, shelfId: string): Layout {
  return { ...layout, shelves: layout.shelves.filter((s) => s.shelf_id !== shelfId) };
}

export function patchShelfFields(layout: Layout, shelfId: string, fields: Partial<ShelfBase>): Layout {
  return { ...layout, shelves: layout.shelves.map((s) => (s.shelf_id === shelfId ? { ...s, ...fields } : s)) };
}

const slotOrder = (a: LayoutSlot, b: LayoutSlot) => a.row_index - b.row_index || a.col_start - b.col_start;

export function upsertSlot(layout: Layout, shelfId: string, slot: LayoutSlot, replaceId?: string): Layout {
  return {
    ...layout,
    shelves: layout.shelves.map((s) => {
      if (s.shelf_id !== shelfId) return s;
      const id = replaceId ?? slot.slot_id;
      const has = s.slots.some((x) => x.slot_id === id);
      const slots = has ? s.slots.map((x) => (x.slot_id === id ? slot : x)) : [...s.slots, slot];
      return { ...s, slots: slots.sort(slotOrder) };
    }),
  };
}

export function removeSlot(layout: Layout, shelfId: string, slotId: string): Layout {
  return {
    ...layout,
    shelves: layout.shelves.map((s) =>
      s.shelf_id === shelfId ? { ...s, slots: s.slots.filter((x) => x.slot_id !== slotId) } : s,
    ),
  };
}

export function upsertZone(layout: Layout, zone: Zone & Extra): Layout {
  const { event_id: _e, ...z } = zone;
  const has = layout.zones.some((x) => x.zone_id === z.zone_id);
  return {
    ...layout,
    zones: has ? layout.zones.map((x) => (x.zone_id === z.zone_id ? z : x)) : [...layout.zones, z as Zone],
  };
}

export function upsertOpening(layout: Layout, opening: Opening & Extra): Layout {
  const { event_id: _e, ...o } = opening;
  const has = layout.openings.some((x) => x.opening_id === o.opening_id);
  return {
    ...layout,
    openings: has
      ? layout.openings.map((x) => (x.opening_id === o.opening_id ? o : x))
      : [...layout.openings, o as Opening],
  };
}

/** Department per part, learned from layout slots that hold exactly one part. */
export function learnDepartments(layout: Layout, into: Record<string, string> = {}): Record<string, string> {
  for (const sh of layout.shelves)
    for (const sl of sh.slots)
      if (sl.part_ids.length === 1 && sl.departments.length === 1) into[sl.part_ids[0]] = sl.departments[0];
  return into;
}

/** Bounds of a set of shelves in map inches (for camera fitting). */
export function shelvesBounds(
  shelves: Pick<ShelfBase, "x_in" | "y_in" | "rotation_deg" | "width_in" | "depth_in">[],
  corners: (s: (typeof shelves)[number]) => [number, number][],
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shelves)
    for (const [x, y] of corners(s)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}
