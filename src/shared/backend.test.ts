import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load, persist, readIdempotency } from '../../functions/lib/database';
import { TestDatabase as LocalDB } from './testing/database';
import { Tx } from './mock/tx';
import { registerParts } from './mock/endpoints/parts';
import { createZone } from './mock/endpoints/building';
import { createShelf } from './mock/endpoints/shelves';
import { createSlot } from './mock/endpoints/slots';
import { moveLocation, patchLocation } from './mock/endpoints/locations';
import { adjustStock } from './mock/endpoints/stock';
import { undoEvent } from './mock/endpoints/events';
import type { Handler } from './mock/types';
import { onRequest } from '../../functions/api/[[path]]';
const me = { email: 'tester@example.com', name: 'Tester', role: 'admin' as const };
let db: LocalDB;
beforeEach(() => {
  db = new LocalDB();
});
afterEach(() => db.sqlite.close());
async function call(handler: Handler, body: unknown = {}, params: Record<string, string> = {}) {
  const before = await load(db);
  const tx = new Tx(before, me);
  const reply = handler({
    method: 'POST',
    body,
    params,
    query: new URLSearchParams(),
    ctx: me,
    role: me.role,
    state: tx.state,
    tx,
  });
  await persist(db, before, tx.state);
  return reply.body as Record<string, unknown>;
}
describe('relational persistence', () => {
  it('registers once, survives reload, and never creates stock', async () => {
    const body = { rows: [{ part_code: '001-A', part_name: 'Tee' }] };
    await call(registerParts, body);
    await call(registerParts, body);
    const state = await load(db);
    expect(state.parts).toHaveLength(1);
    expect(state.parts[0].part_id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);
    expect(state.stock).toHaveLength(0);
    expect(state.events).toHaveLength(1);
  });
  it('rolls back every row when a concurrent revision wins', async () => {
    const old = await load(db);
    const tx = new Tx(old, me);
    registerParts({
      method: 'POST',
      body: { rows: [{ part_code: 'stale', part_name: 'Stale' }] },
      params: {},
      query: new URLSearchParams(),
      ctx: me,
      role: me.role,
      state: tx.state,
      tx,
    });
    await call(registerParts, { rows: [{ part_code: 'winner', part_name: 'Winner' }] });
    await expect(persist(db, old, tx.state)).rejects.toThrow();
    expect((await load(db)).parts.map((p) => p.part_code)).toEqual(['winner']);
  });
  it('persists building, stock, par, undo and redo with actor attribution', async () => {
    await call(createZone, {
      name: 'Warehouse',
      room_no: '126',
      polygon_in: [
        [0, 0],
        [200, 0],
        [200, 200],
        [0, 200],
      ],
      open_edges: [],
      wall_height_in: 192,
      notes: 'Unverified',
    });
    let state = await load(db);
    await call(createShelf, {
      name: 'A1',
      zone_id: state.zones.find((z) => z.name === 'Warehouse')!.zone_id,
      kind: 'shelving',
      x_in: 0,
      y_in: 0,
      rotation_deg: 0,
      width_in: 96,
      depth_in: 24,
      height_in: 72,
      cols: 4,
      rows: [{ row_index: 0, row_label: 'G', elevation_in: 4, clear_height_in: 60 }],
    });
    state = await load(db);
    await call(createSlot, {
      shelf_id: state.shelves[0].shelf_id,
      row_index: 0,
      col_start: 1,
      width_span: 1,
      height_span: 1,
    });
    await call(registerParts, { rows: [{ part_code: 'A', part_name: 'Tee' }] });
    state = await load(db);
    const part_id = state.parts[0].part_id,
      slot_id = state.slots[0].slot_id;
    await call(moveLocation, { part_id, slot_id, to_slot_id: slot_id, mode: 'add' });
    await call(adjustStock, { part_id, slot_id, delta: 8, reason: 'Received' });
    state = await load(db);
    await call(patchLocation, { part_id, slot_id, par_qty: 12, version: state.stock[0].version });
    const beforeUndo = await load(db);
    const ev = beforeUndo.events.at(-1)!;
    const undo = await call(undoEvent, {}, { event_id: ev.event_id });
    expect((await load(db)).stock[0]).toMatchObject({ par_qty: 0, on_hand_qty: 8 });
    await call(undoEvent, {}, { event_id: String(undo.event_id) });
    state = await load(db);
    expect(state.stock[0]).toMatchObject({ par_qty: 12, on_hand_qty: 8 });
    expect(state.events.every((e) => e.by === me.email)).toBe(true);
    await expect(call(patchLocation, { part_id, slot_id, par_qty: 99, version: 1 })).rejects.toThrow();
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('fails closed without Access configuration or token', async () => {
    expect(
      (await onRequest({ request: new Request('https://app/api/parts'), env: { 'warehouse-db': db } }))
        .status,
    ).toBe(503);
    expect(
      (
        await onRequest({
          request: new Request('https://app/api/parts'),
          env: {
            'warehouse-db': db,
            CF_ACCESS_TEAM_DOMAIN: 'suncitylc.cloudflareaccess.com',
            CF_ACCESS_AUD: 'test',
          },
        })
      ).status,
    ).toBe(401);
  });
  it('rolls back the revision, catalog, audit and retry receipt on a deferred foreign-key failure', async () => {
    const before = await load(db);
    const tx = new Tx(before, me);
    registerParts({
      method: 'POST',
      body: { rows: [{ part_code: 'ROLLBACK', part_name: 'Rollback tee' }] },
      params: {},
      query: new URLSearchParams(),
      ctx: me,
      role: me.role,
      state: tx.state,
      tx,
    });
    tx.state.events[0].undone_by = 'evt-missingx';
    const receipt = {
      actor: me.email,
      key: 'rollback-test',
      request_hash: 'hash',
      response_status: 200,
      response_body: { ok: true },
    };
    await expect(persist(db, before, tx.state, receipt)).rejects.toThrow();
    const reloaded = await load(db);
    expect(reloaded.seq).toBe(before.seq);
    expect(reloaded.parts).toHaveLength(0);
    expect(reloaded.events).toHaveLength(0);
    expect(await readIdempotency(db, receipt.key, receipt.actor)).toBeNull();
  });
  it('fails atomically if the revision metadata disappears between read and write', async () => {
    const before = await load(db);
    const tx = new Tx(before, me);
    registerParts({
      method: 'POST',
      body: { rows: [{ part_code: 'MISSING-META', part_name: 'Never committed' }] },
      params: {},
      query: new URLSearchParams(),
      ctx: me,
      role: me.role,
      state: tx.state,
      tx,
    });
    db.sqlite.exec('DELETE FROM warehouse_meta');
    await expect(persist(db, before, tx.state)).rejects.toThrow();
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM parts').get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 0 });
  });
  it('never overwrites an unseen existing part when a scoped transaction collides with its ID', async () => {
    await call(registerParts, { rows: [{ part_code: 'PRESERVE', part_name: 'Preserved identity' }] });
    const original = (await load(db)).parts[0];
    const before = await load(db, { endpoint: 'getPart', params: { part_id: 'not-a-part' } });
    const after = structuredClone(before);
    after.parts.push({ ...original, part_code: 'COLLISION', part_name: 'Must not overwrite' });
    await expect(persist(db, before, after)).rejects.toThrow();
    expect((await load(db)).parts).toEqual([original]);
  });
});
