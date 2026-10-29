import type { AdjustStockRequest } from '../../contract';
import { notFound, validation, versionConflict } from '../errors';
import { activeStockForPart, buildLocation, findPart, findSlot, stockFor } from '../format';
import { requireInt } from '../rules';
import { isoNow } from '../tx';
import { ok, type Handler } from '../types';

/**
 * POST /api/stock/adjust
 *  - delta: always safe (relative change), never goes below 0.
 *  - set:   an absolute count; requires the location's `version`; stamps counted_at / counted_by.
 */
export const adjustStock: Handler = (c) => {
  const b: Partial<AdjustStockRequest> = c.body ?? {};
  const part = findPart(c.state, String(b.part_id ?? ''));
  if (!part) throw notFound('That part');
  const slot = findSlot(c.state, String(b.slot_id ?? ''));
  if (!slot) throw notFound('That slot');
  const row = stockFor(c.state, part.part_id, slot.slot_id);
  if (!row || !row.active) throw notFound('That part in that slot');

  const hasDelta = b.delta !== undefined && b.delta !== null;
  const hasSet = b.set !== undefined && b.set !== null;
  if (hasDelta === hasSet)
    throw validation({
      delta: 'Send exactly one of delta or set.',
      set: 'Send exactly one of delta or set.',
    });
  if (b.reason !== undefined && typeof b.reason !== 'string') throw validation({ reason: 'Must be text.' });

  let action: string;
  if (hasDelta) {
    const delta = requireInt(b.delta, 'delta');
    const next = row.on_hand_qty + delta;
    if (next < 0) throw validation({ delta: `Only ${row.on_hand_qty} on hand. Can't go below 0.` });
    c.tx.update('stock', row, (r) => {
      r.on_hand_qty = next;
    });
    action = 'adjust';
  } else {
    const set = requireInt(b.set, 'set', { min: 0 });
    if (b.version === undefined || b.version === null)
      throw validation({ version: 'A count needs the version you last saw.' });
    if (b.version !== row.version) {
      throw versionConflict(buildLocation(c.state, row), 'This count');
    }
    c.tx.update('stock', row, (r) => {
      r.on_hand_qty = set;
      r.counted_at = isoNow();
      r.counted_by = c.ctx.email;
    });
    action = 'count';
  }

  const ev = c.tx.finish(action, 'location', `${part.part_id}|${slot.slot_id}`, b.reason ?? null);
  const locs = activeStockForPart(c.state, part.part_id);
  return ok({
    event_id: ev.event_id,
    location: buildLocation(c.state, row),
    par_total: locs.reduce((n, r) => n + r.par_qty, 0),
    on_hand_total: locs.reduce((n, r) => n + r.on_hand_qty, 0),
  });
};
