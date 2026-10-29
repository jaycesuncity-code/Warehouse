import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody, HttpMethod, RegisterPartsResponse } from './contract';
import { handleMockRequest, loadMockState, resetDemoData } from './mock';
import { commitState } from './mock/state';

beforeEach(resetDemoData);
const call = (method: HttpMethod, path: string, body: unknown) =>
  handleMockRequest(method, `/api${path}`, { body, role: 'admin' });

function rejected(method: HttpMethod, path: string, body: unknown, field: string) {
  const before = structuredClone(loadMockState());
  const reply = call(method, path, body);
  expect(reply.status).toBe(400);
  expect((reply.body as ApiErrorBody).fields).toHaveProperty(field);
  expect(loadMockState()).toEqual(before);
}

describe('malformed domain inputs fail before any mutation', () => {
  it('requires actual boolean measurement verification flags on creation and edit', () => {
    const state = loadMockState();
    const zone = state.zones[0];
    const opening = state.openings[0];
    for (const value of ['false', 1, null, []]) {
      rejected('POST', '/zones', { ...zone, name: 'Input test zone', verified: value }, 'verified');
      rejected('PATCH', `/zones/${zone.zone_id}`, { version: zone.version, verified: value }, 'verified');
      rejected('POST', '/openings', { ...opening, verified: value }, 'verified');
      rejected(
        'PATCH',
        `/openings/${opening.opening_id}`,
        { version: opening.version, verified: value },
        'verified',
      );
    }
  });

  it('does not coerce a string force flag into destructive shelf deletion', () => {
    const shelf = loadMockState().shelves[0];
    rejected('DELETE', `/shelves/${shelf.shelf_id}`, { force: 'false' }, 'force');
  });

  it('returns field errors for null shelf rows and invalid text values', () => {
    const { shelves, zones, openings, slots } = loadMockState();
    const shelf = shelves[0];
    rejected('PATCH', `/shelves/${shelf.shelf_id}`, { version: shelf.version, rows: [null] }, 'rows');
    rejected(
      'PATCH',
      `/shelves/${shelf.shelf_id}`,
      { version: shelf.version, location_type: ['primary'] },
      'location_type',
    );
    const fields: [string, number, string][] = [
      [`/shelves/${shelf.shelf_id}`, shelf.version, 'wall_ref'],
      [`/shelves/${shelf.shelf_id}`, shelf.version, 'notes'],
      [`/zones/${zones[0].zone_id}`, zones[0].version, 'room_no'],
      [`/zones/${zones[0].zone_id}`, zones[0].version, 'notes'],
      [`/openings/${openings[0].opening_id}`, openings[0].version, 'tag'],
      [`/openings/${openings[0].opening_id}`, openings[0].version, 'notes'],
      [`/slots/${slots[0].slot_id}`, slots[0].version, 'bin_color'],
    ];
    for (const [path, version, field] of fields)
      rejected('PATCH', path, { version, [field]: { unexpected: true } }, field);
  });

  it('rejects nonexistent opening zones and unsupported resize anchors', () => {
    const { openings, slots } = loadMockState();
    const opening = openings[0];
    rejected('POST', '/openings', { ...opening, zone_id: 'missing-zone' }, 'zone_id');
    rejected(
      'PATCH',
      `/openings/${opening.opening_id}`,
      { version: opening.version, zone_id: 'missing-zone' },
      'zone_id',
    );
    const slot = slots[0];
    rejected(
      'POST',
      `/slots/${slot.slot_id}/resize`,
      {
        version: slot.version,
        width_span: slot.width_span,
        height_span: slot.height_span,
        anchor: 'unknown',
      },
      'anchor',
    );
  });

  it('preserves a retired part identity and refuses to reuse its code', () => {
    const state = structuredClone(loadMockState());
    const part = state.parts[0];
    part.active = false;
    state.stock = state.stock.filter((row) => row.part_id !== part.part_id);
    commitState(state);
    rejected('POST', '/parts', { part_code: part.part_code, part_name: 'Replacement' }, 'part_code');
  });

  it('validates extra catalog fields and retains partial registration successes', () => {
    for (const field of ['category', 'description', 'department', 'unit'])
      rejected('POST', '/parts', { part_code: 'INPUT-NEW', part_name: 'New part', [field]: {} }, field);
    rejected('POST', '/parts', { part_code: 'INPUT-NEW', part_name: 'New part', unit: false }, 'unit');
    const response = call('POST', '/parts/register', {
      rows: [
        { part_code: 'PARTIAL-VALID-A', part_name: 'Valid first' },
        { part_code: 'PARTIAL-INVALID', part_name: 'Invalid alias', aliases: [{}] },
        { part_code: 'PARTIAL-VALID-B', part_name: 'Valid second' },
      ],
    });
    expect(response.status).toBe(200);
    const body = response.body as RegisterPartsResponse;
    expect(body.results.map((row) => row.status)).toEqual(['new', 'conflict', 'new']);
    expect(body.results[1]).toMatchObject({ part_id: null, message: expect.stringContaining('aliases') });
    expect(loadMockState().parts.some((part) => part.part_code === 'PARTIAL-INVALID')).toBe(false);
    for (const index of [0, 2])
      expect(
        loadMockState().parts.find((part) => part.part_id === body.results[index].part_id)?.part_code,
      ).toBe(index === 0 ? 'PARTIAL-VALID-A' : 'PARTIAL-VALID-B');
    expect(response.body).toMatchObject({ event_id: expect.any(String) });
  });
});
