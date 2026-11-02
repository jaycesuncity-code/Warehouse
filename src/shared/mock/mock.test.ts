/* eslint-disable @typescript-eslint/no-explicit-any -- loose response bodies in test helpers */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody, Layout, LayoutSlot, Location, Part, Role, Shelf, ShelfRow, Zone } from '../contract';
import { withinGrid, rectsOverlap } from '../grid';
import { isEventId, isPartId, isShelfId, isSlotId, isZoneId } from '../ids';
import { shelfCorners } from '../units';
import { DEMO_DATA } from './demo-data';
import { handleMockRequest, loadMockState, setMockStorage } from './index';
import { resetState } from './state';

// ------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

type Res<T = any> = { status: number; body: T; headers: Record<string, string> };  
const call = <T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  role: Role = 'editor',
): Res<T> =>
   
  handleMockRequest(method, path, { body, role }) as Res<T>;
const get = <T = any>(path: string, role: Role = 'editor') => call<T>('GET', path, undefined, role);  
const post = <T = any>(path: string, body: unknown, role: Role = 'editor') =>
  call<T>('POST', path, body, role);  
const err = (res: Res): ApiErrorBody => res.body as ApiErrorBody;

const layout = (): Layout => get<Layout>('/api/layout').body;
const slotByCode = (code: string): LayoutSlot => {
  for (const s of layout().shelves) for (const sl of s.slots) if (sl.location_code === code) return sl;
  throw new Error(`no slot ${code}`);
};
const partByCode = (code: string): Part =>
  get<{ items: Part[] }>(`/api/parts?q=${encodeURIComponent(code)}`).body.items.find(
    (p) => p.part_code === code,
  )!;
const loc = (code: string, slotCode: string): Location =>
  partByCode(code).locations.find((l) => l.location_code === slotCode)!;
const freeSlots = (shelfName: string): LayoutSlot[] =>
  layout()
    .shelves.find((s) => s.name === shelfName)!
    .slots.filter((s) => s.part_count === 0);

function assertConsistent(): void {
  const s = loadMockState();
  for (const shelf of s.shelves.filter((x) => x.active)) {
    const slots = s.slots.filter((x) => x.active && x.shelf_id === shelf.shelf_id);
    for (const a of slots) {
      expect(withinGrid(a, shelf.cols, shelf.rows.length), `${shelf.name} slot ${a.slot_id} in grid`).toBe(
        true,
      );
      for (const b of slots)
        if (a !== b)
          expect(rectsOverlap(a, b), `${shelf.name}: ${a.slot_id} overlaps ${b.slot_id}`).toBe(false);
    }
    const numbers = slots.map((x) => `${x.row_index}:${x.slot_no}`);
    expect(new Set(numbers).size, `${shelf.name} slot numbers unique per row`).toBe(numbers.length);
  }
  const seen = new Set<string>();
  for (const r of s.stock.filter((x) => x.active)) {
    expect(Number.isInteger(r.on_hand_qty) && r.on_hand_qty >= 0, 'on_hand >= 0').toBe(true);
    expect(Number.isInteger(r.par_qty) && r.par_qty >= 0, 'par >= 0').toBe(true);
    const key = `${r.part_id}|${r.slot_id}`;
    expect(seen.has(key), `duplicate active stock ${key}`).toBe(false);
    seen.add(key);
    expect(s.parts.some((p) => p.active && p.part_id === r.part_id)).toBe(true);
    expect(s.slots.some((x) => x.active && x.slot_id === r.slot_id)).toBe(true);
  }
}

const SMALL_ROWS: ShelfRow[] = [0, 1, 2].map((i) => ({
  row_index: i,
  row_label: i === 0 ? 'G' : String(i),
  elevation_in: 4 + i * 20,
  clear_height_in: 19,
}));
function makeTestShelf(name = 'T1', cols = 6): Shelf {
  const zone = DEMO_DATA.zones.find((z) => z.name === 'WAREHOUSE 126')!;
  const res = post<{ shelf: Shelf }>('/api/shelves', {
    name,
    zone_id: zone.zone_id,
    x_in: 100,
    y_in: 100,
    rotation_deg: 0,
    width_in: 72,
    depth_in: 24,
    height_in: 64,
    cols,
    rows: SMALL_ROWS,
  });
  expect(res.status).toBe(201);
  return res.body.shelf;
}
const addSlot = (
  shelf_id: string,
  row_index: number,
  col_start: number,
  width_span: number,
  height_span = 1,
) => post('/api/slots', { shelf_id, row_index, col_start, width_span, height_span });

beforeEach(() => {
  setMockStorage(memoryStorage());
  resetState();
});

// ------------------------------------------------------------------------------------------
// demo dataset
// ------------------------------------------------------------------------------------------

describe('demo dataset', () => {
  it('matches contract section 9: zones, openings, shelves', () => {
    const zones = Object.fromEntries(DEMO_DATA.zones.map((z) => [z.name, z]));
    // Nine rooms plus the Tools and Packouts floor areas (no walls).
    expect(Object.keys(zones)).toHaveLength(11);
    expect(DEMO_DATA.zones.filter((z) => !z.area_kind)).toHaveLength(9);
    expect(zones['TOOLS']).toMatchObject({ area_kind: 'tools', open_edges: [0, 1, 2, 3] });
    expect(zones['PACKOUTS']).toMatchObject({ area_kind: 'packouts', open_edges: [0, 1, 2, 3] });
    expect(zones['WAREHOUSE 126'].polygon_in).toEqual([
      [0, 0],
      [483, 0],
      [483, 1203],
      [0, 1203],
    ]);
    expect(zones['STORAGE 125'].polygon_in).toEqual([
      [483, 958],
      [637, 958],
      [637, 1203],
      [483, 1203],
    ]);
    expect(zones['FABRICATION 124'].open_edges).toEqual([2]);
    expect(zones['LOADING DOCK'].open_edges).toEqual([0, 1]);
    expect(zones['FABRICATION 123'].open_edges).toEqual([4, 8]);
    expect(zones['STORAGE - PARTS & TOOLS 121'].open_edges).toEqual([1]);
    expect(zones['STORAGE - FILTERS 120'].polygon_in).toEqual([
      [0, 1683],
      [479.5, 1683],
      [479.5, 1947],
      [0, 1947],
    ]);
    expect(DEMO_DATA.zones.every((z) => z.verified === false)).toBe(true);
    expect(DEMO_DATA.openings).toHaveLength(18);
    expect(DEMO_DATA.openings.every((o) => o.verified === false)).toBe(true);
    expect(DEMO_DATA.openings.find((o) => o.tag === '34')).toMatchObject({
      kind: 'overhead',
      x1_in: 1027,
      x2_in: 1147,
      y1_in: 1203,
      height_in: 168,
    });
    expect(DEMO_DATA.openings.find((o) => o.tag === '40')).toMatchObject({ kind: 'door', height_in: 84 });

    const sh = Object.fromEntries(DEMO_DATA.shelves.map((s) => [s.name, s]));
    expect(sh.A1).toMatchObject({
      x_in: 24,
      y_in: 960,
      rotation_deg: 270,
      width_in: 96,
      depth_in: 24,
      height_in: 84,
      cols: 12,
    });
    expect(sh.A2).toMatchObject({ x_in: 24, y_in: 840, rotation_deg: 270, cols: 12 });
    expect(sh.B1).toMatchObject({ x_in: 240, y_in: 1651, rotation_deg: 180, cols: 12 });
    expect(sh.F1).toMatchObject({ x_in: 447.5, y_in: 1728, rotation_deg: 90, cols: 8 });
    expect(sh.A1.rows.map((r) => r.row_label)).toEqual(['G', '1', '2', '3', '4']);
    expect(sh.A2.rows.map((r) => r.row_label)).toEqual(['G', '1', '2', '3']);
    expect(sh.F1.rows.map((r) => r.row_label)).toEqual(['G', '1', '2', '3']);
    expect(sh.A1.rows[0]).toMatchObject({ elevation_in: 4, clear_height_in: 15 });
    const zoneOf = (n: string) => DEMO_DATA.zones.find((z) => z.zone_id === sh[n].zone_id)!.name;
    expect([zoneOf('A1'), zoneOf('B1'), zoneOf('F1')]).toEqual([
      'WAREHOUSE 126',
      'STORAGE - PARTS & TOOLS 121',
      'STORAGE - FILTERS 120',
    ]);
  });

  it('includes every case the brief asks for', () => {
    const partsByCode = (code: string) => partByCode(code);
    expect(DEMO_DATA.parts.length).toBeGreaterThanOrEqual(24);
    expect(DEMO_DATA.parts.length).toBeLessThanOrEqual(28);
    expect(partsByCode('SB-12-BV').locations).toHaveLength(2); // a part in two slots
    expect(
      layout()
        .shelves.flatMap((s) => s.slots)
        .some((s) => s.part_count === 2),
    ).toBe(true); // a slot holding two parts
    expect(partsByCode('SW-FLOAT-01').locations).toHaveLength(0); // no location
    expect(partsByCode('PVC-3-SAN').on_hand_total).toBe(0); // at 0 on hand
    expect(partsByCode('DUCT-6-COLLAR').on_hand_total).toBeGreaterThan(
      partsByCode('DUCT-6-COLLAR').par_total,
    ); // over par
    expect(partsByCode('00417-B').part_code).toBe('00417-B'); // leading zeros
    const anode = partsByCode('WH-ANODE-34');
    const slot = DEMO_DATA.slots.find((s) => s.slot_id === anode.locations[0].slot_id)!;
    expect(anode.width_in!).toBeGreaterThan(slot.bin_width_in!); // part does not fit its bin
    expect(DEMO_DATA.parts.every((p) => isPartId(p.part_id))).toBe(true);
    expect(partsByCode('CU-34-90').part_id).toBe('prt-k7m2qx9d'); // the contract's example part
  });

  it('is internally consistent', () => assertConsistent());

  it('every demo slot sits inside its shelf grid', () => {
    for (const shelf of DEMO_DATA.shelves) {
      for (const sl of DEMO_DATA.slots.filter((s) => s.shelf_id === shelf.shelf_id)) {
        expect(withinGrid(sl, shelf.cols, shelf.rows.length)).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------
// roles and basics
// ------------------------------------------------------------------------------------------

describe('roles', () => {
  it('GET /api/me reflects the role', () => {
    expect(get('/api/me', 'viewer').body).toMatchObject({ role: 'viewer' });
    expect(get('/api/me', 'admin').body).toMatchObject({ role: 'admin' });
  });
  it('viewers can read but not write', () => {
    const p = partByCode('CU-34-90');
    expect(get(`/api/parts/${p.part_id}`, 'viewer').status).toBe(200);
    const res = post(
      '/api/stock/adjust',
      { part_id: p.part_id, slot_id: p.locations[0].slot_id, delta: 1 },
      'viewer',
    );
    expect(res.status).toBe(403);
    expect(err(res).error).toBe('forbidden');
    expect(
      call('DELETE', '/api/locations', { part_id: p.part_id, slot_id: p.locations[0].slot_id }, 'viewer')
        .status,
    ).toBe(403);
    expect(get('/api/export.csv', 'viewer').status).toBe(403);
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(62);
  });
  it('only admins write zones and openings', () => {
    const zone = {
      name: 'TEST',
      room_no: '1',
      polygon_in: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      open_edges: [],
      wall_height_in: null,
      notes: '',
    };
    expect(post('/api/zones', zone, 'editor').status).toBe(403);
    const ok = post('/api/zones', zone, 'admin');
    expect(ok.status).toBe(201);
    expect(isZoneId(ok.body.zone.zone_id)).toBe(true);
    expect(
      post(
        '/api/zones',
        {
          ...zone,
          polygon_in: [
            [0, 0],
            [1, 1],
          ],
        },
        'admin',
      ).status,
    ).toBe(400);
  });
  it('hides cost from viewers', () => {
    const p = partByCode('CU-34-90');
    expect(get<Part>(`/api/parts/${p.part_id}`, 'editor').body.cost).toBe(1.85);
    expect(get<Part>(`/api/parts/${p.part_id}`, 'viewer').body.cost).toBeNull();
    expect(get<Part>(`/api/parts/${p.part_id}`, 'viewer').body.sale_price).toBe(4.25);
  });
  it('unknown routes and parts are 404', () => {
    expect(get('/api/nope').status).toBe(404);
    expect(get('/api/parts/prt-22222222').status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------
// parts + search
// ------------------------------------------------------------------------------------------

describe('parts', () => {
  it('returns the part with locations, totals and co-located parts', () => {
    const p = partByCode('CU-34-90');
    expect(p).toMatchObject({
      part_id: 'prt-k7m2qx9d',
      par_total: 100,
      on_hand_total: 62,
      reorder_point: 20,
    });
    expect(p.locations).toHaveLength(1);
    expect(p.locations[0]).toMatchObject({
      slot_id: 'slt-4hq8wz2k',
      location_code: 'B1-G-4',
      shelf_name: 'B1',
      row_label: 'G',
      slot_no: 4,
      col_start: 7,
      width_span: 2,
      par_qty: 100,
      on_hand_qty: 62,
    });
    expect(p.locations[0].zone_name).toBe('STORAGE - PARTS & TOOLS 121');
    const shared = partByCode('PVC-2-90').locations[0];
    expect(shared.co_located_parts.map((c) => c.part_name)).toEqual(['2" PVC Coupling (DWV)']);
  });
  it('searches name, code, category, description and aliases; results carry locations', () => {
    const q = (s: string) =>
      get<{ items: Part[]; total: number }>(`/api/parts?q=${encodeURIComponent(s)}`).body;
    expect(q('CU-34-90').items[0].part_code).toBe('CU-34-90');
    expect(q('cu-34-90').items[0].part_code).toBe('CU-34-90'); // exact code wins
    expect(q('3/4 copper').items.map((p) => p.part_code)).toEqual(
      expect.arrayContaining(['CU-34-90', 'CU-34-CPL']),
    );
    expect(q('ballcock').items[0].part_code).toBe('00417-B'); // alias
    expect(q('leading zeros').items[0].part_code).toBe('00417-B'); // description
    expect(q('filters').items.length).toBeGreaterThanOrEqual(4); // category
    expect(q('zzzzqq').total).toBe(0);
    expect(q('00417').items[0].part_code).toBe('00417-B'); // leading zeros survive
    const hit = q('CU-34-90').items[0];
    expect(hit.locations[0]).toMatchObject({
      slot_id: 'slt-4hq8wz2k',
      shelf_id: expect.any(String),
      location_code: 'B1-G-4',
    });
    expect(
      get<{ items: Part[] }>('/api/parts?category=Filters').body.items.every((p) => p.category === 'Filters'),
    ).toBe(true);
    const page = get<{ items: Part[]; total: number; limit: number; offset: number }>(
      '/api/parts?limit=5&offset=5',
    ).body;
    expect(page.items).toHaveLength(5);
    expect(page).toMatchObject({ limit: 5, offset: 5 });
    expect(page.total).toBe(DEMO_DATA.parts.length);
  });
  it('creates, edits (with version) and registers parts; ids are minted by the server', () => {
    const created = post<{ part: Part }>('/api/parts', {
      part_code: 'NEW-1',
      part_name: 'New thing',
      cost: 1,
      sale_price: 2,
      reorder_point: 3,
      width_in: 2,
    });
    expect(created.status).toBe(201);
    expect(isPartId(created.body.part.part_id)).toBe(true);
    expect(created.body.part).toMatchObject({ version: 1, active: true, locations: [] });
    expect(post('/api/parts', { part_code: 'new-1', part_name: 'Dup' }).status).toBe(400); // code reuse (case-insensitive)
    expect(post('/api/parts', { part_code: '', part_name: 'x' }).status).toBe(400);
    const id = created.body.part.part_id;
    const stale = call('PATCH', `/api/parts/${id}`, { version: 7, part_name: 'x' });
    expect(stale.status).toBe(409);
    expect(err(stale).error).toBe('version_conflict');
    expect((err(stale).current as Part).part_name).toBe('New thing');
    const ok = call<{ part: Part }>('PATCH', `/api/parts/${id}`, {
      version: 1,
      part_name: 'Renamed',
      depth_in: 3,
    });
    expect(ok.body.part).toMatchObject({ part_name: 'Renamed', depth_in: 3, version: 2 });
    expect(call('PATCH', `/api/parts/${id}`, { part_name: 'no version' }).status).toBe(400);

    const reg = post<{ results: { status: string; part_id: string | null }[] }>('/api/parts/register', {
      rows: [
        { part_code: 'NEW-1', part_name: 'Renamed' },
        { part_code: 'NEW-1', part_name: 'Something else' },
        { part_code: 'BRAND-2', part_name: 'Brand new' },
        { part_code: '', part_name: 'x' },
      ],
    });
    expect(reg.body.results.map((r) => r.status)).toEqual(['reused', 'conflict', 'new', 'conflict']);
    expect(reg.body.results[0].part_id).toBe(id);
    expect(isPartId(reg.body.results[2].part_id)).toBe(true);
    assertConsistent();
  });
});

// ------------------------------------------------------------------------------------------
// stock adjust, version checks, events and undo
// ------------------------------------------------------------------------------------------

describe('stock adjust', () => {
  const adjust = (body: object, role: Role = 'editor') =>
    post<{ location: Location; par_total: number; on_hand_total: number; event_id: string }>(
      '/api/stock/adjust',
      { part_id: 'prt-k7m2qx9d', slot_id: 'slt-4hq8wz2k', ...body },
      role,
    );

  it('delta is relative, bumps the row version and records an event', () => {
    const r = adjust({ delta: 1, reason: 'Received' });
    expect(r.status).toBe(200);
    expect(r.body.location).toMatchObject({ on_hand_qty: 63, version: 2 });
    expect(r.body.on_hand_total).toBe(63);
    expect(isEventId(r.body.event_id)).toBe(true);
    const ev = get<{ items: { action: string; reason: string; by: string; entity: string }[] }>(
      '/api/events?entity=location&entity_id=prt-k7m2qx9d',
    ).body.items[0];
    expect(ev).toMatchObject({ action: 'adjust', reason: 'Received', entity: 'location' });
    expect(ev.by).toMatch(/@/);
    expect(adjust({ delta: -63 }).body.location.on_hand_qty).toBe(0);
  });
  it('never goes below 0', () => {
    const r = adjust({ delta: -63 });
    expect(r.status).toBe(400);
    expect(err(r).fields?.delta).toMatch(/below 0/);
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(62);
    expect(adjust({ set: -1, version: 1 }).status).toBe(400);
    assertConsistent();
  });
  it('validates input: exactly one of delta/set, whole numbers, known part and slot', () => {
    expect(adjust({}).status).toBe(400);
    expect(adjust({ delta: 1, set: 5, version: 1 }).status).toBe(400);
    expect(adjust({ delta: 1.5 }).status).toBe(400);
    expect(adjust({ delta: 'a' }).status).toBe(400);
    expect(adjust({ part_id: 'prt-22222222', delta: 1 }).status).toBe(404);
    expect(adjust({ slot_id: 'slt-22222222', delta: 1 }).status).toBe(404);
    expect(adjust({ slot_id: partByCode('PVC-3-SAN').locations[0].slot_id, delta: 1 }).status).toBe(404); // part is not in that slot
  });
  it('set (a count) requires the location version, stamps counted_at/by, and detects conflicts', () => {
    expect(adjust({ set: 40 }).status).toBe(400); // no version
    const ok = adjust({ set: 40, version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.location).toMatchObject({
      on_hand_qty: 40,
      version: 2,
      counted_by: expect.stringMatching(/@/),
    });
    expect(Date.parse(ok.body.location.counted_at!)).toBeGreaterThan(Date.parse('2026-10-28T00:00:00Z'));
    const stale = adjust({ set: 10, version: 1 }); // someone else already changed it
    expect(stale.status).toBe(409);
    expect(err(stale).error).toBe('version_conflict');
    expect((err(stale).current as Location).on_hand_qty).toBe(40);
    expect((err(stale).current as Location).version).toBe(2);
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(40); // unchanged by the failed write
    // "Keep mine" (admin): resend with the current version
    expect(adjust({ set: 10, version: 2 }, 'admin').body.location.on_hand_qty).toBe(10);
  });
  it('a delta never conflicts, even after other changes', () => {
    adjust({ set: 50, version: 1 });
    expect(adjust({ delta: 2 }).body.location.on_hand_qty).toBe(52);
  });
  it('undo restores the count; a second undo and a stale undo are refused', () => {
    const a = adjust({ delta: 5 });
    const undone = post(`/api/events/${a.body.event_id}/undo`, {});
    expect(undone.status).toBe(200);
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(62);
    const again = post(`/api/events/${a.body.event_id}/undo`, {});
    expect(again.status).toBe(409);
    expect(err(again).error).toBe('undo_stale');

    const first = adjust({ delta: 3 });
    adjust({ delta: 4 }); // a later change on the same row
    const stale = post(`/api/events/${first.body.event_id}/undo`, {});
    expect(stale.status).toBe(409);
    expect(err(stale).error).toBe('undo_stale');
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(69);
    expect(post('/api/events/evt-22222222/undo', {}).status).toBe(404);
    expect(post(`/api/events/${a.body.event_id}/undo`, {}, 'viewer').status).toBe(403);
    assertConsistent();
  });
});

// ------------------------------------------------------------------------------------------
// moving, swapping, sharing
// ------------------------------------------------------------------------------------------

describe('move / add / share / swap', () => {
  const move = (body: object, role: Role = 'editor') =>
    post<{ part: Part; event_id: string; displaced_parts?: { part_id: string }[] }>(
      '/api/locations/move',
      body,
      role,
    );
  const elbow = () => partByCode('CU-34-90');

  it('move: par and on-hand carry along and the old slot is vacated', () => {
    const to = slotByCode('B1-G-5');
    expect(to.part_count).toBe(0);
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: to.slot_id,
      mode: 'move',
    });
    expect(r.status).toBe(200);
    expect(r.body.part.locations).toHaveLength(1);
    expect(r.body.part.locations[0]).toMatchObject({
      location_code: 'B1-G-5',
      par_qty: 100,
      on_hand_qty: 62,
    });
    expect(slotByCode('B1-G-4').part_count).toBe(0);
    expect(slotByCode('B1-G-5').part_count).toBe(1);
    assertConsistent();
  });
  it('move into an occupied slot answers 409 slot_occupied with who is there', () => {
    const before = loadMockState().seq;
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-6').slot_id,
      mode: 'move',
    });
    expect(r.status).toBe(409);
    expect(err(r)).toMatchObject({ error: 'slot_occupied' });
    expect(err(r).conflicts).toEqual([
      {
        slot_id: slotByCode('B1-G-6').slot_id,
        location_code: 'B1-G-6',
        parts: [
          {
            part_id: partByCode('FLEX-12-20').part_id,
            part_name: 'Faucet Supply Line, 20" Braided',
            on_hand_qty: 30,
          },
        ],
      },
    ]);
    expect(loadMockState().seq).toBe(before); // nothing was written
    expect(elbow().locations[0].location_code).toBe('B1-G-4');
  });
  it('lists several occupants', () => {
    const shared = slotByCode('A2-G-1');
    expect(shared.part_count).toBe(2);
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: shared.slot_id,
      mode: 'move',
    });
    expect(err(r).conflicts![0].parts).toHaveLength(2);
  });
  it('share (with the old slot) moves in and co-locates', () => {
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-6').slot_id,
      mode: 'share',
    });
    expect(r.status).toBe(200);
    expect(r.body.part.locations.map((l) => l.location_code)).toEqual(['B1-G-6']);
    expect(r.body.part.locations[0].co_located_parts.map((c) => c.part_name)).toEqual([
      'Faucet Supply Line, 20" Braided',
    ]);
    expect(r.body.part.locations[0]).toMatchObject({ par_qty: 100, on_hand_qty: 62 });
    expect(slotByCode('B1-G-4').part_count).toBe(0);
    assertConsistent();
  });
  it('share without an old slot just adds a second location', () => {
    const r = move({
      part_id: elbow().part_id,
      to_slot_id: slotByCode('B1-G-6').slot_id,
      mode: 'share',
      par_qty: 10,
      on_hand_qty: 5,
    });
    expect(r.body.part.locations.map((l) => l.location_code).sort()).toEqual(['B1-G-4', 'B1-G-6']);
    expect(r.body.part.par_total).toBe(110);
    expect(r.body.part.on_hand_total).toBe(67);
  });
  it('add keeps the old slot; on-hand starts at 0 unless given', () => {
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-5').slot_id,
      mode: 'add',
    });
    expect(
      r.body.part.locations.map((l) => `${l.location_code}:${l.par_qty}/${l.on_hand_qty}`).sort(),
    ).toEqual(['B1-G-4:100/62', 'B1-G-5:100/0']);
    expect(
      move({ part_id: elbow().part_id, to_slot_id: slotByCode('B1-G-5').slot_id, mode: 'add' }).status,
    ).toBe(400); // already there
    const occupied = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-6').slot_id,
      mode: 'add',
    });
    expect(occupied.status).toBe(409);
  });
  it('assigns a part with no location for the first time', () => {
    const float = partByCode('SW-FLOAT-01');
    const to = freeSlots('A1')[0];
    const r = move({
      part_id: float.part_id,
      to_slot_id: to.slot_id,
      mode: 'add',
      par_qty: 8,
      on_hand_qty: 3,
    });
    expect(r.status).toBe(200);
    expect(r.body.part.locations[0]).toMatchObject({ slot_id: to.slot_id, par_qty: 8, on_hand_qty: 3 });
    assertConsistent();
  });
  it("swap exchanges places with unequal slots and keeps each part's own quantities", () => {
    const a = elbow(); // B1-G-4, 2 wide, 100/62
    const b = partByCode('FLEX-12-20'); // B1-G-6, 2 wide, 30/30
    const r = move({
      part_id: a.part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: b.locations[0].slot_id,
      mode: 'swap',
    });
    expect(r.status).toBe(200);
    expect(r.body.displaced_parts!.map((d) => d.part_id)).toEqual([b.part_id]);
    expect(loc('CU-34-90', 'B1-G-6')).toMatchObject({ par_qty: 100, on_hand_qty: 62 });
    expect(loc('FLEX-12-20', 'B1-G-4')).toMatchObject({ par_qty: 30, on_hand_qty: 30 });
    assertConsistent();
  });
  it('swap with a two-part slot sends both occupants to the old slot', () => {
    const pex = partByCode('PEX-12-RING');
    const from = pex.locations[0].slot_id;
    const r = move({
      part_id: pex.part_id,
      from_slot_id: from,
      to_slot_id: slotByCode('A2-G-1').slot_id,
      mode: 'swap',
    });
    expect(r.body.displaced_parts).toHaveLength(2);
    expect(slotByCode('A2-G-1').part_ids).toEqual([pex.part_id]);
    expect(partByCode('PVC-2-90').locations[0].slot_id).toBe(from);
    expect(partByCode('PVC-2-CPL').locations[0].slot_id).toBe(from);
    assertConsistent();
  });
  it('swap needs an old slot and an occupant', () => {
    expect(
      move({ part_id: elbow().part_id, to_slot_id: slotByCode('B1-G-6').slot_id, mode: 'swap' }).status,
    ).toBe(400);
    expect(
      move({
        part_id: elbow().part_id,
        from_slot_id: 'slt-4hq8wz2k',
        to_slot_id: slotByCode('B1-G-5').slot_id,
        mode: 'swap',
      }).status,
    ).toBe(400);
  });
  it('validates move input', () => {
    const base = {
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-5').slot_id,
    };
    expect(move({ ...base, mode: 'teleport' }).status).toBe(400);
    expect(move({ ...base, mode: 'move', from_slot_id: undefined }).status).toBe(400);
    expect(move({ ...base, mode: 'move', to_slot_id: 'slt-4hq8wz2k' }).status).toBe(400); // same slot
    expect(move({ ...base, mode: 'move', to_slot_id: 'slt-22222222' }).status).toBe(404);
    expect(move({ ...base, mode: 'move', from_slot_id: slotByCode('B1-G-2').slot_id }).status).toBe(404); // not in that old slot
    expect(move({ ...base, mode: 'move', on_hand_qty: -1 }).status).toBe(400);
    expect(move({ ...base, mode: 'move', par_qty: 1.5 }).status).toBe(400);
    expect(move({ ...base, mode: 'move' }, 'viewer').status).toBe(403);
  });
  it('move can override the carried quantities', () => {
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-5').slot_id,
      mode: 'move',
      par_qty: 120,
      on_hand_qty: 60,
    });
    expect(r.body.part.locations[0]).toMatchObject({ par_qty: 120, on_hand_qty: 60 });
  });
  it('every move is undoable, including swap', () => {
    const b = partByCode('FLEX-12-20');
    const r = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: b.locations[0].slot_id,
      mode: 'swap',
    });
    expect(post(`/api/events/${r.body.event_id}/undo`, {}).status).toBe(200);
    expect(loc('CU-34-90', 'B1-G-4')).toMatchObject({ par_qty: 100, on_hand_qty: 62 });
    expect(loc('FLEX-12-20', 'B1-G-6')).toMatchObject({ par_qty: 30, on_hand_qty: 30 });
    const m = move({
      part_id: elbow().part_id,
      from_slot_id: 'slt-4hq8wz2k',
      to_slot_id: slotByCode('B1-G-5').slot_id,
      mode: 'move',
    });
    expect(post(`/api/events/${m.body.event_id}/undo`, {}).status).toBe(200);
    expect(elbow().locations.map((l) => l.location_code)).toEqual(['B1-G-4']);
    assertConsistent();
  });
});

describe('remove from slot', () => {
  it('is soft: the part stays, can be put back, and undo restores quantities', () => {
    const p = partByCode('CU-34-90');
    const del = call<{ part: Part; event_id: string }>('DELETE', '/api/locations', {
      part_id: p.part_id,
      slot_id: 'slt-4hq8wz2k',
    });
    expect(del.status).toBe(200);
    expect(del.body.part.locations).toHaveLength(0);
    expect(get(`/api/parts/${p.part_id}`).status).toBe(200);
    expect(call('DELETE', '/api/locations', { part_id: p.part_id, slot_id: 'slt-4hq8wz2k' }).status).toBe(
      404,
    ); // already gone
    const back = post<{ part: Part }>('/api/locations/move', {
      part_id: p.part_id,
      to_slot_id: 'slt-4hq8wz2k',
      mode: 'add',
      par_qty: 100,
      on_hand_qty: 7,
    });
    expect(back.body.part.locations[0]).toMatchObject({ on_hand_qty: 7 });
    const undoBack = post(`/api/events/${back.body.part ? del.body.event_id : ''}/undo`, {});
    expect(undoBack.status).toBe(409); // stock row changed since: stale
    assertConsistent();
  });
  it('undo of a plain remove restores the exact row', () => {
    const p = partByCode('CU-34-90');
    const del = call<{ event_id: string }>('DELETE', '/api/locations', {
      part_id: p.part_id,
      slot_id: 'slt-4hq8wz2k',
    });
    expect(post(`/api/events/${del.body.event_id}/undo`, {}).status).toBe(200);
    expect(loc('CU-34-90', 'B1-G-4')).toMatchObject({ par_qty: 100, on_hand_qty: 62 });
  });
});

// ------------------------------------------------------------------------------------------
// shelves
// ------------------------------------------------------------------------------------------

describe('shelves', () => {
  it('lists shelves grouped by zone and returns one shelf with slots and occupants', () => {
    const groups = get<{
      groups: { zone_name: string; shelves: { name: string; slot_count: number; part_count: number }[] }[];
    }>('/api/shelves').body.groups;
    expect(groups.map((g) => g.zone_name)).toEqual([
      'WAREHOUSE 126',
      'STORAGE - PARTS & TOOLS 121',
      'STORAGE - FILTERS 120',
    ]);
    expect(groups[0].shelves.map((s) => s.name)).toEqual(['A1', 'A2']);
    expect(groups[1].shelves[0]).toMatchObject({ name: 'B1', slot_count: 12, part_count: 6 });
    const shelfId = layout().shelves.find((s) => s.name === 'B1')!.shelf_id;
    const shelf = get<Shelf>(`/api/shelves/${shelfId}`).body;
    expect(shelf.zone_name).toBe('STORAGE - PARTS & TOOLS 121');
    expect(shelf.rows).toHaveLength(5);
    expect(shelf.slots).toHaveLength(12);
    expect(shelf.slots.find((s) => s.location_code === 'B1-G-4')!.parts[0]).toMatchObject({
      part_code: 'CU-34-90',
      on_hand_qty: 62,
      par_qty: 100,
    });
    expect(get('/api/shelves/shf-22222222').status).toBe(404);
  });
  it('creates a shelf with a server-minted id; rejects bad input and duplicate names', () => {
    const shelf = makeTestShelf('T1');
    expect(isShelfId(shelf.shelf_id)).toBe(true);
    expect(shelf).toMatchObject({ name: 'T1', version: 1, zone_name: 'WAREHOUSE 126', slots: [] });
    const zone = DEMO_DATA.zones[0].zone_id;
    const base = {
      name: 'T2',
      zone_id: zone,
      x_in: 0,
      y_in: 0,
      rotation_deg: 0,
      width_in: 72,
      depth_in: 24,
      height_in: 64,
      cols: 6,
      rows: SMALL_ROWS,
    };
    expect(post('/api/shelves', { ...base, name: 't1' }).status).toBe(400); // name clash (case-insensitive)
    expect(post('/api/shelves', { ...base, rows: [] }).status).toBe(400);
    expect(post('/api/shelves', { ...base, rows: [{ ...SMALL_ROWS[0], row_index: 1 }] }).status).toBe(400);
    expect(post('/api/shelves', { ...base, zone_id: 'zon-22222222' }).status).toBe(400);
    expect(post('/api/shelves', { ...base, width_in: 0 }).status).toBe(400);
    expect(post('/api/shelves', { ...base, cols: 2.5 }).status).toBe(400);
    expect(post('/api/shelves', base, 'viewer').status).toBe(403);
  });
  it('patch needs the version and refuses a grid that no longer fits its slots', () => {
    const shelf = makeTestShelf('T1', 6);
    addSlot(shelf.shelf_id, 0, 5, 2);
    const stale = call('PATCH', `/api/shelves/${shelf.shelf_id}`, { version: 9, name: 'X' });
    expect(stale.status).toBe(409);
    expect(err(stale).error).toBe('version_conflict');
    expect((err(stale).current as Shelf).name).toBe('T1');
    const tooSmall = call('PATCH', `/api/shelves/${shelf.shelf_id}`, { version: 1, cols: 4 });
    expect(tooSmall.status).toBe(409);
    expect(err(tooSmall).error).toBe('slot_out_of_bounds');
    const moved = call<{ shelf: Shelf }>('PATCH', `/api/shelves/${shelf.shelf_id}`, {
      version: 1,
      x_in: 300,
      rotation_deg: 90,
      name: 'T9',
    });
    expect(moved.body.shelf).toMatchObject({ x_in: 300, rotation_deg: 90, name: 'T9', version: 2 });
    expect(moved.body.shelf.slots[0].location_code).toBe('T9-G-1'); // codes follow the shelf name
    assertConsistent();
  });
  it('delete refuses a shelf that holds parts; only an admin can force; empty shelves delete and undo', () => {
    const a1 = layout().shelves.find((s) => s.name === 'A1')!;
    const refused = call('DELETE', `/api/shelves/${a1.shelf_id}`, {});
    expect(refused.status).toBe(409);
    expect(err(refused).error).toBe('shelf_not_empty');
    expect(call('DELETE', `/api/shelves/${a1.shelf_id}`, { force: true }, 'editor').status).toBe(403);
    const forced = call<{ event_id: string }>(
      'DELETE',
      `/api/shelves/${a1.shelf_id}`,
      { force: true },
      'admin',
    );
    expect(forced.status).toBe(200);
    expect(layout().shelves.some((s) => s.name === 'A1')).toBe(false);
    expect(partByCode('WH-ANODE-34').locations).toHaveLength(0);
    expect(post(`/api/events/${forced.body.event_id}/undo`, {}, 'admin').status).toBe(200);
    expect(partByCode('WH-ANODE-34').locations).toHaveLength(1);

    const t = makeTestShelf('T1');
    addSlot(t.shelf_id, 0, 1, 2);
    const del = call<{ event_id: string }>('DELETE', `/api/shelves/${t.shelf_id}`, {});
    expect(del.status).toBe(200);
    expect(get(`/api/shelves/${t.shelf_id}`).status).toBe(404);
    expect(post(`/api/events/${del.body.event_id}/undo`, {}).status).toBe(200);
    expect(get(`/api/shelves/${t.shelf_id}`).status).toBe(200);
    assertConsistent();
  });
  it("duplicate copies rows and empty slots one shelf-width to the viewer's right", () => {
    const b1 = layout().shelves.find((s) => s.name === 'B1')!;
    const r = post<{ shelf: Shelf }>(`/api/shelves/${b1.shelf_id}/duplicate`, {});
    expect(r.status).toBe(201);
    const copy = r.body.shelf;
    expect(isShelfId(copy.shelf_id)).toBe(true);
    expect(copy.name).toBe('B2');
    expect(copy.slots).toHaveLength(b1.slots.length);
    expect(copy.slots.every((s) => s.parts.length === 0)).toBe(true);
    expect(
      copy.slots.every((s) => isSlotId(s.slot_id) && !b1.slots.some((o) => o.slot_id === s.slot_id)),
    ).toBe(true);
    // B1 is rotation 180 at (240,1651): its width runs west, so the copy starts at x = 240 - 96
    expect([copy.x_in, copy.y_in]).toEqual([144, 1651]);
    expect(copy.rotation_deg).toBe(180);
    assertConsistent();
  });
});

// ------------------------------------------------------------------------------------------
// slots: create, resize, delete
// ------------------------------------------------------------------------------------------

describe('slots', () => {
  it('create: server id, left-to-right numbers, refuses overlap and out-of-bounds', () => {
    const shelf = makeTestShelf('T1', 6);
    const s1 = addSlot(shelf.shelf_id, 0, 1, 2);
    expect(s1.status).toBe(201);
    expect(isSlotId(s1.body.slot.slot_id)).toBe(true);
    expect(s1.body.slot).toMatchObject({ slot_no: 1, location_code: 'T1-G-1', version: 1 });
    expect(addSlot(shelf.shelf_id, 0, 5, 2).body.slot.slot_no).toBe(2);
    expect(addSlot(shelf.shelf_id, 0, 3, 2).body.slot.slot_no).toBe(2 + 1); // 2 is taken, so one past the highest
    const overlap = addSlot(shelf.shelf_id, 0, 2, 2);
    expect(overlap.status).toBe(409);
    expect(err(overlap).error).toBe('slot_occupied');
    expect(err(overlap).conflicts![0].location_code).toBe('T1-G-1');
    expect(addSlot(shelf.shelf_id, 0, 6, 2).status).toBe(409); // past the right edge
    expect(err(addSlot(shelf.shelf_id, 0, 6, 2)).error).toBe('slot_out_of_bounds');
    expect(err(addSlot(shelf.shelf_id, 2, 1, 1, 2)).error).toBe('slot_out_of_bounds'); // past the top
    expect(addSlot(shelf.shelf_id, 0, 1, 0).status).toBe(400);
    expect(addSlot(shelf.shelf_id, 0, 1.5, 1).status).toBe(400);
    expect(addSlot('shf-22222222', 0, 1, 1).status).toBe(404);
    assertConsistent();
  });
  it('resize grows right and up from the bottom-left anchor by default', () => {
    const shelf = makeTestShelf('T1', 6);
    const s = addSlot(shelf.shelf_id, 0, 2, 1).body.slot;
    const r = post<{ slot: Shelf['slots'][number] }>(`/api/slots/${s.slot_id}/resize`, {
      width_span: 3,
      height_span: 2,
      version: s.version,
    });
    expect(r.status).toBe(200);
    expect(r.body.slot).toMatchObject({
      col_start: 2,
      row_index: 0,
      width_span: 3,
      height_span: 2,
      version: 2,
    });
  });
  it('resize honours the other anchors and explicit positions', () => {
    const shelf = makeTestShelf('T1', 6);
    const s = addSlot(shelf.shelf_id, 1, 3, 2).body.slot; // cols 3-4, row 1
    const left = post<{ slot: Shelf['slots'][number] }>(`/api/slots/${s.slot_id}/resize`, {
      width_span: 3,
      height_span: 1,
      anchor: 'bottom-right',
      version: 1,
    });
    expect(left.body.slot).toMatchObject({ col_start: 2, width_span: 3 }); // right edge (col 4) stayed
    const down = post<{ slot: Shelf['slots'][number] }>(`/api/slots/${s.slot_id}/resize`, {
      width_span: 3,
      height_span: 2,
      anchor: 'top-left',
      version: 2,
    });
    expect(down.body.slot).toMatchObject({ row_index: 0, height_span: 2, col_start: 2 }); // top row (1) stayed, grew down
    const explicit = post<{ slot: Shelf['slots'][number] }>(`/api/slots/${s.slot_id}/resize`, {
      width_span: 1,
      height_span: 1,
      col_start: 6,
      row_index: 2,
      version: 3,
    });
    expect(explicit.body.slot).toMatchObject({ col_start: 6, row_index: 2, width_span: 1, height_span: 1 });
    assertConsistent();
  });
  it('resize never overlaps a neighbor and names who is in the way', () => {
    const shelf = makeTestShelf('T1', 6);
    const a = addSlot(shelf.shelf_id, 0, 1, 2).body.slot;
    const b = addSlot(shelf.shelf_id, 0, 3, 2).body.slot;
    const sprout = addSlot(shelf.shelf_id, 1, 1, 6).body.slot;
    const part = partByCode('SW-FLOAT-01');
    post('/api/locations/move', {
      part_id: part.part_id,
      to_slot_id: b.slot_id,
      mode: 'add',
      par_qty: 5,
      on_hand_qty: 2,
    });
    const hit = post(`/api/slots/${a.slot_id}/resize`, { width_span: 3, height_span: 1, version: a.version });
    expect(hit.status).toBe(409);
    expect(err(hit).error).toBe('slot_occupied');
    expect(err(hit).conflicts).toEqual([
      {
        slot_id: b.slot_id,
        location_code: 'T1-G-2',
        parts: [{ part_id: part.part_id, part_name: 'Condensate Float Switch', on_hand_qty: 2 }],
      },
    ]);
    const up = post(`/api/slots/${a.slot_id}/resize`, { width_span: 2, height_span: 2, version: a.version });
    expect(up.status).toBe(409); // row 1 is one long slot
    expect(err(up).conflicts![0].slot_id).toBe(sprout.slot_id);
    expect(err(up).conflicts![0].parts).toEqual([]); // empty neighbor
    const outside = post(`/api/slots/${a.slot_id}/resize`, {
      width_span: 7,
      height_span: 1,
      version: a.version,
    });
    expect(err(outside).error).toBe('slot_out_of_bounds');
    const stale = post(`/api/slots/${a.slot_id}/resize`, { width_span: 1, height_span: 1, version: 5 });
    expect(stale.status).toBe(409);
    expect(err(stale).error).toBe('version_conflict');
    expect(post(`/api/slots/${a.slot_id}/resize`, { width_span: 1, height_span: 1 }).status).toBe(400); // no version
    expect(post(`/api/slots/${a.slot_id}/resize`, { width_span: 0, height_span: 1, version: 1 }).status).toBe(
      400,
    );
    expect(
      post(`/api/slots/${a.slot_id}/resize`, { width_span: 1, height_span: 1, version: 1 }, 'viewer').status,
    ).toBe(403);
    assertConsistent();
  });
  it('patch edits bin fields (with version) and the slot number (unique per row)', () => {
    const shelf = makeTestShelf('T1', 6);
    const a = addSlot(shelf.shelf_id, 0, 1, 2).body.slot;
    const b = addSlot(shelf.shelf_id, 0, 3, 2).body.slot;
    const ok = call<{ slot: Shelf['slots'][number] }>('PATCH', `/api/slots/${a.slot_id}`, {
      version: 1,
      bin_type: 'tote',
      bin_width_in: 20,
      bin_height_in: 9.5,
      bin_depth_in: 18,
      bin_color: '#123456',
    });
    expect(ok.body.slot).toMatchObject({
      bin_type: 'tote',
      bin_width_in: 20,
      bin_height_in: 9.5,
      bin_depth_in: 18,
      bin_color: '#123456',
      version: 2,
    });
    expect(call('PATCH', `/api/slots/${a.slot_id}`, { version: 1, bin_width_in: 5 }).status).toBe(409);
    expect(call('PATCH', `/api/slots/${a.slot_id}`, { version: 2, bin_type: 'barrel' }).status).toBe(400);
    expect(call('PATCH', `/api/slots/${a.slot_id}`, { version: 2, bin_width_in: -3 }).status).toBe(400);
    expect(call('PATCH', `/api/slots/${a.slot_id}`, { version: 2, slot_no: b.slot_no }).status).toBe(400);
    expect(
      call<{ slot: Shelf['slots'][number] }>('PATCH', `/api/slots/${a.slot_id}`, { version: 2, slot_no: 9 })
        .body.slot.location_code,
    ).toBe('T1-G-9');
    // a bin bigger than its slot is stored: clients warn, the server does not block
    expect(call('PATCH', `/api/slots/${a.slot_id}`, { version: 3, bin_width_in: 500 }).status).toBe(200);
    assertConsistent();
  });
  it('delete: refuses a slot with parts, removes an empty one, and undo brings it back', () => {
    const full = slotByCode('B1-G-4');
    const refused = call('DELETE', `/api/slots/${full.slot_id}`, {});
    expect(refused.status).toBe(409);
    expect(err(refused).error).toBe('slot_not_empty');
    const empty = slotByCode('B1-G-5');
    const del = call<{ event_id: string }>('DELETE', `/api/slots/${empty.slot_id}`, {});
    expect(del.status).toBe(200);
    expect(
      layout()
        .shelves.find((s) => s.name === 'B1')!
        .slots.some((s) => s.slot_id === empty.slot_id),
    ).toBe(false);
    expect(post(`/api/events/${del.body.event_id}/undo`, {}).status).toBe(200);
    expect(slotByCode('B1-G-5').slot_id).toBe(empty.slot_id);
    assertConsistent();
  });
});

// ------------------------------------------------------------------------------------------
// layout, geometry, export, persistence
// ------------------------------------------------------------------------------------------

describe('layout', () => {
  it('returns zones, openings and shelves with aggregate slot data and an ETag', () => {
    const res = get<Layout>('/api/layout');
    expect(res.headers.ETag).toBe(`"${res.body.layout_version}"`);
    expect(res.body.zones).toHaveLength(11);
    expect(res.body.zones.filter((z) => z.area_kind === null)).toHaveLength(9);
    expect(res.body.openings).toHaveLength(18);
    expect(res.body.shelves.map((s) => s.name)).toEqual(['A1', 'A2', 'B1', 'F1']);
    expect(res.body.shelves[0]).not.toHaveProperty('active');
    const slot = slotByCode('B1-G-3');
    expect(slot).toMatchObject({ part_count: 1, on_hand_total: 24, par_total: 80, low: true });
    expect(slot.part_ids).toHaveLength(1);
    expect(slotByCode('B1-G-5')).toMatchObject({ part_count: 0, low: false, part_ids: [] });
    expect(slotByCode('A2-G-1')).toMatchObject({ part_count: 2 });
  });
  it('honours If-None-Match and changes after a write', () => {
    const first = handleMockRequest('GET', '/api/layout', { role: 'viewer' });
    const same = handleMockRequest('GET', '/api/layout', {
      role: 'viewer',
      headers: { 'If-None-Match': first.headers.ETag },
    });
    expect(same.status).toBe(304);
    post('/api/stock/adjust', { part_id: 'prt-k7m2qx9d', slot_id: 'slt-4hq8wz2k', delta: 1 });
    const after = handleMockRequest('GET', '/api/layout', {
      role: 'viewer',
      headers: { 'If-None-Match': first.headers.ETag },
    });
    expect(after.status).toBe(200);
    expect(after.headers.ETag).not.toBe(first.headers.ETag);
  });
  it('slot geometry on the map stays inside each shelf zone', () => {
    const s = layout();
    for (const shelf of s.shelves) {
      const zone = s.zones.find((z) => z.zone_id === shelf.zone_id)!;
      const xs = zone.polygon_in.map((p) => p[0]);
      const ys = zone.polygon_in.map((p) => p[1]);
      for (const [x, y] of shelfCorners(shelf)) {
        expect(x).toBeGreaterThanOrEqual(Math.min(...xs));
        expect(x).toBeLessThanOrEqual(Math.max(...xs));
        expect(y).toBeGreaterThanOrEqual(Math.min(...ys));
        expect(y).toBeLessThanOrEqual(Math.max(...ys));
      }
    }
  });
});

describe('zones and openings', () => {
  it('lists, creates, and patches with version checks (admin)', () => {
    expect(get<{ items: unknown[] }>('/api/zones').body.items).toHaveLength(11);
    expect(get<{ items: unknown[] }>('/api/openings').body.items).toHaveLength(18);
    const zone = DEMO_DATA.zones[0];
    const stale = call('PATCH', `/api/zones/${zone.zone_id}`, { version: 5, verified: true }, 'admin');
    expect(stale.status).toBe(409);
    const ok = call<{ zone: { verified: boolean; version: number } }>(
      'PATCH',
      `/api/zones/${zone.zone_id}`,
      { version: 1, verified: true, wall_height_in: 200 },
      'admin',
    );
    expect(ok.body.zone).toMatchObject({ verified: true, version: 2 });
    expect(
      call('PATCH', `/api/zones/${zone.zone_id}`, { version: 2, verified: false }, 'editor').status,
    ).toBe(403);
    const op = post<{ opening: { opening_id: string; height_in: number } }>(
      '/api/openings',
      {
        kind: 'overhead',
        tag: 'X',
        x1_in: 0,
        y1_in: 0,
        x2_in: 0,
        y2_in: 100,
        zone_id: zone.zone_id,
        notes: '',
      },
      'admin',
    );
    expect(op.status).toBe(201);
    expect(op.body.opening.height_in).toBe(168);
    expect(
      post('/api/openings', { kind: 'gate', x1_in: 0, y1_in: 0, x2_in: 0, y2_in: 1 }, 'admin').status,
    ).toBe(400);
  });

  it('creates and patches area_kind, defaulting to an ordinary room', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const room = post<{ zone: Zone }>('/api/zones', { name: 'Plain room', polygon_in: square }, 'admin');
    expect(room.status).toBe(201);
    expect(room.body.zone.area_kind).toBeNull();
    const area = post<{ zone: Zone }>(
      '/api/zones',
      { name: 'Tool crib', polygon_in: square, open_edges: [0, 1, 2, 3], area_kind: 'tools' },
      'admin',
    );
    expect(area.body.zone).toMatchObject({ area_kind: 'tools', open_edges: [0, 1, 2, 3] });
    expect(
      post('/api/zones', { name: 'Bad area', polygon_in: square, area_kind: 'office' }, 'admin').status,
    ).toBe(400);
    const patched = call<{ zone: Zone }>(
      'PATCH',
      `/api/zones/${area.body.zone.zone_id}`,
      { version: 1, area_kind: 'packouts' },
      'admin',
    );
    expect(patched.body.zone).toMatchObject({ area_kind: 'packouts', version: 2 });
    const cleared = call<{ zone: Zone }>(
      'PATCH',
      `/api/zones/${area.body.zone.zone_id}`,
      { version: 2, area_kind: null },
      'admin',
    );
    expect(cleared.body.zone.area_kind).toBeNull();
    expect(
      call('PATCH', `/api/zones/${area.body.zone.zone_id}`, { version: 3, area_kind: 'tools' }, 'editor').status,
    ).toBe(403);
  });
});

describe('export and events', () => {
  it('exports one row per part per slot, plus blank-location rows', () => {
    const res = get<string>('/api/export.csv');
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toContain('location_code');
    expect(lines).toHaveLength(1 + 26 + 1); // 26 stock rows, plus SW-FLOAT-01 with no location... +1 for SB-12-BV's second slot is in the 26
    expect(res.body).toContain('B1-G-4');
    expect(res.body).toMatch(
      /SW-FLOAT-01,Condensate Float Switch,Controls,HVAC Service,each,8.9,21,4,,,,,,,,/,
    );
  });
  it('events list newest first and can be filtered', () => {
    post('/api/stock/adjust', { part_id: 'prt-k7m2qx9d', slot_id: 'slt-4hq8wz2k', delta: 1 });
    makeTestShelf('T1');
    const all = get<{ items: { entity: string }[] }>('/api/events').body.items;
    expect(all.map((e) => e.entity)).toEqual(['shelf', 'location']);
    expect(get<{ items: unknown[] }>('/api/events?entity=shelf').body.items).toHaveLength(1);
    expect(get<{ items: unknown[] }>('/api/events?limit=1').body.items).toHaveLength(1);
  });
});

describe('persistence and atomicity', () => {
  it('state survives in storage and Reset restores the demo data', () => {
    post('/api/stock/adjust', { part_id: 'prt-k7m2qx9d', slot_id: 'slt-4hq8wz2k', delta: 10 });
    // a second "tab" reading the same storage sees it
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(72);
    resetState();
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(62);
    expect(get<{ items: unknown[] }>('/api/events').body.items).toHaveLength(0);
  });
  it('works without any storage (falls back to memory)', () => {
    setMockStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    resetState();
    expect(
      post('/api/stock/adjust', { part_id: 'prt-k7m2qx9d', slot_id: 'slt-4hq8wz2k', delta: 2 }).status,
    ).toBe(200);
    expect(loc('CU-34-90', 'B1-G-4').on_hand_qty).toBe(64);
  });
  it('a failed write changes nothing (no partial updates, no event)', () => {
    const seq = loadMockState().seq;
    const events = loadMockState().events.length;
    const a1 = layout().shelves.find((s) => s.name === 'A1')!;
    expect(call('DELETE', `/api/shelves/${a1.shelf_id}`, {}).status).toBe(409);
    expect(
      post('/api/locations/move', {
        part_id: 'prt-k7m2qx9d',
        from_slot_id: 'slt-4hq8wz2k',
        to_slot_id: slotByCode('B1-G-6').slot_id,
        mode: 'move',
      }).status,
    ).toBe(409);
    expect(loadMockState().seq).toBe(seq);
    expect(loadMockState().events).toHaveLength(events);
    assertConsistent();
  });
  it('stays consistent through a long random sequence of edits', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const modes = ['move', 'add', 'swap', 'share'] as const;
    for (let i = 0; i < 300; i++) {
      const L = layout();
      const slots = L.shelves.flatMap((s) => s.slots);
      const parts = get<{ items: Part[] }>('/api/parts?limit=100').body.items;
      const p = pick(parts);
      const r = rnd();
      if (r < 0.35 && p.locations.length) {
        post('/api/locations/move', {
          part_id: p.part_id,
          from_slot_id: pick(p.locations).slot_id,
          to_slot_id: pick(slots).slot_id,
          mode: pick([...modes]),
        });
      } else if (r < 0.5) {
        post('/api/locations/move', {
          part_id: p.part_id,
          to_slot_id: pick(slots).slot_id,
          mode: pick(['add', 'share']),
        });
      } else if (r < 0.7 && p.locations.length) {
        const l = pick(p.locations);
        post('/api/stock/adjust', {
          part_id: p.part_id,
          slot_id: l.slot_id,
          delta: Math.floor(rnd() * 21) - 10,
        });
      } else if (r < 0.8 && p.locations.length) {
        const l = pick(p.locations);
        post('/api/stock/adjust', {
          part_id: p.part_id,
          slot_id: l.slot_id,
          set: Math.floor(rnd() * 50),
          version: l.version,
        });
      } else if (r < 0.9) {
        const s = pick(slots);
        post(`/api/slots/${s.slot_id}/resize`, {
          width_span: 1 + Math.floor(rnd() * 4),
          height_span: 1 + Math.floor(rnd() * 3),
          anchor: pick(['bottom-left', 'bottom-right', 'top-left', 'top-right']),
          version: s.version,
        });
      } else if (r < 0.95 && p.locations.length) {
        call('DELETE', '/api/locations', { part_id: p.part_id, slot_id: pick(p.locations).slot_id });
      } else {
        const ev = get<{ items: { event_id: string }[] }>('/api/events?limit=3').body.items;
        if (ev.length) post(`/api/events/${pick(ev).event_id}/undo`, {});
      }
      if (i % 20 === 0) assertConsistent();
    }
    assertConsistent();
  });
});
