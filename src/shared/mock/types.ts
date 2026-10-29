import type { HttpMethod, Role } from '../contract';
import type { MockState } from './state';
import type { RequestCtx, Tx } from './tx';

/** What every endpoint function receives. Each endpoint is one small function in endpoints/. */
export interface HandlerCtx {
  method: HttpMethod;
  params: Record<string, string>;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** Writes: the mutable draft (same object as tx.state). Reads: the committed state (do not mutate). */
  state: MockState;
  /** Present for write endpoints only. */
  tx: Tx;
  ctx: RequestCtx;
  role: Role;
}

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const ok = (body: unknown, status = 200, headers?: Record<string, string>): Reply => ({
  status,
  body,
  headers,
});

export type Handler = (c: HandlerCtx) => Reply;
