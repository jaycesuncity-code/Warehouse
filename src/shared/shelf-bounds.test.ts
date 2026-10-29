import { beforeEach, describe, expect, it } from 'vitest';
import { handleMockRequest, loadMockState, resetDemoData } from './mock';
import type { ApiErrorBody, ShelfMutationResponse, SlotMutationResponse } from './contract';

const call = (method: 'POST' | 'PATCH', path: string, body: object) =>
  handleMockRequest(method, `/api${path}`, { body, role: 'editor' });
beforeEach(resetDemoData);

function fixture() {
  const zone_id = loadMockState().zones[0].zone_id;
  const rows = [
    { row_index: 0, row_label: 'G', elevation_in: 4, clear_height_in: 24 },
    { row_index: 1, row_label: '1', elevation_in: 30, clear_height_in: 24 },
  ];
  const created = call('POST', '/shelves', {
    name: 'Bounds', zone_id, kind: 'shelving', x_in: 100, y_in: 100, rotation_deg: 0,
    width_in: 72, depth_in: 24, height_in: 60, cols: 6, rows,
  }).body as ShelfMutationResponse;
  const shelf_id = created.shelf.shelf_id;
  const add = (row_index: number, col_start: number) => (call('POST', '/slots', {
    shelf_id, row_index, col_start, width_span: 2, height_span: 1,
  }).body as SlotMutationResponse).slot;
  return { shelf_id, rows, left: add(0, 1), right: add(0, 5), upper: add(1, 3) };
}

describe('shelf bounds conflicts', () => {
  it('identifies every overflowing column slot and commits no partial geometry change', () => {
    const { shelf_id, right } = fixture();
    const before = structuredClone(loadMockState());
    const response = call('PATCH', `/shelves/${shelf_id}`, { cols: 4, version: 1 });
    expect(response.status).toBe(409);
    expect((response.body as ApiErrorBody).slots).toEqual([
      { slot_id: right.slot_id, location_code: right.location_code, reason: 'Extends past column 4.' },
    ]);
    expect(loadMockState()).toEqual(before);
  });
  it('identifies bins stranded by row removal, retaining their stock and geometry', () => {
    const { shelf_id, upper, rows } = fixture();
    const before = structuredClone(loadMockState());
    const response = call('PATCH', `/shelves/${shelf_id}`, { rows: rows.slice(0, 1), version: 1 });
    expect(response.status).toBe(409);
    expect((response.body as ApiErrorBody).slots).toEqual([
      { slot_id: upper.slot_id, location_code: upper.location_code, reason: 'Extends above the 1 remaining row(s).' },
    ]);
    expect(loadMockState()).toEqual(before);
  });
});
