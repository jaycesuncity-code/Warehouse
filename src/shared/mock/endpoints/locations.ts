import type { DeleteLocationRequest, MoveLocationRequest } from '../../contract';
import { notFound, slotOccupied, validation } from '../errors';
import { buildPart, findPart, findShelf, findSlot, activeStockInSlot, slotCode, stockFor } from '../format';
import { requireInt, requireVersion } from '../rules';
import type { StockRec } from '../state';
import type { Tx } from '../tx';
import { ok, type Handler } from '../types';

const MODES = ['move', 'add', 'swap', 'share'];

/** Put a part into a slot, re-using an old (inactive) row if there is one. */
function place(
  tx: Tx,
  partId: string,
  slotId: string,
  par: number,
  onHand: number,
  carry: Pick<StockRec, 'counted_at' | 'counted_by'> | null,
  merge: boolean,
): void {
  const existing = stockFor(tx.state, partId, slotId);
  if (existing && existing.active) {
    if (!merge) throw validation({ to_slot_id: 'That part is already in that slot.' });
    tx.update('stock', existing, (r) => {
      r.par_qty += par;
      r.on_hand_qty += onHand;
    });
    return;
  }
  if (existing) {
    tx.update('stock', existing, (r) => {
      r.active = true;
      r.par_qty = par;
      r.on_hand_qty = onHand;
      r.counted_at = carry?.counted_at ?? null;
      r.counted_by = carry?.counted_by ?? null;
    });
    return;
  }
  tx.insert('stock', {
    part_id: partId,
    slot_id: slotId,
    par_qty: par,
    on_hand_qty: onHand,
    counted_at: carry?.counted_at ?? null,
    counted_by: carry?.counted_by ?? null,
    version: 1,
    active: true,
  } as StockRec);
}

const vacate = (tx: Tx, row: StockRec): void => {
  tx.update('stock', row, (r) => {
    r.active = false;
  });
};

/**
 * POST /api/locations/move
 *  - move:  leave the old slot (needs from_slot_id). 409 slot_occupied if someone else is in the target.
 *  - add:   keep the old slot, add a second one. Also used to assign a part for the first time. 409 if occupied.
 *  - swap:  exchange with whatever is in the target (all occupants go to the old slot).
 *  - share: co-locate; allowed when occupied. With from_slot_id the part leaves that slot; without it, it is added.
 */
export const moveLocation: Handler = (c) => {
  const b: Partial<MoveLocationRequest> = c.body ?? {};
  const part = findPart(c.state, String(b.part_id ?? ''));
  if (!part) throw notFound('That part');
  const mode = String(b.mode ?? '');
  if (!MODES.includes(mode)) throw validation({ mode: 'Use move, add, swap or share.' });
  const toSlot = findSlot(c.state, String(b.to_slot_id ?? ''));
  if (!toSlot || !findShelf(c.state, toSlot.shelf_id)) throw notFound('The target slot');

  const fromId = b.from_slot_id ? String(b.from_slot_id) : undefined;
  if ((mode === 'move' || mode === 'swap') && !fromId)
    throw validation({ from_slot_id: `A ${mode} needs the old slot.` });
  if (fromId && fromId === toSlot.slot_id)
    throw validation({ to_slot_id: 'That is the slot it is already in.' });
  let fromRow: StockRec | undefined;
  if (fromId) {
    fromRow = stockFor(c.state, part.part_id, fromId);
    if (!fromRow || !fromRow.active) throw notFound('That part in the old slot');
  }
  if (b.par_qty !== undefined) requireInt(b.par_qty, 'par_qty', { min: 0 });
  if (b.on_hand_qty !== undefined) requireInt(b.on_hand_qty, 'on_hand_qty', { min: 0 });

  const par = b.par_qty ?? fromRow?.par_qty ?? 0;
  const onHand = b.on_hand_qty ?? (mode === 'add' ? 0 : (fromRow?.on_hand_qty ?? 0));
  const carry = mode === 'add' ? null : (fromRow ?? null);

  const occupants = activeStockInSlot(c.state, toSlot.slot_id).filter((r) => r.part_id !== part.part_id);
  const occupiedError = () =>
    slotOccupied([
      {
        slot_id: toSlot.slot_id,
        location_code: slotCode(c.state, toSlot),
        parts: occupants.map((r) => ({
          part_id: r.part_id,
          part_name: findPart(c.state, r.part_id)!.part_name,
          on_hand_qty: r.on_hand_qty,
        })),
      },
    ]);

  let displaced: { part_id: string; part_name: string }[] | undefined;

  switch (mode) {
    case 'move':
      if (occupants.length) throw occupiedError();
      vacate(c.tx, fromRow!);
      place(c.tx, part.part_id, toSlot.slot_id, par, onHand, carry, true);
      break;
    case 'add':
      if (occupants.length) throw occupiedError();
      place(c.tx, part.part_id, toSlot.slot_id, par, onHand, carry, false);
      break;
    case 'share':
      if (fromRow) {
        vacate(c.tx, fromRow);
        place(c.tx, part.part_id, toSlot.slot_id, par, onHand, carry, true);
      } else {
        place(c.tx, part.part_id, toSlot.slot_id, par, onHand, carry, false);
      }
      break;
    case 'swap': {
      if (!occupants.length) throw validation({ to_slot_id: 'Nothing is in that spot to swap with.' });
      displaced = occupants.map((o) => ({
        part_id: o.part_id,
        part_name: findPart(c.state, o.part_id)!.part_name,
      }));
      const moving = occupants.map((o) => ({ ...o }));
      for (const o of occupants) vacate(c.tx, o);
      for (const o of moving) place(c.tx, o.part_id, fromId!, o.par_qty, o.on_hand_qty, o, true);
      vacate(c.tx, fromRow!);
      place(c.tx, part.part_id, toSlot.slot_id, par, onHand, carry, true);
      break;
    }
  }

  const ev = c.tx.finish(mode, 'location', `${part.part_id}|${toSlot.slot_id}`);
  return ok({
    affected_shelf_ids: [...new Set([toSlot.shelf_id, ...(fromId ? [findSlot(c.state, fromId)!.shelf_id] : [])])],
    event_id: ev.event_id,
    part: buildPart(c.state, part, c.role),
    ...(displaced ? { displaced_parts: displaced } : {}),
  });
};

/** DELETE /api/locations: remove a part from a slot (soft; the part stays in the catalog). */
export const deleteLocation: Handler = (c) => {
  const b: Partial<DeleteLocationRequest> = c.body ?? {};
  const part = findPart(c.state, String(b.part_id ?? ''));
  if (!part) throw notFound('That part');
  const row = stockFor(c.state, part.part_id, String(b.slot_id ?? ''));
  if (!row || !row.active) throw notFound('That part in that slot');
  vacate(c.tx, row);
  const ev = c.tx.finish('remove', 'location', `${part.part_id}|${row.slot_id}`);
  return ok({ affected_shelf_ids: [findSlot(c.state, row.slot_id)!.shelf_id], event_id: ev.event_id, part: buildPart(c.state, part, c.role) });
};

export const patchLocation: Handler = c => {
 const b = c.body ?? {};
 const part = findPart(c.state, String(b.part_id ?? ''));
 const row = stockFor(c.state, String(b.part_id ?? ''), String(b.slot_id ?? ''));
 if (!part || !row?.active) throw notFound('That location');
 requireVersion(b.version, row, () => buildPart(c.state, part, c.role).locations.find(l => l.slot_id === row.slot_id));
 const par = requireInt(b.par_qty, 'par_qty', {min:0});
 c.tx.update('stock', row, r => {r.par_qty = par;});
 const ev = c.tx.finish('par', 'location', `${part.part_id}|${row.slot_id}`);
 return ok({event_id:ev.event_id, part:buildPart(c.state,part,c.role), affected_shelf_ids:[findSlot(c.state,row.slot_id)!.shelf_id]});
};
