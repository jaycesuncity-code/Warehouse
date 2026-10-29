import type { BinType, CreateSlotRequest, PatchSlotRequest, ResizeSlotRequest } from '../../contract';
import { rectOf, resizeRect, type GridRect } from '../../grid';
import { notFound, slotNotEmpty, validation } from '../errors';
import { activeStockInSlot, buildSlot, findShelf, findSlot } from '../format';
import { assertSlotFits, optionalLength, requireInt, requireVersion } from '../rules';
import type { MockState, SlotRec } from '../state';
import { ok, type Handler } from '../types';

const BIN_TYPES: BinType[] = ['bin', 'box', 'tote', 'loose', 'drawer'];

function readBin(b: Partial<CreateSlotRequest & PatchSlotRequest>): Partial<SlotRec> {
  const out: Partial<SlotRec> = {};
  if (b.bin_type !== undefined) {
    if (b.bin_type !== null && !BIN_TYPES.includes(b.bin_type))
      throw validation({ bin_type: `Use one of ${BIN_TYPES.join(', ')}.` });
    out.bin_type = b.bin_type;
  }
  for (const k of ['bin_width_in', 'bin_height_in', 'bin_depth_in'] as const) {
    if (b[k] !== undefined) out[k] = optionalLength(b[k], k);
  }
  if (b.bin_color !== undefined) out.bin_color = b.bin_color === null ? null : String(b.bin_color);
  return out;
}

/** Next number in the row: left-to-right if free, otherwise one past the highest. */
function nextSlotNo(s: MockState, shelfId: string, rowIndex: number, colStart: number): number {
  const inRow = s.slots.filter((x) => x.active && x.shelf_id === shelfId && x.row_index === rowIndex);
  const desired = inRow.filter((x) => x.col_start < colStart).length + 1;
  if (!inRow.some((x) => x.slot_no === desired)) return desired;
  return Math.max(0, ...inRow.map((x) => x.slot_no)) + 1;
}

export const createSlot: Handler = (c) => {
  const b: Partial<CreateSlotRequest> & { slot_no?: number } = c.body ?? {};
  const shelf = findShelf(c.state, String(b.shelf_id ?? ''));
  if (!shelf) throw notFound('That shelf');
  const rect: GridRect = {
    row_index: requireInt(b.row_index, 'row_index', { min: 0 }),
    col_start: requireInt(b.col_start, 'col_start', { min: 1 }),
    width_span: requireInt(b.width_span, 'width_span', { min: 1 }),
    height_span: requireInt(b.height_span, 'height_span', { min: 1 }),
  };
  assertSlotFits(c.state, shelf, rect);
  const bin = readBin(b);
  let slotNo =
    b.slot_no !== undefined
      ? requireInt(b.slot_no, 'slot_no', { min: 1 })
      : nextSlotNo(c.state, shelf.shelf_id, rect.row_index, rect.col_start);
  if (
    c.state.slots.some(
      (x) =>
        x.active && x.shelf_id === shelf.shelf_id && x.row_index === rect.row_index && x.slot_no === slotNo,
    )
  ) {
    slotNo =
      Math.max(
        ...c.state.slots
          .filter((x) => x.active && x.shelf_id === shelf.shelf_id && x.row_index === rect.row_index)
          .map((x) => x.slot_no),
      ) + 1;
  }
  const slot: SlotRec = {
    slot_id: c.tx.mint('slt'),
    shelf_id: shelf.shelf_id,
    slot_no: slotNo,
    ...rect,
    bin_type: bin.bin_type ?? null,
    bin_width_in: bin.bin_width_in ?? null,
    bin_height_in: bin.bin_height_in ?? null,
    bin_depth_in: bin.bin_depth_in ?? null,
    bin_color: bin.bin_color ?? null,
    version: 1,
    active: true,
  };
  c.tx.insert('slots', slot);
  const ev = c.tx.finish('create', 'slot', slot.slot_id);
  return ok({ event_id: ev.event_id, slot: buildSlot(c.state, slot) }, 201);
};

export const patchSlot: Handler = (c) => {
  const slot = findSlot(c.state, c.params.slot_id);
  if (!slot) throw notFound('That slot');
  const b: Partial<PatchSlotRequest> = c.body ?? {};
  requireVersion(b.version, slot, () => buildSlot(c.state, slot), 'This slot');
  const next = readBin(b);
  if (b.slot_no !== undefined) {
    const no = requireInt(b.slot_no, 'slot_no', { min: 1 });
    const clash = c.state.slots.some(
      (x) =>
        x.active &&
        x.slot_id !== slot.slot_id &&
        x.shelf_id === slot.shelf_id &&
        x.row_index === slot.row_index &&
        x.slot_no === no,
    );
    if (clash) throw validation({ slot_no: `Slot ${no} is already used in that row.` });
    next.slot_no = no;
  }
  c.tx.update('slots', slot, (s) => Object.assign(s, next));
  const ev = c.tx.finish('edit', 'slot', slot.slot_id);
  return ok({ event_id: ev.event_id, slot: buildSlot(c.state, slot) });
};

export const resizeSlot: Handler = (c) => {
  const slot = findSlot(c.state, c.params.slot_id);
  if (!slot) throw notFound('That slot');
  const shelf = findShelf(c.state, slot.shelf_id);
  if (!shelf) throw notFound('That shelf');
  const b: Partial<ResizeSlotRequest> = c.body ?? {};
  requireVersion(b.version, slot, () => buildSlot(c.state, slot), 'This slot');
  const width = requireInt(b.width_span, 'width_span', { min: 1 });
  const height = requireInt(b.height_span, 'height_span', { min: 1 });
  let rect = resizeRect(rectOf(slot), width, height, b.anchor ?? 'bottom-left');
  if (b.col_start !== undefined)
    rect = { ...rect, col_start: requireInt(b.col_start, 'col_start', { min: 1 }) };
  if (b.row_index !== undefined)
    rect = { ...rect, row_index: requireInt(b.row_index, 'row_index', { min: 0 }) };
  assertSlotFits(c.state, shelf, rect, slot.slot_id);
  c.tx.update('slots', slot, (s) => Object.assign(s, rect));
  const ev = c.tx.finish('resize', 'slot', slot.slot_id);
  return ok({ event_id: ev.event_id, slot: buildSlot(c.state, slot) });
};

export const deleteSlot: Handler = (c) => {
  const slot = findSlot(c.state, c.params.slot_id);
  if (!slot) throw notFound('That slot');
  if (activeStockInSlot(c.state, slot.slot_id).length)
    throw slotNotEmpty(`That slot still has parts in it. Move them first.`);
  c.tx.update('slots', slot, (s) => void (s.active = false));
  const ev = c.tx.finish('delete', 'slot', slot.slot_id);
  return ok({ ok: true, event_id: ev.event_id });
};
