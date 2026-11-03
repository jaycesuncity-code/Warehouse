import { access, accessConfiguration } from '../lib/auth';
import { equipmentRoute, permissions } from '../lib/equipment';
import {
  load,
  persist,
  publicEvents,
  readIdempotency,
  searchPartsFromDatabase,
  SnapshotConflict,
  type Ctx,
  type D1,
  type IdempotencyRecord,
} from '../lib/database';
import { BodyTooLargeError, readBoundedText } from '../lib/http';
import { ROUTES } from '../../src/shared/mock/router';
import { ENDPOINTS, roleAtLeast, type HttpMethod, type ApiEvent } from '../../src/shared/contract';
import { Tx } from '../../src/shared/mock/tx';
import { HttpError } from '../../src/shared/mock/errors';
import type { Reply } from '../../src/shared/mock/types';

const DEFAULT_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { ...headers, ...DEFAULT_HEADERS } });
const error = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  response({ error: code, message }, status, headers);

const routes = ROUTES.map((route) => {
  const spec = ENDPOINTS[route.name];
  const names: string[] = [];
  const pattern = spec.path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...route, spec, names, expression: new RegExp(`^${pattern}/?$`) };
});

// Compile zero-row reads so an older or partially migrated table cannot pass health just by name.
const REQUIRED_COLUMNS: Record<string, string> = {
  parts:
    'part_id part_code part_name active version created_at updated_at category description department unit cost sale_price reorder_point width_in height_in depth_in weight_lb aliases',
  warehouse_meta: 'id revision updated_at',
  zones: 'zone_id name room_no polygon_in open_edges wall_height_in notes verified version active area_kind',
  openings: 'opening_id kind tag x1_in y1_in x2_in y2_in height_in zone_id notes verified version active',
  shelves:
    'shelf_id name zone_id kind x_in y_in rotation_deg width_in depth_in height_in cols wall_ref notes version active location_type',
  shelf_rows: 'shelf_id row_index row_label elevation_in clear_height_in',
  slots:
    'slot_id shelf_id slot_no row_index col_start width_span height_span bin_type bin_width_in bin_height_in bin_depth_in bin_color version active',
  stock: 'part_id slot_id par_qty on_hand_qty counted_at counted_by version active',
  events: 'event_id at by action entity entity_id before after reason undone_by',
  employees: 'employee_id name email active version',
  packouts: 'kit_id name slot_id status employee_id issued_at issued_contents version active',
  idempotency_requests: 'actor key request_hash response_status response_body response_headers created_at',
};

async function healthy(db: D1): Promise<boolean> {
  const result = await db.batch([
    ...Object.entries(REQUIRED_COLUMNS).map(([table, columns]) =>
      db.prepare(
        `SELECT ${columns
          .split(' ')
          .map((column) => `${table}.${column}`)
          .join(',')} FROM ${table} LIMIT 0`,
      ),
    ),
    db.prepare('SELECT revision FROM warehouse_meta WHERE id=1'),
  ]);
  const revision = result.at(-1)?.results[0]?.revision;
  return Number.isSafeInteger(revision) && Number(revision) > 0;
}

async function requestHash(method: string, url: URL, raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${method}\n${url.pathname}${url.search}\n${raw}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function replyResponse(reply: Reply, extraHeaders: Record<string, string> = {}): Response {
  if (reply.headers?.['Content-Type']?.includes('text/csv'))
    return new Response(String(reply.body), {
      status: reply.status,
      headers: { ...reply.headers, ...extraHeaders, ...DEFAULT_HEADERS },
    });
  return response(reply.body, reply.status, { ...reply.headers, ...extraHeaders });
}

class DatabaseUnavailable extends Error {
  constructor(cause: unknown) {
    super('Warehouse database operation failed', { cause });
  }
}

function revisionConflict(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes('warehouse_meta.revision') ||
    message.includes('UNIQUE constraint failed: idempotency_requests.')
  );
}

export async function onRequest({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  if (!accessConfiguration(env))
    return error(
      503,
      'not_configured',
      'Configure a valid Cloudflare Access team domain and application audience.',
    );
  const me = await access({ request, env });
  if (!me) return error(401, 'unauthorized', 'Verified Cloudflare Access JWT required.');

  const db = env['warehouse-db'];
  if (!db) return error(503, 'database_unavailable', 'The warehouse-db D1 binding is missing.');
  if (url.pathname === '/api/me' && request.method === 'GET') {
    try { return response({ ...me, permissions: await permissions(db, me) }); }
    catch { return response({ ...me, permissions: me.role === 'admin' ? ['admin'] : [] }); }
  }
  if (url.pathname.startsWith('/api/equipment') || url.pathname.startsWith('/api/customers') || url.pathname.startsWith('/api/staff')) {
    let rights: string[];
    try { rights = await permissions(db, me); }
    catch { return error(503, 'database_unavailable', 'Equipment permissions have not been migrated.'); }
    return (await equipmentRoute(request, db, me, rights)) ?? error(404, 'not_found', 'Unknown equipment endpoint.');
  }
  if (url.pathname.replace(/\/$/, '') === '/api/health' && request.method === 'GET') {
    try {
      if (!(await healthy(db))) throw new Error('Required warehouse schema is missing');
      return response({ ok: true, d1_bound: true, schema_ready: true });
    } catch {
      return error(
        503,
        'database_unavailable',
        'Warehouse database unavailable or required migrations missing.',
      );
    }
  }

  const candidates = routes.filter((route) => route.expression.test(url.pathname));
  const route = candidates.find((candidate) => candidate.spec.method === request.method);
  if (!route)
    return candidates.length
      ? error(405, 'method_not_allowed', 'This HTTP method is not supported for this route.', {
          Allow: [...new Set(candidates.map((candidate) => candidate.spec.method))].join(', '),
        })
      : error(404, 'not_found', 'Unknown API route.');
  if (!roleAtLeast(me.role, route.spec.role))
    return error(403, 'forbidden', 'Your role cannot perform this operation.');
  if (route.write && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)
    return error(403, 'forbidden', 'Warehouse changes must be submitted from this application.');

  const params: Record<string, string> = {};
  let body: unknown;
  let idempotency: Pick<IdempotencyRecord, 'key' | 'actor' | 'request_hash'> | undefined;
  try {
    const matched = route.expression.exec(url.pathname)!;
    route.names.forEach((name, index) => {
      params[name] = decodeURIComponent(matched[index + 1]);
    });
    if (route.write) {
      const raw = await readBoundedText(request, 1_000_000);
      if (raw && !/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') ?? ''))
        return error(415, 'validation', 'Submit a JSON request body with Content-Type: application/json.');
      body = raw ? JSON.parse(raw) : {};
      if (body === null || typeof body !== 'object' || Array.isArray(body))
        return error(400, 'validation', 'Expected a JSON object.');
      const key = request.headers.get('Idempotency-Key');
      if (key !== null) {
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key))
          return error(
            400,
            'validation',
            'Idempotency-Key must be 8–200 letters, digits, dots, colons, underscores, or hyphens.',
          );
        idempotency = { key, actor: me.email, request_hash: await requestHash(request.method, url, raw) };
      }
    }
  } catch (failure) {
    return failure instanceof BodyTooLargeError
      ? error(413, 'validation', 'Request exceeds the one-megabyte limit.')
      : error(400, 'validation', 'Invalid request body or path encoding.');
  }

  try {
    // Reload the receipt and state after each CAS conflict; an uncertain retry may already be saved.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (idempotency) {
        let saved: IdempotencyRecord | null;
        try {
          saved = await readIdempotency(db, idempotency.key, idempotency.actor);
        } catch (failure) {
          throw new DatabaseUnavailable(failure);
        }
        if (saved) {
          if (saved.request_hash !== idempotency.request_hash)
            return error(
              409,
              'idempotency_conflict',
              'This retry key was already used for a different request.',
            );
          return replyResponse(
            { status: saved.response_status, body: saved.response_body, headers: saved.response_headers },
            { 'Idempotency-Replayed': 'true' },
          );
        }
      }

      if (route.name === 'searchParts') {
        try {
          return response(await searchPartsFromDatabase(db, url.searchParams, me.role));
        } catch (failure) {
          if (failure instanceof SnapshotConflict) continue;
          throw new DatabaseUnavailable(failure);
        }
      }
      let state;
      try {
        state = await load(db, { endpoint: route.name, params, query: url.searchParams, body });
      } catch (failure) {
        if (failure instanceof SnapshotConflict) continue;
        throw new DatabaseUnavailable(failure);
      }
      const tx = new Tx(state, me);
      const reply = route.handler({
        method: request.method as HttpMethod,
        params,
        query: url.searchParams,
        body,
        state: tx.state,
        tx,
        ctx: me,
        role: me.role,
      });
      if (route.write) {
        const receipt = idempotency
          ? {
              ...idempotency,
              response_status: reply.status,
              response_body: reply.body,
              response_headers: reply.headers,
            }
          : undefined;
        try {
          await persist(db, state, tx.state, receipt);
        } catch (failure) {
          if (revisionConflict(failure)) continue;
          throw new DatabaseUnavailable(failure);
        }
      }
      if (route.name === 'events')
        reply.body = {
          items: publicEvents((reply.body as { items: ApiEvent[] }).items, me.role === 'viewer'),
        };
      if (
        request.method === 'GET' &&
        reply.headers?.ETag &&
        reply.headers.ETag === request.headers.get('If-None-Match')
      )
        return new Response(null, { status: 304, headers: { ...reply.headers, ...DEFAULT_HEADERS } });
      return replyResponse(reply);
    }
    return error(409, 'version_conflict', 'The warehouse changed during this operation. Reload and retry.');
  } catch (failure) {
    if (failure instanceof HttpError) return response(failure.body, failure.status);
    const requestId = crypto.randomUUID();
    console.error('Warehouse API request failed', {
      request_id: requestId,
      method: request.method,
      route: route.name,
      category: failure instanceof DatabaseUnavailable ? 'database' : 'internal',
    });
    return failure instanceof DatabaseUnavailable
      ? error(503, 'database_unavailable', 'Warehouse database unavailable or required migrations missing.', {
          'X-Request-Id': requestId,
        })
      : error(500, 'server_error', 'Warehouse could not complete this request.', {
          'X-Request-Id': requestId,
        });
  }
}
