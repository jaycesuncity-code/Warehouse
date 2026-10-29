/** Public face of the in-browser mock: a transport for the API client plus demo controls. */
import type { HttpMethod } from '../contract';
import { handleMockRequest, type MockResponse } from './router';
import { resetState } from './state';

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
