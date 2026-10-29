import type {
  CreateShelfRequest,
  PatchShelfRequest,
  ShelfKind,
  ShelfListItem,
  ShelfRow,
} from '../../contract';
import type { LocationType } from '../../contract';
import { shelfLocalToMap } from '../../units';
import { withinGrid } from '../../grid';
import { HttpError, notFound, shelfNotEmpty, validation } from '../errors';
import { activeStockInSlot, buildShelf, findShelf, slotCode } from '../format';
import { requireInt, requireNumber, requireRole, requireString, requireVersion } from '../rules';
import type { MockState, ShelfRec, SlotRec } from '../state';
import { ok, type Handler } from '../types';
import { readBoolean, readNullableText, readText } from '../input';

function locationType(value: unknown): LocationType {
  if (typeof value !== 'string' || !['primary', 'overstock', 'packout'].includes(value))
    throw validation({ location_type: 'Choose Primary, Overstock or Packout.' });
  return value as LocationType;
}

const KINDS: ShelfKind[] = ['shelving', 'pallet_rack', 'cabinet', 'bench', 'floor_area'];

export const listShelves: Handler = (c) => {
  const groups = c.state.zones
    .filter((z) => z.active)
    .map((z) => {
      const shelves: ShelfListItem[] = c.state.shelves
        .filter((s) => s.active && s.zone_id === z.zone_id)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((s) => {
          const slots = c.state.slots.filter((x) => x.active && x.shelf_id === s.shelf_id);
          const partIds = new Set(
            slots.flatMap((x) => activeStockInSlot(c.state, x.slot_id).map((r) => r.part_id)),
          );
          return {
            shelf_id: s.shelf_id,
            name: s.name,
            kind: s.kind,
            slot_count: slots.length,
            part_count: partIds.size,
          };
        });
      return { zone_id: z.zone_id, zone_name: z.name, shelves };
    })
    .filter((g) => g.shelves.length);
  return ok({ groups });
};

export const getShelf: Handler = (c) => {
  const shelf = findShelf(c.state, c.params.shelf_id);
  if (!shelf) throw notFound('That shelf');
  return ok(buildShelf(c.state, shelf));
};

function readRows(value: unknown): ShelfRow[] {
  if (!Array.isArray(value) || !value.length) throw validation({ rows: 'A shelf needs at least one row.' });
  let lastTop = -Infinity;
  return value.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r))
      throw validation({ rows: 'Each shelf row must be an object.' });
    const row = r as Partial<ShelfRow>;
    if (row.row_index !== i) throw validation({ rows: 'Rows must be numbered 0, 1, 2 ... from the bottom.' });
    const elevation = requireNumber(row.elevation_in, 'rows.elevation_in', { min: 0 });
    const clear = requireNumber(row.clear_height_in, 'rows.clear_height_in', { positive: true });
    if (elevation <= lastTop - 0.001 && i > 0)
      throw validation({ rows: 'Each row must sit above the one below.' });
    lastTop = elevation;
    return {
      row_index: i,
      row_label: row.row_label ? readText(row.row_label, 'rows.row_label', 40) : i === 0 ? 'G' : String(i),
      elevation_in: elevation,
      clear_height_in: clear,
    };
  });
}

function assertNameFree(s: MockState, name: string, exceptId?: string): void {
  if (
    s.shelves.some((x) => x.active && x.shelf_id !== exceptId && x.name.toLowerCase() === name.toLowerCase())
  ) {
    throw validation({ name: `A shelf called ${name} already exists.` });
  }
}

function assertZone(s: MockState, zoneId: unknown): string {
  const z = s.zones.find((x) => x.active && x.zone_id === zoneId);
  if (!z) throw validation({ zone_id: 'Pick a zone that exists.' });
  return z.zone_id;
}

export const createShelf: Handler = (c) => {
  const b: Partial<CreateShelfRequest> = c.body ?? {};
  const name = requireString(b.name, 'name');
  assertNameFree(c.state, name);
  const kind = (b.kind ?? 'shelving') as ShelfKind;
  if (!KINDS.includes(kind)) throw validation({ kind: `Use one of ${KINDS.join(', ')}.` });
  const shelf: ShelfRec = {
    shelf_id: c.tx.mint('shf'),
    location_type: locationType(b.location_type ?? 'primary'),
    name,
    zone_id: assertZone(c.state, b.zone_id),
    kind,
    x_in: requireNumber(b.x_in, 'x_in'),
    y_in: requireNumber(b.y_in, 'y_in'),
    rotation_deg: requireNumber(b.rotation_deg ?? 0, 'rotation_deg'),
    width_in: requireNumber(b.width_in, 'width_in', { positive: true }),
    depth_in: requireNumber(b.depth_in, 'depth_in', { positive: true }),
    height_in: requireNumber(b.height_in, 'height_in', { positive: true }),
    cols: requireInt(b.cols, 'cols', { min: 1 }),
    rows: readRows(b.rows),
    wall_ref: readNullableText(b.wall_ref, 'wall_ref'),
    notes: readText(b.notes ?? '', 'notes'),
    version: 1,
    active: true,
  };
  c.tx.insert('shelves', shelf);
  const ev = c.tx.finish('create', 'shelf', shelf.shelf_id);
  return ok({ event_id: ev.event_id, shelf: buildShelf(c.state, shelf) }, 201);
};

export const patchShelf: Handler = (c) => {
  const shelf = findShelf(c.state, c.params.shelf_id);
  if (!shelf) throw notFound('That shelf');
  const b: Partial<PatchShelfRequest> = c.body ?? {};
  requireVersion(b.version, shelf, () => buildShelf(c.state, shelf), 'This shelf');

  const next: Partial<ShelfRec> = {};
  if (b.location_type !== undefined) next.location_type = locationType(b.location_type);
  if (b.name !== undefined) {
    next.name = requireString(b.name, 'name');
    assertNameFree(c.state, next.name, shelf.shelf_id);
  }
  if (b.zone_id !== undefined) next.zone_id = assertZone(c.state, b.zone_id);
  if (b.kind !== undefined) {
    if (!KINDS.includes(b.kind)) throw validation({ kind: `Use one of ${KINDS.join(', ')}.` });
    next.kind = b.kind;
  }
  for (const k of ['x_in', 'y_in', 'rotation_deg'] as const)
    if (b[k] !== undefined) next[k] = requireNumber(b[k], k);
  for (const k of ['width_in', 'depth_in', 'height_in'] as const)
    if (b[k] !== undefined) next[k] = requireNumber(b[k], k, { positive: true });
  if (b.cols !== undefined) next.cols = requireInt(b.cols, 'cols', { min: 1 });
  if (b.rows !== undefined) next.rows = readRows(b.rows);
  if (b.wall_ref !== undefined) next.wall_ref = readNullableText(b.wall_ref, 'wall_ref');
  if (b.notes !== undefined) next.notes = readText(b.notes, 'notes');

  const cols = next.cols ?? shelf.cols;
  const rowCount = (next.rows ?? shelf.rows).length;
  if (next.cols !== undefined || next.rows !== undefined) {
    const bad = c.state.slots.filter(
      (s) => s.active && s.shelf_id === shelf.shelf_id && !withinGrid(s, cols, rowCount),
    );
    if (bad.length) {
      throw new HttpError(
        'slot_out_of_bounds',
        `${bad.length} slot(s) would no longer fit on shelf ${next.name ?? shelf.name}.`,
        {
          slots: bad.map((slot) => ({
            slot_id: slot.slot_id,
            location_code: slotCode(c.state, slot),
            reason: [
              slot.col_start + slot.width_span - 1 > cols ? `Extends past column ${cols}.` : '',
              slot.row_index + slot.height_span > rowCount
                ? `Extends above the ${rowCount} remaining row(s).`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          })),
        },
      );
    }
  }
  c.tx.update('shelves', shelf, (s) => Object.assign(s, next));
  const ev = c.tx.finish('edit', 'shelf', shelf.shelf_id);
  return ok({ event_id: ev.event_id, shelf: buildShelf(c.state, shelf) });
};

export const deleteShelf: Handler = (c) => {
  const shelf = findShelf(c.state, c.params.shelf_id);
  if (!shelf) throw notFound('That shelf');
  const force = readBoolean(c.body?.force, 'force');
  if (force) requireRole(c.role, 'admin');
  const slots = c.state.slots.filter((s) => s.active && s.shelf_id === shelf.shelf_id);
  const stocked = slots.flatMap((s) => activeStockInSlot(c.state, s.slot_id));
  if (stocked.length && !force)
    throw shelfNotEmpty(`Shelf ${shelf.name} still has ${stocked.length} part location(s) on it.`);
  for (const r of stocked) c.tx.update('stock', r, (x) => void (x.active = false));
  for (const s of slots) c.tx.update('slots', s, (x) => void (x.active = false));
  c.tx.update('shelves', shelf, (s) => void (s.active = false));
  const ev = c.tx.finish('delete', 'shelf', shelf.shelf_id);
  return ok({ ok: true, event_id: ev.event_id });
};

function nextShelfName(s: MockState, name: string): string {
  const m = name.match(/^(.*?)(\d+)$/);
  if (m) {
    const prefix = m[1];
    const nums = s.shelves
      .filter((x) => x.active && x.name.startsWith(prefix) && /^\d+$/.test(x.name.slice(prefix.length)))
      .map((x) => parseInt(x.name.slice(prefix.length), 10));
    return `${prefix}${Math.max(...nums, 0) + 1}`;
  }
  let n = 2;
  while (s.shelves.some((x) => x.active && x.name.toLowerCase() === `${name} ${n}`.toLowerCase())) n++;
  return `${name} ${n}`;
}

/** Copy of the shelf with its rows and empty slots, one shelf-width to the viewer's right. */
export const duplicateShelf: Handler = (c) => {
  const src = findShelf(c.state, c.params.shelf_id);
  if (!src) throw notFound('That shelf');
  const [nx, ny] = shelfLocalToMap(src, src.width_in, 0);
  const copy: ShelfRec = {
    ...structuredClone(src),
    shelf_id: c.tx.mint('shf'),
    name: nextShelfName(c.state, src.name),
    x_in: nx,
    y_in: ny,
    version: 1,
    active: true,
  };
  c.tx.insert('shelves', copy);
  for (const s of c.state.slots.filter((x) => x.active && x.shelf_id === src.shelf_id)) {
    const slot: SlotRec = {
      ...structuredClone(s),
      slot_id: c.tx.mint('slt'),
      shelf_id: copy.shelf_id,
      version: 1,
      active: true,
    };
    c.tx.insert('slots', slot);
  }
  const ev = c.tx.finish('duplicate', 'shelf', copy.shelf_id);
  return ok({ event_id: ev.event_id, shelf: buildShelf(c.state, copy) }, 201);
};
