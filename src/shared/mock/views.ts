// Builds API response shapes (contract §6) from mock rows.

import type { Layout, LayoutShelf, LayoutSlot, Location, Part, Shelf, Slot } from "../contract";
import type { DB, LocationRow, PartRow, ShelfRow, SlotRow } from "./db";
import { locationCode } from "./rules";

export function activeLocationsForSlot(d: DB, slotId: string): LocationRow[] {
  return d.locations.filter((l) => l.active && l.slot_id === slotId);
}

function rowLabelOf(shelf: ShelfRow, rowIndex: number): string {
  return shelf.rows[rowIndex]?.row_label ?? (rowIndex === 0 ? "G" : String(rowIndex));
}

export function slotCode(shelf: ShelfRow, slot: SlotRow): string {
  return locationCode(shelf.name, rowLabelOf(shelf, slot.row_index), slot.slot_no);
}

function zoneName(d: DB, zoneId: string | null): string | null {
  if (!zoneId) return null;
  return d.zones.find((z) => z.zone_id === zoneId)?.name ?? null;
}

function slotBase(shelf: ShelfRow, s: SlotRow) {
  return {
    slot_id: s.slot_id,
    slot_no: s.slot_no,
    location_code: slotCode(shelf, s),
    row_index: s.row_index,
    col_start: s.col_start,
    width_span: s.width_span,
    height_span: s.height_span,
    bin_type: s.bin_type,
    bin_width_in: s.bin_width_in,
    bin_height_in: s.bin_height_in,
    bin_depth_in: s.bin_depth_in,
    bin_color: s.bin_color,
    version: s.version,
  };
}

function shelfBase(d: DB, s: ShelfRow) {
  return {
    shelf_id: s.shelf_id,
    name: s.name,
    zone_id: s.zone_id,
    zone_name: zoneName(d, s.zone_id),
    kind: s.kind,
    x_in: s.x_in,
    y_in: s.y_in,
    rotation_deg: s.rotation_deg,
    width_in: s.width_in,
    depth_in: s.depth_in,
    height_in: s.height_in,
    cols: s.cols,
    rows: s.rows.map((r) => ({ ...r })),
    wall_ref: s.wall_ref,
    notes: s.notes,
    version: s.version,
  };
}

export function slotView(d: DB, shelf: ShelfRow, s: SlotRow): Slot {
  const parts = activeLocationsForSlot(d, s.slot_id).map((l) => {
    const p = d.parts.find((x) => x.part_id === l.part_id)!;
    return { part_id: p.part_id, part_name: p.part_name, part_code: p.part_code, on_hand_qty: l.on_hand_qty, par_qty: l.par_qty };
  });
  return { ...slotBase(shelf, s), parts };
}

export function shelfView(d: DB, shelf: ShelfRow): Shelf {
  const slots = d.slots
    .filter((s) => s.active && s.shelf_id === shelf.shelf_id)
    .sort((a, b) => a.row_index - b.row_index || a.col_start - b.col_start)
    .map((s) => slotView(d, shelf, s));
  return { ...shelfBase(d, shelf), slots };
}

export function layoutSlotView(d: DB, shelf: ShelfRow, s: SlotRow, partIndex?: Map<string, PartRow>): LayoutSlot {
  const locs = activeLocationsForSlot(d, s.slot_id);
  const on_hand_total = locs.reduce((a, l) => a + l.on_hand_qty, 0);
  const par_total = locs.reduce((a, l) => a + l.par_qty, 0);
  const departments = new Set<string>();
  for (const l of locs) {
    const p = partIndex ? partIndex.get(l.part_id) : d.parts.find((x) => x.part_id === l.part_id);
    if (p?.department) departments.add(p.department);
  }
  return {
    ...slotBase(shelf, s),
    part_count: locs.length,
    on_hand_total,
    par_total,
    low: locs.length > 0 && on_hand_total < par_total,
    part_ids: locs.map((l) => l.part_id),
    departments: [...departments],
  };
}

export function layoutShelfView(d: DB, shelf: ShelfRow, slotsByShelf?: Map<string, SlotRow[]>, partIndex?: Map<string, PartRow>): LayoutShelf {
  const slots = (slotsByShelf ? slotsByShelf.get(shelf.shelf_id) ?? [] : d.slots.filter((s) => s.active && s.shelf_id === shelf.shelf_id))
    .slice()
    .sort((a, b) => a.row_index - b.row_index || a.col_start - b.col_start)
    .map((s) => layoutSlotView(d, shelf, s, partIndex));
  return { ...shelfBase(d, shelf), slots };
}

export function layoutView(d: DB): Layout {
  const slotsByShelf = new Map<string, SlotRow[]>();
  for (const s of d.slots) {
    if (!s.active) continue;
    const arr = slotsByShelf.get(s.shelf_id);
    if (arr) arr.push(s);
    else slotsByShelf.set(s.shelf_id, [s]);
  }
  const partIndex = new Map(d.parts.map((p) => [p.part_id, p]));
  // Index active locations by slot once (5,000-slot layouts stay fast).
  const locBySlot = new Map<string, LocationRow[]>();
  for (const l of d.locations) {
    if (!l.active) continue;
    const arr = locBySlot.get(l.slot_id);
    if (arr) arr.push(l);
    else locBySlot.set(l.slot_id, [l]);
  }
  const fast: DB = { ...d, locations: [] };
  const shelves = d.shelves
    .filter((s) => s.active)
    .map((shelf) => {
      const base = layoutShelfView(fast, shelf, slotsByShelf, partIndex);
      base.slots = base.slots.map((ls) => {
        const locs = locBySlot.get(ls.slot_id) ?? [];
        if (!locs.length) return ls;
        const on_hand_total = locs.reduce((a, l) => a + l.on_hand_qty, 0);
        const par_total = locs.reduce((a, l) => a + l.par_qty, 0);
        return {
          ...ls,
          part_count: locs.length,
          on_hand_total,
          par_total,
          low: on_hand_total < par_total,
          part_ids: locs.map((l) => l.part_id),
          departments: [...new Set(locs.map((l) => partIndex.get(l.part_id)?.department).filter(Boolean) as string[])],
        };
      });
      return base;
    });
  return {
    layout_version: `mock#${d.seq}`,
    zones: d.zones.filter((z) => z.active).map(({ active: _a, ...z }) => structuredClone(z)),
    openings: d.openings.filter((o) => o.active).map(({ active: _a, ...o }) => structuredClone(o)),
    shelves,
  };
}

export function locationView(d: DB, l: LocationRow): Location | null {
  const slot = d.slots.find((s) => s.slot_id === l.slot_id && s.active);
  if (!slot) return null;
  const shelf = d.shelves.find((s) => s.shelf_id === slot.shelf_id && s.active);
  if (!shelf) return null;
  const co = activeLocationsForSlot(d, slot.slot_id)
    .filter((o) => o.part_id !== l.part_id)
    .map((o) => ({ part_id: o.part_id, part_name: d.parts.find((p) => p.part_id === o.part_id)?.part_name ?? o.part_id }));
  return {
    slot_id: slot.slot_id,
    location_code: slotCode(shelf, slot),
    zone_id: shelf.zone_id,
    zone_name: zoneName(d, shelf.zone_id),
    shelf_id: shelf.shelf_id,
    shelf_name: shelf.name,
    row_label: rowLabelOf(shelf, slot.row_index),
    row_index: slot.row_index,
    slot_no: slot.slot_no,
    col_start: slot.col_start,
    width_span: slot.width_span,
    height_span: slot.height_span,
    par_qty: l.par_qty,
    on_hand_qty: l.on_hand_qty,
    counted_at: l.counted_at,
    counted_by: l.counted_by,
    version: l.version,
    co_located_parts: co,
  };
}

export function partView(d: DB, p: PartRow): Part {
  const locations = d.locations
    .filter((l) => l.active && l.part_id === p.part_id)
    .map((l) => locationView(d, l))
    .filter((x): x is Location => !!x)
    .sort((a, b) => a.location_code.localeCompare(b.location_code));
  const { aliases: _aliases, ...rest } = p;
  return {
    ...rest,
    par_total: locations.reduce((a, l) => a + l.par_qty, 0),
    on_hand_total: locations.reduce((a, l) => a + l.on_hand_qty, 0),
    locations,
  };
}
