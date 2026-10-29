/**
 * The mock "server": maps method + path to an endpoint function, enforces roles, runs writes in a
 * transaction (all-or-nothing, like db.batch()), and answers with the contract's status codes and bodies.
 *
 * Adding an endpoint (workstream C): write one function in endpoints/, add it to ROUTES with its
 * ENDPOINTS name (add the name to contract.ts ENDPOINTS first).
 */
import { ENDPOINTS, type EndpointName, type HttpMethod, type Role } from '../contract';
import { adjustStock } from './endpoints/stock';
import {
  createOpening,
  createZone,
  listOpenings,
  listZones,
  patchOpening,
  patchZone,
} from './endpoints/building';
import { listEvents, undoEvent } from './endpoints/events';
import { patchLocation, deleteLocation, moveLocation } from './endpoints/locations';
import { exportCsv, getLayout, getMe } from './endpoints/misc';
import { createPart, getPart, patchPart, registerParts, searchParts } from './endpoints/parts';
import {
  createShelf,
  deleteShelf,
  duplicateShelf,
  getShelf,
  listShelves,
  patchShelf,
} from './endpoints/shelves';
import { createSlot, deleteSlot, patchSlot, resizeSlot } from './endpoints/slots';
import { HttpError } from './errors';
import { requireRole } from './rules';
import { getMockMe, getMockRole } from './session';
import { commitState, loadState } from './state';
import { Tx } from './tx';
import { ok, type Handler, type Reply } from './types';

interface Route {
  name: EndpointName;
  write: boolean;
  handler: Handler;
}

export const ROUTES: Route[] = [
  { name: 'me', write: false, handler: getMe },
  { name: 'layout', write: false, handler: getLayout },
  { name: 'registerParts', write: true, handler: registerParts },
  { name: 'getPart', write: false, handler: getPart },
  { name: 'searchParts', write: false, handler: searchParts },
  { name: 'createPart', write: true, handler: createPart },
  { name: 'patchPart', write: true, handler: patchPart },
  { name: 'adjustStock', write: true, handler: adjustStock },
  { name: 'moveLocation', write: true, handler: moveLocation },
  { name: 'patchLocation', write:true, handler:patchLocation },
  { name: 'deleteLocation', write: true, handler: deleteLocation },
  { name: 'listShelves', write: false, handler: listShelves },
  { name: 'getShelf', write: false, handler: getShelf },
  { name: 'createShelf', write: true, handler: createShelf },
  { name: 'patchShelf', write: true, handler: patchShelf },
  { name: 'deleteShelf', write: true, handler: deleteShelf },
  { name: 'duplicateShelf', write: true, handler: duplicateShelf },
  { name: 'createSlot', write: true, handler: createSlot },
  { name: 'patchSlot', write: true, handler: patchSlot },
  { name: 'resizeSlot', write: true, handler: resizeSlot },
  { name: 'deleteSlot', write: true, handler: deleteSlot },
  { name: 'listZones', write: false, handler: listZones },
  { name: 'createZone', write: true, handler: createZone },
  { name: 'patchZone', write: true, handler: patchZone },
  { name: 'listOpenings', write: false, handler: listOpenings },
  { name: 'createOpening', write: true, handler: createOpening },
  { name: 'patchOpening', write: true, handler: patchOpening },
  { name: 'events', write: false, handler: listEvents },
  { name: 'undoEvent', write: true, handler: undoEvent },
  { name: 'exportCsv', write: false, handler: exportCsv },
];

const compiled = ROUTES.map((r) => {
  const spec = ENDPOINTS[r.name];
  const keys: string[] = [];
  const pattern = spec.path.replace(/:([a-z_]+)/g, (_m, k: string) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { ...r, spec, keys, re: new RegExp(`^${pattern.replace(/\./g, '\\.')}$`) };
});

export interface MockRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Tests can pin the role; otherwise the demo session role is used. */
  role?: Role;
}

export interface MockResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const errorReply = (status: number, error: string, message: string): MockResponse => ({
  status,
  body: { error, message },
  headers: {},
});

/** Synchronous core: used by unit tests directly and wrapped (with latency) by the transport. */
export function handleMockRequest(
  method: HttpMethod,
  pathAndQuery: string,
  opts: MockRequestOptions = {},
): MockResponse {
  const url = new URL(pathAndQuery, 'http://mock.local');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const route = compiled.find((r) => r.spec.method === method && r.re.test(path));
  if (!route) return errorReply(404, 'not_found', `No such endpoint: ${method} ${path}`);

  const role = opts.role ?? getMockRole();
  const params: Record<string, string> = {};
  const m = path.match(route.re)!;
  route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  const body = opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body));
  const me = getMockMe(role);
  const ctx = { role, email: me.email, name: me.name };

  try {
    requireRole(role, route.spec.role);

    const ifNone = opts.headers?.['If-None-Match'] ?? opts.headers?.['if-none-match'];
    let reply: Reply;
    if (route.write) {
      const tx = new Tx(loadState(), ctx);
      reply = route.handler({
        method,
        params,
        query: url.searchParams,
        body,
        state: tx.state,
        tx,
        ctx,
        role,
      });
      commitState(tx.state);
    } else {
      const state = loadState();
      reply = route.handler({
        method,
        params,
        query: url.searchParams,
        body,
        state,
        tx: null as unknown as Tx,
        ctx,
        role,
      });
    }
    if (ifNone && reply.headers?.ETag === ifNone)
      return { status: 304, body: null, headers: { ETag: ifNone } };
    return { status: reply.status, body: reply.body, headers: reply.headers ?? {} };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: e.body, headers: {} };
    console.error('[mock api]', e);
    return errorReply(500, 'server_error', e instanceof Error ? e.message : 'Unexpected mock error');
  }
}

export { ok };
