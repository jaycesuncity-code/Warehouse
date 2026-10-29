/** Public face of the in-browser mock: a transport for the API client plus demo controls. */
import type { HttpMethod } from '../contract';
import { handleMockRequest, type MockResponse } from './router';
import { resetState, loadState as loadMockStateInternal } from './state';

export { getMockRole, setMockRole, getMockMe } from './session';
export { setMockStorage, loadState as loadMockState, freshState } from './state';
export { handleMockRequest } from './router';

let latencyMs = 90;
export const setMockLatency = (ms: number): void => {
  latencyMs = ms;
};

export interface TransportRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface Transport {
  request(
    method: HttpMethod,
    pathAndQuery: string,
    opts?: TransportRequestOptions,
  ): Promise<TransportResponse>;
}

export const mockTransport: Transport = {
  async request(method, pathAndQuery, opts = {}) {
    if(offline){ const {ApiError}=await import('../api');throw new ApiError(0,{error:'network',message:'Demo offline simulation'}); }
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    const res: MockResponse = handleMockRequest(method, pathAndQuery, opts);
    // Round-trip through structuredClone so callers can never mutate the stored state by accident.
    return { status: res.status, body: structuredClone(res.body), headers: res.headers };
  },
};

/** "Reset demo data": back to src/shared/mock/demo-data.ts. */
export function resetDemoData(): void {
  resetState();
}

/** Explicit performance fixture; only called from the mock-only bootstrap. */
export async function seedPerfData(shelfCount = 300, slotCount = 5000): Promise<void> {
  const {freshState, commitState} = await import('./state');
  const state = freshState();
  const template = state.shelves[0];
  const slotTemplate = state.slots[0];
  state.shelves = []; state.slots = []; state.stock = [];
  const count = Math.min(1000, Math.max(1, Math.floor(shelfCount)));
  const perShelf = Math.min(100, Math.max(1, Math.ceil(slotCount / count)));
  for (let i=0; i<count; i++) {
    const shelf_id = `perf-shelf-${i}`;
    state.shelves.push({...structuredClone(template), shelf_id, name:`Perf ${i+1}`, x_in:(i%20)*120, y_in:Math.floor(i/20)*100, cols:perShelf});
    for (let j=0;j<perShelf;j++) state.slots.push({...slotTemplate, shelf_id, slot_id:`perf-slot-${i}-${j}`, slot_no:j+1, row_index:0, col_start:j+1,width_span:1,height_span:1});
  }
  commitState(state);
}

let offline = false;
export const setOffline = (value:boolean) => {offline=value;};
/** Test inspection of the same canonical mock state, not a separate inventory. */
export function getDB() { const state = loadMockStateInternal(); return {...state,locations:state.stock}; }
