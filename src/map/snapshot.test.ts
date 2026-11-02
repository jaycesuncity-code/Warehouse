import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from '../shared/contract';
import { loadMockState, resetDemoData, setMockLatency, setMockRole } from '../shared/mock';

vi.mock('../shared/api', async (original) => {
  const module = await original<typeof import('../shared/api')>();
  const { mockTransport } = await import('../shared/mock');
  return { ...module, api: module.createApi(mockTransport) };
});
import { api } from './api';
import { parseSnapshot, replaySnapshot } from './snapshot';

beforeEach(() => {
  resetDemoData();
  setMockRole('admin');
  setMockLatency(0);
});

async function fixture() {
  const current = (await api.getLayout()).layout!;
  const shelf = structuredClone(current.shelves[0]);
  const zone = structuredClone(current.zones.find((item) => item.zone_id === shelf.zone_id)!);
  const opening = structuredClone(current.openings.find((item) => item.zone_id === zone.zone_id)!);
  zone.zone_id = 'zon-22222222';
  zone.name = 'Imported room';
  shelf.shelf_id = 'shf-22222222';
  shelf.name = 'Imported shelf';
  shelf.zone_id = zone.zone_id;
  shelf.slots = shelf.slots.slice(0, 2).map((slot, index) => ({ ...slot, slot_id: `slt-2222222${index + 2}` }));
  opening.opening_id = 'opn-22222222';
  opening.zone_id = zone.zone_id;
  const snapshot: Layout = { ...current, zones: [zone], openings: [opening], shelves: [shelf] };
  return { current, snapshot };
}

describe('snapshot replay through the canonical inventory API', () => {
  it('rejects malformed records and duplicate identities before saving any geometry', async () => {
    const { current, snapshot } = await fixture();
    const before = structuredClone(loadMockState());
    const malformed = { ...snapshot, shelves: [{ ...snapshot.shelves[0], slots: [null] }] };
    expect(() => parseSnapshot(JSON.stringify(malformed))).toThrow('invalid bin record');
    await expect(replaySnapshot(malformed as unknown as Layout, current, api)).rejects.toThrow('invalid bin record');
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, zones: [null] }))).toThrow('invalid zone record');
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, shelves: [{ ...snapshot.shelves[0], slots: null }] }))).toThrow('slots array');
    expect(() => parseSnapshot(JSON.stringify({ ...snapshot, zones: [snapshot.zones[0], snapshot.zones[0]] }))).toThrow('duplicate zone ID');
    expect(() => parseSnapshot(JSON.stringify({ format: 'suncity-layout-snapshot', format_version: 2, layout: snapshot }))).toThrow('not supported');
    expect(parseSnapshot(JSON.stringify({ format: 'suncity-layout-snapshot', format_version: 1, layout: snapshot }))).toEqual(snapshot);
    expect(loadMockState()).toEqual(before);
  });

  it('uses new server-issued parent IDs and preserves stock while rebuilding geometry', async () => {
    const { current, snapshot } = await fixture();
    const stockBefore = structuredClone(loadMockState().stock);
    const result = await replaySnapshot(snapshot, current, api);
    expect(result.failed).toEqual([]);
    const state = loadMockState();
    const zone = state.zones.find((item) => item.name === 'Imported room')!;
    const shelf = state.shelves.find((item) => item.name === 'Imported shelf')!;
    expect(zone.zone_id).not.toBe('zon-22222222');
    expect(shelf.shelf_id).not.toBe('shf-22222222');
    expect(shelf.zone_id).toBe(zone.zone_id);
    expect(state.openings.at(-1)!.zone_id).toBe(zone.zone_id);
    expect(state.slots.filter((slot) => slot.shelf_id === shelf.shelf_id)).toHaveLength(2);
    expect(state.stock).toEqual(stockBefore);
    expect(state.zones.every((item) => !item.verified)).toBe(true);
  });


  it('exports and replays Tools / Packouts areas with their area kind', async () => {
    const current = (await api.getLayout()).layout!;
    const tools = structuredClone(current.zones.find((item) => item.area_kind === 'tools')!);
    expect(tools.open_edges).toEqual([0, 1, 2, 3]);
    const exported = parseSnapshot(JSON.stringify({ format: 'suncity-layout-snapshot', format_version: 1, layout: current }));
    expect(exported.zones.find((item) => item.zone_id === tools.zone_id)!.area_kind).toBe('tools');
    tools.zone_id = 'zon-33333333';
    tools.name = 'Imported tools';
    const result = await replaySnapshot({ ...current, zones: [tools], openings: [], shelves: [] }, current, api);
    expect(result.failed).toEqual([]);
    const saved = loadMockState().zones.find((item) => item.name === 'Imported tools')!;
    expect(saved).toMatchObject({ area_kind: 'tools', open_edges: [0, 1, 2, 3] });
    expect(saved.zone_id).not.toBe('zon-33333333');
  });

  it('can retry a completed snapshot without duplicating rooms, shelves, bins, or stock', async () => {
    const { current, snapshot } = await fixture();
    expect((await replaySnapshot(snapshot, current, api)).failed).toEqual([]);
    const before = structuredClone(loadMockState());
    const refreshed = (await api.getLayout()).layout!;
    expect((await replaySnapshot(snapshot, refreshed, api)).failed).toEqual([]);
    const after = loadMockState();
    expect(after.zones).toHaveLength(before.zones.length);
    expect(after.openings).toHaveLength(before.openings.length);
    expect(after.shelves).toHaveLength(before.shelves.length);
    expect(after.slots).toHaveLength(before.slots.length);
    expect(after.stock).toEqual(before.stock);
  });

  it('reports an invalid bin while still preserving other successful bins', async () => {
    const { current, snapshot } = await fixture();
    snapshot.shelves[0].slots[0].width_span = 1000;
    const result = await replaySnapshot(snapshot, current, api);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatch(/^bin /);
    const state = loadMockState();
    const shelf = state.shelves.find((item) => item.name === 'Imported shelf')!;
    expect(state.slots.filter((slot) => slot.shelf_id === shelf.shelf_id)).toHaveLength(1);
  });

  it('does not create children whose new parent zone failed validation', async () => {
    const { current, snapshot } = await fixture();
    snapshot.zones[0].polygon_in = [[0, 0]];
    const before = structuredClone(loadMockState());
    const result = await replaySnapshot(snapshot, current, api);
    expect(result.failed).toHaveLength(3);
    expect(loadMockState().zones).toEqual(before.zones);
    expect(loadMockState().shelves).toEqual(before.shelves);
    expect(loadMockState().openings).toEqual(before.openings);
  });
});
