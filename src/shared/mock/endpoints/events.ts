import type { ApiEvent } from '../../contract';
import { notFound, undoStale, forbidden } from '../errors';
import type { Table } from '../tx';
import { rowKey } from '../tx';
import { ok, type Handler } from '../types';

const idMatches = (entityId: string, wanted: string): boolean =>
  entityId === wanted || entityId.startsWith(`${wanted}|`) || entityId.endsWith(`|${wanted}`);

/** GET /api/events?entity=&entity_id=&limit=  (newest first). */
export const listEvents: Handler = (c) => {
  const entity = c.query.get('entity');
  const entityId = c.query.get('entity_id');
  const limit = Math.min(Math.max(parseInt(c.query.get('limit') ?? '50', 10) || 50, 1), 200);
  const items = [...c.state.events]
    .reverse()
    .filter((e) => (!entity || e.entity === entity) && (!entityId || idMatches(e.entity_id, entityId)))
    .slice(0, limit);
  return ok({ items });
};

type Row = Record<string, unknown> & { version: number; active?: boolean };

function lookup(c: Parameters<Handler>[0], key: string): { table: Table; row: Row | undefined } {
  const table = key.slice(0, key.indexOf(':')) as Table;
  const rows = c.state[table] as unknown as Row[];
  return { table, row: rows.find((r) => rowKey(table, r) === key) };
}

/**
 * POST /api/events/:event_id/undo
 * Valid only while every row the event touched is still at the version the event left it at.
 */
export const undoEvent: Handler = (c) => {
  const ev = c.state.events.find((e) => e.event_id === c.params.event_id);
  if (!ev) throw notFound('That change');
  if ((ev.entity === 'zone' || ev.entity === 'opening') && c.role !== 'admin') throw forbidden('Only an admin can undo building edits.');
  if (ev.undone_by) throw undoStale('That change was already undone.');


  const keys = Object.keys(ev.after);
  for (const key of keys) {
    const { row } = lookup(c, key);
    const after = ev.after[key] as Row | null;
    if (!row || !after || row.version !== after.version) {
      throw undoStale('Something changed since then, so this can no longer be undone.');
    }
  }
  for (const key of keys) {
    const { table, row } = lookup(c, key);
    const before = ev.before[key] as Row | null;
    c.tx.update(table, row!, (r) => {
      if (before === null) {
        r.active = false;
      } else {
        const keepVersion = r.version;
        Object.assign(r, structuredClone(before), { version: keepVersion });
      }
    });
  }
  for(const stock of c.state.stock.filter(r=>r.active)) {
    const slot=c.state.slots.find(r=>r.slot_id===stock.slot_id && r.active);
    if(!c.state.parts.some(r=>r.part_id===stock.part_id && r.active) || !slot || !c.state.shelves.some(r=>r.shelf_id===slot.shelf_id && r.active))throw undoStale('Later inventory depends on this record. Undo the dependent changes first.');
  }
  const undoEv = c.tx.finish('undo', ev.entity, ev.entity_id, `Undo of ${ev.action}`);
  (ev as ApiEvent).undone_by = undoEv.event_id;
  return ok({ event_id: undoEv.event_id, undone: ev, affected_shelf_ids: c.state.shelves.filter(s => s.active).map(s => s.shelf_id) });
};
