import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, persist, searchPartsFromDatabase, SnapshotConflict } from '../../functions/lib/database';
import { TestDatabase } from './testing/database';
import { buildLayout, buildPart } from './mock/format';
import { searchParts } from './mock/endpoints/parts';
import { adjustStock } from './mock/endpoints/stock';
import { listEvents } from './mock/endpoints/events';
import { Tx } from './mock/tx';
import type { MockState } from './mock/state';

let db: TestDatabase;
const identity = { email: 'scope@example.com', name: 'Scope test', role: 'admin' as const };
const partId = 'prt-22222222';
const firstSlot = 'slt-22222222';
const kitSlot = 'slt-22222224';

beforeEach(() => {
  db = new TestDatabase();
  const zone = String(db.sqlite.prepare('SELECT zone_id FROM zones LIMIT 1').get()!.zone_id);
  const shelf = db.sqlite.prepare(
    "INSERT INTO shelves(shelf_id,name,zone_id,kind,x_in,y_in,rotation_deg,width_in,depth_in,height_in,cols,notes,version,active,location_type) VALUES(?,?,?,'shelving',0,0,0,96,24,72,4,'',1,1,?)",
  );
  shelf.run('shf-22222222', 'STOCK', zone, 'primary');
  shelf.run('shf-22222223', 'KITS', zone, 'packout');
  const row = db.sqlite.prepare("INSERT INTO shelf_rows VALUES(?,0,'G',4,60)");
  row.run('shf-22222222');
  row.run('shf-22222223');
  const slot = db.sqlite.prepare(
    'INSERT INTO slots(slot_id,shelf_id,slot_no,row_index,col_start,width_span,height_span,version,active) VALUES(?,?,?,0,?,1,1,1,1)',
  );
  for (let i = 0; i < 4; i++)
    slot.run(`slt-2222222${i + 2}`, i === 2 ? 'shf-22222223' : 'shf-22222222', i + 1, i + 1);
  const part = db.sqlite.prepare(
    'INSERT INTO parts(part_id,part_code,part_name,category,description,aliases,active,version,created_at,updated_at,cost,reorder_point) VALUES(?,?,?,?,?,?,1,1,?,?,12.5,10)',
  );
  part.run(partId, 'TEE-01', 'Tee 1/2', 'Plumbing', 'Copper fitting', '[]', '2000-01-01', '2000-01-01');
  part.run('prt-22222223', 'CO-02', 'Co-located copper', 'Plumbing', '', '[]', '2000-01-01', '2000-01-01');
  part.run('prt-22222224', 'CO-03', 'Co-located other bin', 'Plumbing', '', '[]', '2000-01-01', '2000-01-01');
  part.run(
    'prt-22222225',
    'UNICODE',
    'Kelvin Équerre',
    'Électrique',
    'Test description',
    JSON.stringify(['"quoted"', 'x\\y']),
    '2000-01-01',
    '2000-01-01',
  );
  part.run('prt-22222226', 'UNASSIGNED', 'Unassigned part', 'HVAC', '', '[]', '2000-01-01', '2000-01-01');
  part.run(
    'prt-22222227',
    'UNRELATED',
    'Unrelated stocked part',
    'HVAC',
    '',
    '[]',
    '2000-01-01',
    '2000-01-01',
  );
  const stock = db.sqlite.prepare('INSERT INTO stock VALUES(?,?,10,?,NULL,NULL,1,1)');
  stock.run(partId, firstSlot, 5);
  stock.run(partId, 'slt-22222223', 7);
  stock.run(partId, kitSlot, 3);
  stock.run('prt-22222223', firstSlot, 4);
  stock.run('prt-22222224', 'slt-22222223', 6);
  stock.run('prt-22222225', kitSlot, 2);
  stock.run('prt-22222227', 'slt-22222225', 8);
  db.sqlite
    .prepare('INSERT INTO employees VALUES(?,?,?,1,1)')
    .run('emp-22222222', 'Kit employee', identity.email);
  db.sqlite.prepare("INSERT INTO packouts VALUES(?,?,?,'issued',?,?,?,1,1)").run(
    'kit-22222222',
    'Issued test kit',
    kitSlot,
    'emp-22222222',
    '2026-10-29T18:00:00Z',
    JSON.stringify([
      { part_id: partId, qty: 3 },
      { part_id: 'prt-22222225', qty: 2 },
    ]),
  );
});
afterEach(() => {
  db.sqlite.close();
  vi.restoreAllMocks();
});

function search(state: MockState, query: URLSearchParams) {
  return searchParts({
    method: 'GET',
    body: undefined,
    params: {},
    query,
    state,
    tx: null as unknown as Tx,
    ctx: identity,
    role: identity.role,
  }).body;
}

describe('scoped database snapshots', () => {
  it('retains all locations, co-located parts, custody and available totals for a scanned part', async () => {
    const full = await load(db);
    const scoped = await load(db, { endpoint: 'getPart', params: { part_id: partId } });
    expect(
      buildPart(
        scoped,
        scoped.parts.find((p) => p.part_id === partId)!,
      ),
    ).toEqual(
      buildPart(
        full,
        full.parts.find((p) => p.part_id === partId)!,
      ),
    );
    expect(
      buildPart(
        scoped,
        scoped.parts.find((p) => p.part_id === partId)!,
      ),
    ).toMatchObject({ on_hand_total: 15, available_total: 12, issued_total: 3 });
    expect(scoped.parts.some((p) => p.part_code === 'UNRELATED')).toBe(false);
    expect(scoped.stock).toHaveLength(6);
    expect(scoped.packouts).toHaveLength(1);
    expect(scoped.employees).toHaveLength(1);
    expect(scoped.events).toEqual([]);
  });

  it.each([
    { q: 'Tee 1/2' },
    { q: 'co', limit: '1', offset: '1' },
    { q: 'kelvin' },
    { q: 'équerre', category: 'électrique' },
    { q: '"quoted"' },
    { q: 'x\\y' },
    { q: 'nonexistent' },
    { category: 'PLUMBING' },
    { unassigned: 'true' },
    { limit: '2', offset: '2' },
  ])('preserves canonical search ranking, filters, totals, and locations for %j', async (params) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
    const full = await load(db);
    const scoped = await load(db, { endpoint: 'searchParts', query });
    expect(search(scoped, query)).toEqual(search(full, query));
    expect(await searchPartsFromDatabase(db, query, identity.role)).toEqual(search(full, query));
  });

  it('preserves issued-kit integrity when updating another location of the same part', async () => {
    const body = { part_id: partId, slot_id: firstSlot, delta: 2 };
    const before = await load(db, { endpoint: 'adjustStock', body });
    const tx = new Tx(before, identity);
    adjustStock({
      method: 'POST',
      body,
      params: {},
      query: new URLSearchParams(),
      state: tx.state,
      tx,
      ctx: identity,
      role: identity.role,
    });
    await persist(db, before, tx.state);
    expect(
      db.sqlite.prepare('SELECT on_hand_qty FROM stock WHERE part_id=? AND slot_id=?').get(partId, firstSlot),
    ).toEqual({ on_hand_qty: 7 });
    expect(
      db.sqlite.prepare('SELECT on_hand_qty FROM stock WHERE part_id=? AND slot_id=?').get(partId, kitSlot),
    ).toEqual({ on_hand_qty: 3 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM stock').get()).toEqual({ n: 7 });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('cannot bypass issued-kit quantity protection by loading only one part', async () => {
    const body = { part_id: partId, slot_id: kitSlot, delta: 2 };
    const before = await load(db, { endpoint: 'adjustStock', body });
    const tx = new Tx(before, identity);
    let failure: unknown;
    try {
      adjustStock({
        method: 'POST',
        body,
        params: {},
        query: new URLSearchParams(),
        state: tx.state,
        tx,
        ctx: identity,
        role: identity.role,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      status: 400,
      body: { error: 'validation', fields: { packout: expect.stringMatching(/issued|Return/i) } },
    });
    expect(
      db.sqlite.prepare('SELECT on_hand_qty FROM stock WHERE part_id=? AND slot_id=?').get(partId, kitSlot),
    ).toEqual({ on_hand_qty: 3 });
  });

  it('rejects mixed-revision search candidates so the HTTP router can retry', async () => {
    const original = db.batch.bind(db);
    let calls = 0;
    vi.spyOn(db, 'batch').mockImplementation(async (statements) => {
      const result = await original(statements);
      if (++calls === 1) db.sqlite.exec('UPDATE warehouse_meta SET revision=revision+1');
      return result;
    });
    await expect(
      load(db, { endpoint: 'searchParts', query: new URLSearchParams({ q: 'TEE' }) }),
    ).rejects.toBeInstanceOf(SnapshotConflict);
    calls = 0;
    await expect(
      searchPartsFromDatabase(db, new URLSearchParams({ q: 'TEE' }), identity.role),
    ).rejects.toBeInstanceOf(SnapshotConflict);
  });

  it('preserves filtered newest-first audit order while loading only the requested history page', async () => {
    const insert = db.sqlite.prepare(
      "INSERT INTO events VALUES(?,?,'actor@example.com','adjust','location',?,'{}','{}',NULL,NULL)",
    );
    for (let i = 0; i < 10; i++)
      insert.run(
        `evt-test${i}`,
        `2026-10-${String(29 - i).padStart(2, '0')}T12:00:00Z`,
        i % 2 ? `${partId}|${firstSlot}` : 'unrelated',
      );
    const query = new URLSearchParams({ entity: 'location', entity_id: partId, limit: '3' });
    const full = await load(db);
    const scoped = await load(db, { endpoint: 'events', query });
    const run = (state: MockState) =>
      listEvents({
        method: 'GET',
        body: undefined,
        params: {},
        query,
        state,
        tx: null as unknown as Tx,
        ctx: identity,
        role: identity.role,
      }).body;
    expect(run(scoped)).toEqual(run(full));
    expect(scoped.events).toHaveLength(3);
    expect(scoped.parts).toEqual([]);
  });

  it('does not reuse stale map indexes after an in-memory stock mutation', async () => {
    const state = await load(db);
    const before = buildLayout(state)
      .shelves.flatMap((shelf) => shelf.slots)
      .find((slot) => slot.slot_id === firstSlot)!;
    state.stock.find((stock) => stock.part_id === partId && stock.slot_id === firstSlot)!.on_hand_qty += 20;
    const after = buildLayout(state)
      .shelves.flatMap((shelf) => shelf.slots)
      .find((slot) => slot.slot_id === firstSlot)!;
    expect(after.on_hand_total).toBe(before.on_hand_total + 20);
  });
});
