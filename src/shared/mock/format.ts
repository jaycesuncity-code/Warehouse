/**
 * Turns stored rows into the contract's JSON shapes (Part, Location, Shelf, Slot, Layout ...).
 * Read-only: never mutates state.
 */
import type {
  Layout,
  LayoutShelf,
  LayoutSlot,
  Location,
  Part,
  Role,
  Shelf,
  Slot,
  SlotConflict,
  SlotPart,
} from '../contract';
import { locationCode, sortSlots } from '../grid';
import type { MockState, PartRec, ShelfRec, SlotRec, StockRec } from './state';

export const findShelf = (s: MockState, id: string): ShelfRec | undefined =>
  s.shelves.find((x) => x.shelf_id === id && x.active);
export const findSlot = (s: MockState, id: string): SlotRec | undefined =>
  s.slots.find((x) => x.slot_id === id && x.active);
export const findPart = (s: MockState, id: string): PartRec | undefined =>
  s.parts.find((x) => x.part_id === id && x.active);

export const activeStockInSlot = (s: MockState, slotId: string): StockRec[] => {
  const out: StockRec[] = [];
  for (const r of s.stock) {
    if (r.active && r.slot_id === slotId && findPart(s, r.part_id)) out.push(r);
  }
  return out;
};

export const stockFor = (s: MockState, partId: string, slotId: string): StockRec | undefined =>
  s.stock.find((r) => r.part_id === partId && r.slot_id === slotId);

export const activeStockForPart = (s: MockState, partId: string): StockRec[] =>
  s.stock.filter((r) => r.active && r.part_id === partId && findSlot(s, r.slot_id));

export function slotCode(s: MockState, slot: SlotRec): string {
  const shelf = s.shelves.find((x) => x.shelf_id === slot.shelf_id);
  const row = shelf?.rows.find((r) => r.row_index === slot.row_index);
  return locationCode(shelf?.name ?? '?', row?.row_label ?? String(slot.row_index), slot.slot_no);
}

export function zoneName(s: MockState, zoneId: string): string {
  return s.zones.find((z) => z.zone_id === zoneId)?.name ?? '';
}

export function buildLocation(s: MockState, stock: StockRec): Location {
  const slot = s.slots.find((x) => x.slot_id === stock.slot_id)!;
  const shelf = s.shelves.find((x) => x.shelf_id === slot.shelf_id)!;
  const row = shelf.rows.find((r) => r.row_index === slot.row_index);
  const others = activeStockInSlot(s, slot.slot_id)
    .filter((r) => r.part_id !== stock.part_id)
    .map((r) => ({ part_id: r.part_id, part_name: findPart(s, r.part_id)!.part_name }));
  return {
    slot_id: slot.slot_id,
    location_type: shelf.location_type ?? 'primary',
    issued_kit_id:
      s.packouts.find((k) => k.active && k.status === 'issued' && k.slot_id === slot.slot_id)?.kit_id ?? null,
    location_code: slotCode(s, slot),
    zone_id: shelf.zone_id,
    zone_name: zoneName(s, shelf.zone_id),
    shelf_id: shelf.shelf_id,
    shelf_name: shelf.name,
    row_label: row?.row_label ?? String(slot.row_index),
    row_index: slot.row_index,
    slot_no: slot.slot_no,
    col_start: slot.col_start,
    width_span: slot.width_span,
    height_span: slot.height_span,
    par_qty: stock.par_qty,
    on_hand_qty: stock.on_hand_qty,
    counted_at: stock.counted_at,
    counted_by: stock.counted_by,
    version: stock.version,
    co_located_parts: others,
  };
}

export function buildPart(s: MockState, part: PartRec, role: Role = 'editor'): Part {
  const locs = activeStockForPart(s, part.part_id).map((r) => buildLocation(s, r));
  locs.sort(
    (a, b) =>
      a.zone_name.localeCompare(b.zone_name) ||
      a.shelf_name.localeCompare(b.shelf_name) ||
      a.row_index - b.row_index ||
      a.slot_no - b.slot_no,
  );
  return {
    ...part,
    aliases: part.aliases ? [...part.aliases] : [],
    cost: role === 'viewer' ? null : part.cost,
    par_total: locs.reduce((n, l) => n + l.par_qty, 0),
    on_hand_total: locs.reduce((n, l) => n + l.on_hand_qty, 0),
    available_total: locs.filter((l) => !l.issued_kit_id).reduce((n, l) => n + l.on_hand_qty, 0),
    issued_total: locs.filter((l) => l.issued_kit_id).reduce((n, l) => n + l.on_hand_qty, 0),
    locations: locs,
  };
}

export function slotParts(s: MockState, slotId: string): SlotPart[] {
  return activeStockInSlot(s, slotId).map((r) => {
    const p = findPart(s, r.part_id)!;
    return {
      part_id: p.part_id,
      part_name: p.part_name,
      part_code: p.part_code,
      on_hand_qty: r.on_hand_qty,
      par_qty: r.par_qty,
    };
  });
}

export function buildSlot(s: MockState, slot: SlotRec): Slot {
  const { active: _a, shelf_id: _s, ...geo } = slot;
  return {
    ...geo,
    low: slotLow(s, slot.slot_id),
    location_code: slotCode(s, slot),
    parts: slotParts(s, slot.slot_id),
  };
}

export function buildShelf(s: MockState, shelf: ShelfRec): Shelf {
  const { active: _a, ...geo } = shelf;
  const slots = sortSlots(s.slots.filter((x) => x.shelf_id === shelf.shelf_id && x.active)).map((x) =>
    buildSlot(s, x),
  );
  return { ...geo, zone_name: zoneName(s, shelf.zone_id), rows: shelf.rows.map((r) => ({ ...r })), slots };
}

export function slotConflict(s: MockState, slot: SlotRec): SlotConflict {
  return {
    slot_id: slot.slot_id,
    location_code: slotCode(s, slot),
    parts: activeStockInSlot(s, slot.slot_id).map((r) => ({
      part_id: r.part_id,
      part_name: findPart(s, r.part_id)!.part_name,
      on_hand_qty: r.on_hand_qty,
    })),
  };
}

/** Low = any part in the slot is at or under the part's reorder point (part-level total). */
function slotLow(s: MockState, slotId: string): boolean {
  return activeStockInSlot(s, slotId).some((r) => {
    const p = findPart(s, r.part_id)!;
    if (p.reorder_point == null) return false;
    const total = activeStockForPart(s, p.part_id).reduce((n, x) => n + x.on_hand_qty, 0);
    return total <= p.reorder_point;
  });
}

export function layoutVersion(s: MockState): string {
  return `${s.updated_at}#${s.seq}`;
}

export function buildLayout(s: MockState): Layout {
  // Build indexes for this read only. Nothing is cached across mutable transactions.
  const parts = new Map(s.parts.filter((part) => part.active).map((part) => [part.part_id, part]));
  const activeSlots = new Set(s.slots.filter((slot) => slot.active).map((slot) => slot.slot_id));
  const slotsByShelf = new Map<string, SlotRec[]>();
  const stockBySlot = new Map<string, StockRec[]>();
  const partTotals = new Map<string, number>();
  const zones = new Map(s.zones.map((zone) => [zone.zone_id, zone.name]));
  for (const slot of s.slots) {
    if (!slot.active) continue;
    const group = slotsByShelf.get(slot.shelf_id) ?? [];
    group.push(slot);
    slotsByShelf.set(slot.shelf_id, group);
  }
  for (const stock of s.stock) {
    if (!stock.active || !parts.has(stock.part_id)) continue;
    const group = stockBySlot.get(stock.slot_id) ?? [];
    group.push(stock);
    stockBySlot.set(stock.slot_id, group);
    if (activeSlots.has(stock.slot_id))
      partTotals.set(stock.part_id, (partTotals.get(stock.part_id) ?? 0) + stock.on_hand_qty);
  }
  const shelves: LayoutShelf[] = s.shelves
    .filter((x) => x.active)
    .map((shelf) => {
      const { active: _a, ...geo } = shelf;
      const rows = new Map(shelf.rows.map((row) => [row.row_index, row.row_label]));
      const slots: LayoutSlot[] = sortSlots(slotsByShelf.get(shelf.shelf_id) ?? []).map((slot) => {
        const { active: _sa, shelf_id: _sid, ...sgeo } = slot;
        const stock = stockBySlot.get(slot.slot_id) ?? [];
        return {
          ...sgeo,
          location_code: locationCode(
            shelf.name,
            rows.get(slot.row_index) ?? String(slot.row_index),
            slot.slot_no,
          ),
          part_count: stock.length,
          on_hand_total: stock.reduce((n, r) => n + r.on_hand_qty, 0),
          par_total: stock.reduce((n, r) => n + r.par_qty, 0),
          low: stock.some((row) => {
            const part = parts.get(row.part_id)!;
            return part.reorder_point != null && (partTotals.get(row.part_id) ?? 0) <= part.reorder_point;
          }),
          part_ids: stock.map((r) => r.part_id),
          departments: [
            ...new Set(stock.map((r) => parts.get(r.part_id)?.department).filter((d): d is string => !!d)),
          ],
        };
      });
      return {
        ...geo,
        zone_name: zones.get(shelf.zone_id) ?? '',
        rows: shelf.rows.map((r) => ({ ...r })),
        slots,
      };
    });
  return {
    layout_version: layoutVersion(s),
    zones: s.zones.filter((z) => z.active).map(({ active: _a, ...z }) => z),
    openings: s.openings.filter((o) => o.active).map(({ active: _a, ...o }) => o),
    shelves,
  };
}
