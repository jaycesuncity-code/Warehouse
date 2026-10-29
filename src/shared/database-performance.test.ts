import { afterAll, beforeAll, expect, it } from 'vitest';
import { load, persist, searchPartsFromDatabase } from '../../functions/lib/database';
import { TestDatabase } from './testing/database';
import { searchParts } from './mock/endpoints/parts';
import { buildLayout } from './mock/format';
import { ID_ALPHABET } from './ids';
import { Tx } from './mock/tx';
import { adjustStock } from './mock/endpoints/stock';

let db: TestDatabase;
const identity = { email: 'benchmark@example.com', name: 'Benchmark', role: 'admin' as const };
function id(prefix: string, index: number) {
  let suffix = '';
  do {
    suffix = ID_ALPHABET[index % ID_ALPHABET.length] + suffix;
    index = Math.floor(index / ID_ALPHABET.length);
  } while (index);
  return `${prefix}-${suffix.padStart(8, ID_ALPHABET[0])}`;
}

beforeAll(() => {
  db = new TestDatabase();
  db.sqlite.exec('BEGIN');
  const zoneId = String(db.sqlite.prepare('SELECT zone_id FROM zones LIMIT 1').get()!.zone_id);
  const part = db.sqlite.prepare(
    'INSERT INTO parts(part_id,part_code,part_name,category,description,active,version,created_at,updated_at,aliases,reorder_point) VALUES(?,?,?,?,?,1,1,?,?,?,5)',
  );
  const shelf = db.sqlite.prepare(
    "INSERT INTO shelves(shelf_id,name,zone_id,kind,x_in,y_in,rotation_deg,width_in,depth_in,height_in,cols,notes,version,active) VALUES(?,?,?,'shelving',?,?,0,120,24,72,20,'',1,1)",
  );
  const row = db.sqlite.prepare("INSERT INTO shelf_rows VALUES(?,0,'G',4,60)");
  const slot = db.sqlite.prepare(
    'INSERT INTO slots(slot_id,shelf_id,slot_no,row_index,col_start,width_span,height_span,version,active) VALUES(?,?,?,0,?,1,1,1,1)',
  );
  const stock = db.sqlite.prepare('INSERT INTO stock VALUES(?,?,10,12,NULL,NULL,1,1)');
  const event = db.sqlite.prepare("INSERT INTO events VALUES(?,?,?,'adjust','location',?,?,?,NULL,NULL)");
  for (let i = 0; i < 200; i++) {
    shelf.run(id('shf', i), `PERF-${i}`, zoneId, (i % 20) * 144, Math.floor(i / 20) * 48);
    row.run(id('shf', i));
    for (let j = 0; j < 20; j++) slot.run(id('slt', i * 20 + j), id('shf', i), j + 1, j + 1);
  }
  for (let i = 0; i < 5000; i++) {
    part.run(
      id('prt', i),
      `PERF-${String(i).padStart(5, '0')}`,
      `Warehouse component ${String(i).padStart(5, '0')}`,
      i % 2 ? 'Plumbing' : 'HVAC',
      'Representative searchable description',
      '2026-10-29',
      '2026-10-29',
      JSON.stringify([`alias-${i}`]),
    );
    stock.run(id('prt', i), id('slt', i % 4000));
  }
  for (let i = 0; i < 10000; i++) {
    const key = `${id('prt', i % 5000)}|${id('slt', i % 4000)}`;
    event.run(
      id('evt', i),
      new Date(1_790_000_000_000 + i * 1000).toISOString(),
      identity.email,
      key,
      JSON.stringify({ [key]: { on_hand_qty: 11, notes: 'Historical count'.repeat(10) } }),
      JSON.stringify({ [key]: { on_hand_qty: 12, notes: 'Historical count'.repeat(10) } }),
    );
  }
  db.sqlite.exec('COMMIT');
}, 20_000);

afterAll(() => db.sqlite.close());

it('measures representative relational snapshot search and map loading', async () => {
  db.resetMetrics();
  const start = performance.now();
  const state = await load(db);
  state.employees ??= [];
  state.packouts ??= [];
  const loaded = performance.now();
  const result = searchParts({
    method: 'GET',
    body: undefined,
    params: {},
    query: new URLSearchParams({ q: 'PERF-01234' }),
    state,
    tx: null as unknown as Tx,
    ctx: identity,
    role: identity.role,
  });
  const searched = performance.now();
  expect(result.body).toMatchObject({ total: 1 });
  const layout = buildLayout(state);
  const mapped = performance.now();
  expect(layout.shelves).toHaveLength(200);
  const baselineRows = db.returnedRows;
  db.resetMetrics();
  const scopedStart = performance.now();
  const query = new URLSearchParams({ q: 'PERF-01234' });
  const scoped = await load(db, { endpoint: 'searchParts', query });
  const scopedResult = searchParts({
    method: 'GET',
    body: undefined,
    params: {},
    query,
    state: scoped,
    tx: null as unknown as Tx,
    ctx: identity,
    role: identity.role,
  });
  const scopedEnd = performance.now();
  const scopedRows = db.returnedRows;
  expect(scopedResult.body).toEqual(result.body);
  expect(scoped.events).toEqual([]);
  expect(scopedRows).toBeLessThan(100);

  db.resetMetrics();
  const broadStart = performance.now();
  const broadQuery = new URLSearchParams({ limit: '25' });
  const broad = await searchPartsFromDatabase(db, broadQuery, identity.role);
  const broadEnd = performance.now();
  const broadRows = db.returnedRows;
  const broadStockRows = db.queryResults
    .filter((result) => result.sql.includes('SELECT * FROM stock WHERE'))
    .reduce((sum, result) => sum + result.rows, 0);
  expect(broad).toMatchObject({ total: 5000, limit: 25, offset: 0 });
  expect(broad.items).toHaveLength(25);
  expect(broadStockRows).toBeLessThan(100);
  expect(broad).toEqual(
    searchParts({
      method: 'GET',
      body: undefined,
      params: {},
      query: broadQuery,
      state,
      tx: null as unknown as Tx,
      ctx: identity,
      role: identity.role,
    }).body,
  );

  db.resetMetrics();
  const body = { part_id: id('prt', 1234), slot_id: id('slt', 1234), delta: 1, reason: 'Isolated benchmark' };
  const countStart = performance.now();
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
  const countEnd = performance.now();
  expect(db.returnedRows).toBeLessThan(100);
  expect(
    db.sqlite
      .prepare('SELECT on_hand_qty FROM stock WHERE part_id=? AND slot_id=?')
      .get(body.part_id, body.slot_id),
  ).toEqual({ on_hand_qty: 13 });
  console.info(
    'DATABASE_BENCHMARK',
    JSON.stringify({
      parts: 5000,
      shelves: 200,
      slots: 4000,
      stock: 5000,
      history: 10000,
      rows_loaded: baselineRows,
      snapshot_ms: +(loaded - start).toFixed(2),
      search_ms: +(searched - loaded).toFixed(2),
      map_ms: +(mapped - searched).toFixed(2),
      snapshot_bytes: JSON.stringify(state).length,
      scoped_search_ms: +(scopedEnd - scopedStart).toFixed(2),
      scoped_search_rows: scopedRows,
      scoped_snapshot_bytes: JSON.stringify(scoped).length,
      scoped_stock_write_ms: +(countEnd - countStart).toFixed(2),
      scoped_stock_rows: db.returnedRows,
      broad_search_ms: +(broadEnd - broadStart).toFixed(2),
      broad_search_rows: broadRows,
      broad_stock_rows: broadStockRows,
    }),
  );
}, 20_000);
