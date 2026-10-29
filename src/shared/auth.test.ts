import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/[[path]]';
import { access } from '../../functions/lib/auth';
import type { D1, Env, Stmt } from '../../functions/lib/database';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements Stmt {
  args: unknown[] = [];
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  execute<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.args as SqlValue[])) as T[] };
  }
  async all<T>() {
    return this.execute<T>();
  }
  async first<T>() {
    return this.execute<T>().results[0] ?? null;
  }
}

/** A real SQLite database, with each D1 batch executed as one atomic transaction. */
class TestDatabase implements D1 {
  sqlite = new DatabaseSync(':memory:');
  constructor(migrate = true) {
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    if (migrate) {
      const migrations = new URL('../../migrations/', import.meta.url);
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql'))
        .sort())
        this.sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
  }
  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }
  async batch<T>(statements: Stmt[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => (statement as Statement).execute<T>());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicKey: JsonWebKey;
let otherPublicKey: JsonWebKey;
let db: TestDatabase;
let env: Env;
let teamSequence = 0;
const now = () => Math.floor(Date.now() / 1000);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

beforeAll(async () => {
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  otherKeys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  otherPublicKey = await crypto.subtle.exportKey('jwk', otherKeys.publicKey);
});

beforeEach(() => {
  db = new TestDatabase();
  env = {
    'warehouse-db': db,
    CF_ACCESS_TEAM_DOMAIN: `warehouse-test-${++teamSequence}.cloudflareaccess.com`,
    CF_ACCESS_AUD: 'warehouse-test-audience',
    WAREHOUSE_EDITORS: 'editor@example.com; second-editor@example.com',
    WAREHOUSE_ADMINS: ' ADMIN@example.com ',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ keys: [{ ...publicKey, kid: 'current', use: 'sig', alg: 'RS256' }] })),
  );
});

afterEach(() => {
  db.sqlite.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function token(payload: unknown = {}, header: unknown = {}, privateKey = keys.privateKey) {
  const claims =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? {
          type: 'app',
          sub: 'test-employee',
          iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
          aud: [env.CF_ACCESS_AUD],
          exp: now() + 3600,
          iat: now() - 1,
          email: 'viewer@example.com',
          ...payload,
        }
      : payload;
  const protectedHeader =
    header && typeof header === 'object' && !Array.isArray(header)
      ? { alg: 'RS256', typ: 'JWT', kid: 'current', ...header }
      : header;
  const input = `${b64(protectedHeader)}.${b64(claims)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

async function send(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    raw?: string;
    email?: string;
    jwt?: string | null;
    headers?: Record<string, string>;
    environment?: Env;
  } = {},
) {
  const jwt =
    options.jwt === undefined ? await token({ email: options.email ?? 'viewer@example.com' }) : options.jwt;
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return onRequest({
    env: options.environment ?? env,
    request: new Request(`https://warehouse.example${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body,
    }),
  });
}

describe('Cloudflare Access signed token verification', () => {
  it('fails closed for absent or invalid server configuration', async () => {
    for (const overrides of [
      { CF_ACCESS_AUD: undefined },
      { CF_ACCESS_AUD: ' ' },
      { CF_ACCESS_TEAM_DOMAIN: undefined },
      { CF_ACCESS_TEAM_DOMAIN: 'https://attacker.example' },
      { CF_ACCESS_TEAM_DOMAIN: 'http://team.cloudflareaccess.com' },
      { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com/path' },
    ])
      expect((await send('/api/me', { environment: { ...env, ...overrides } })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores unsigned identity and role headers when the JWT is missing', async () => {
    const response = await send('/api/me', {
      jwt: null,
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com', 'X-Role': 'admin' },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'unauthorized' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps only verified email identity to configured viewer, editor, and admin roles', async () => {
    for (const [email, role] of [
      ['viewer@example.com', 'viewer'],
      ['EDITOR@EXAMPLE.COM', 'editor'],
      ['ADMIN@example.com', 'admin'],
    ]) {
      const response = await send('/api/me', {
        jwt: await token({ email, role: 'admin', name: 'Employee' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ email: email.toLowerCase(), name: 'Employee', role });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged RSA signature and altered signed claims', async () => {
    expect((await send('/api/me', { jwt: await token({}, {}, otherKeys.privateKey) })).status).toBe(401);
    const signed = (await token()).split('.');
    signed[1] = b64({
      ...JSON.parse(Buffer.from(signed[1], 'base64url').toString()),
      email: 'admin@example.com',
    });
    expect((await send('/api/me', { jwt: signed.join('.') })).status).toBe(401);
  });

  it.each([
    ['expired', () => ({ exp: now() - 1 })],
    ['expires now', () => ({ exp: now() })],
    ['no expiry', () => ({ exp: null })],
    ['text expiry', () => ({ exp: String(now() + 3600) })],
    ['different issuer', () => ({ iss: 'https://attacker.cloudflareaccess.com' })],
    ['different audience', () => ({ aud: ['another-app'] })],
    ['malformed audience', () => ({ aud: [env.CF_ACCESS_AUD, 42] })],
    ['future validity', () => ({ nbf: now() + 3600 })],
    ['malformed validity', () => ({ nbf: 'yesterday' })],
    ['future issuance', () => ({ iat: now() + 3600 })],
    ['missing email', () => ({ email: null })],
    ['empty email', () => ({ email: ' ' })],
    ['malformed email', () => ({ email: 'administrator' })],
    ['global session token', () => ({ type: 'org' })],
  ])('rejects %s claims', async (_name, claims) => {
    expect((await send('/api/me', { jwt: await token(claims()) })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a matching single-string audience and hostname or HTTPS team configuration', async () => {
    const jwt = await token({ aud: env.CF_ACCESS_AUD });
    expect(
      (
        await send('/api/me', {
          jwt,
          environment: { ...env, CF_ACCESS_TEAM_DOMAIN: `https://${env.CF_ACCESS_TEAM_DOMAIN}/` },
        })
      ).status,
    ).toBe(200);
  });

  it.each([null, [], 'unexpected'])('rejects a non-object JWT header or payload (%j)', async (value) => {
    expect((await send('/api/me', { jwt: await token({}, value) })).status).toBe(401);
    expect((await send('/api/me', { jwt: await token(value) })).status).toBe(401);
  });

  it('rejects unexpected algorithms, critical extensions, malformed segments, and oversized tokens', async () => {
    for (const header of [
      { alg: 'none' },
      { alg: 'HS256' },
      { crit: ['custom'] },
      { b64: false },
      { typ: 'JOSE' },
    ])
      expect((await send('/api/me', { jwt: await token({}, header) })).status).toBe(401);
    for (const jwt of ['bad', 'a.b.c', '....', 'a'.repeat(20_000)])
      expect((await send('/api/me', { jwt })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses a fixed trusted certificate endpoint with bounded timeout and no redirects', async () => {
    expect(
      (await send('/api/me', { jwt: await token({}, { jku: 'https://attacker.example/key' }) })).status,
    ).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('fails closed if certificates cannot be fetched, parsed, or matched', async () => {
    for (const response of [
      new Response('unavailable', { status: 503 }),
      new Response('{'),
      Response.json({ keys: [] }),
      Response.json({ keys: [{ ...publicKey, kid: 'current', alg: 'HS256' }] }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response);
      const jwt = await token();
      expect(
        await access({
          env,
          request: new Request('https://warehouse.example/api/me', {
            headers: { 'Cf-Access-Jwt-Assertion': jwt },
          }),
        }),
      ).toBeNull();
      env.CF_ACCESS_TEAM_DOMAIN = `warehouse-test-${++teamSequence}.cloudflareaccess.com`;
    }
  });

  it('coalesces simultaneous certificate fetches and caches valid keys', async () => {
    const jwt = await token();
    const responses = await Promise.all(Array.from({ length: 8 }, () => send('/api/me', { jwt })));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await send('/api/me', { jwt })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled certificate fetch and rejects an oversized certificate response', async () => {
    const jwt = await token();
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const response = send('/api/me', { jwt });
    await vi.advanceTimersByTimeAsync(5_001);
    expect((await response).status).toBe(401);
    vi.useRealTimers();
    env.CF_ACCESS_TEAM_DOMAIN = `warehouse-test-${++teamSequence}.cloudflareaccess.com`;
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ keys: [{ ...publicKey, kid: 'current' }], padding: 'x'.repeat(70_000) }),
    );
    expect((await send('/api/me')).status).toBe(401);
  });

  it('does not accept expired cached keys when certificate refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T18:00:00Z'));
    expect((await send('/api/me')).status).toBe(200);
    vi.setSystemTime(Date.now() + 301_000);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    expect((await send('/api/me')).status).toBe(401);
  });

  it('refreshes expired keys and rotated kids without fetching on every unknown-kid request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T18:00:00Z'));
    expect((await send('/api/me')).status).toBe(200);
    const unknown = await token({}, { kid: 'missing' });
    for (let i = 0; i < 3; i++) expect((await send('/api/me', { jwt: unknown })).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        keys: [
          { ...publicKey, kid: 'current' },
          { ...otherPublicKey, kid: 'rotated' },
        ],
      }),
    );
    expect(
      (await send('/api/me', { jwt: await token({}, { kid: 'rotated' }, otherKeys.privateKey) })).status,
    ).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 301_000);
    expect((await send('/api/me')).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('authorized Pages HTTP routes', () => {
  it('requires a working, migrated D1 binding for health', async () => {
    expect((await send('/api/health', { environment: { ...env, 'warehouse-db': undefined } })).status).toBe(
      503,
    );
    const empty = new TestDatabase(false);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await send('/api/health', { environment: { ...env, 'warehouse-db': empty } })).status).toBe(
        503,
      );
    } finally {
      empty.sqlite.close();
      logger.mockRestore();
    }
    const response = await send('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, d1_bound: true });
  });

  it('rejects a superficially present but incomplete schema and invalid revision metadata', async () => {
    db.sqlite.exec('DROP TABLE idempotency_requests; CREATE TABLE idempotency_requests(key TEXT)');
    expect((await send('/api/health')).status).toBe(503);
    db.sqlite.close();
    db = new TestDatabase();
    env['warehouse-db'] = db;
    db.sqlite.exec('UPDATE warehouse_meta SET revision=0');
    expect((await send('/api/health')).status).toBe(503);
  });

  it('blocks every viewer mutation before any database writes', async () => {
    const { ENDPOINTS } = await import('./contract');
    for (const endpoint of Object.values(ENDPOINTS)) {
      if (endpoint.method === 'GET') continue;
      const path = endpoint.path.replace(/:[a-z_]+/g, 'untrusted-id');
      expect((await send(path, { method: endpoint.method, body: {} })).status, path).toBe(403);
    }
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM parts').get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 0 });
  });

  it('permits editors to register, denies building edits, and permits admins to edit geometry', async () => {
    const registration = await send('/api/parts/register', {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'AUTH-01', part_name: 'Test tee' }] },
    });
    expect(registration.status).toBe(200);
    const registered = (await registration.json()) as { results: { part_id: string }[] };
    expect(registered.results[0].part_id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);
    const zone = {
      name: 'Security test room',
      polygon_in: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      open_edges: [],
      wall_height_in: 96,
      notes: 'Unverified',
    };
    expect((await send('/api/zones', { email: 'editor@example.com', body: zone })).status).toBe(403);
    const created = await send('/api/zones', { email: 'admin@example.com', body: zone });
    expect(created.status).toBe(201);
    const { event_id } = (await created.json()) as { event_id: string };
    expect(
      (await send(`/api/events/${event_id}/undo`, { email: 'editor@example.com', body: {} })).status,
    ).toBe(403);
    expect(
      (await send(`/api/events/${event_id}/undo`, { email: 'admin@example.com', body: {} })).status,
    ).toBe(200);
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('returns consistent JSON validation errors for malformed bodies and paths', async () => {
    for (const raw of ['{', 'null', '[]', '42']) {
      const response = await send('/api/parts/register', { email: 'editor@example.com', raw });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'validation' });
    }
    expect((await send('/api/parts/%xx', { email: 'editor@example.com' })).status).toBe(400);
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          raw: '{}',
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          body: {},
          headers: { 'Content-Length': '1000001' },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          body: { value: 'é'.repeat(500_001) },
        })
      ).status,
    ).toBe(413);
  });

  it('rejects cross-origin mutations and supports ordinary same-origin API clients', async () => {
    const body = { rows: [{ part_code: 'ORIGIN-01', part_name: 'Test tee' }] };
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          body,
          headers: { Origin: 'https://attacker.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          body,
          headers: { Origin: 'https://warehouse.example' },
        })
      ).status,
    ).toBe(200);
    expect((await send('/api/parts/register', { email: 'editor@example.com', body })).status).toBe(200);
  });

  it('distinguishes an unknown route from a disallowed HTTP method', async () => {
    expect((await send('/api/no-such-route')).status).toBe(404);
    const response = await send('/api/layout', { method: 'DELETE', email: 'admin@example.com', body: {} });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('GET');
  });

  it('authenticates conditional reads and keeps viewer audit snapshots private', async () => {
    await send('/api/parts/register', {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'AUDIT-01', part_name: 'Test tee' }] },
    });
    const response = await send('/api/layout');
    const etag = response.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const same = await send('/api/layout', { headers: { 'If-None-Match': etag } });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe('');
    expect(same.headers.get('cache-control')).toContain('no-store');
    expect((await send('/api/layout', { jwt: null, headers: { 'If-None-Match': etag } })).status).toBe(401);
    const viewer = (await (await send('/api/events')).json()) as {
      items: { before: unknown; after: unknown }[];
    };
    expect(viewer.items[0]).toMatchObject({ before: {}, after: {} });
    const editor = (await (await send('/api/events', { email: 'editor@example.com' })).json()) as {
      items: { after: object }[];
    };
    expect(Object.keys(editor.items[0].after)).not.toHaveLength(0);
  });
});

describe('HTTP mutation retry receipts', () => {
  it('replays the original registered IDs and response without another audit event', async () => {
    const options = {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'RETRY-01', part_name: 'Retry tee' }] },
      headers: { 'Idempotency-Key': 'registration-test-01' },
    };
    const first = await send('/api/parts/register', options);
    expect(first.status).toBe(200);
    const original = await first.json();
    const second = await send('/api/parts/register', options);
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await second.json()).toEqual(original);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM parts').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM stock').get()).toEqual({ n: 0 });
  });

  it('rejects changed requests under the same key and scopes receipts to the verified actor', async () => {
    const headers = { 'Idempotency-Key': 'registration-test-02' };
    expect(
      (
        await send('/api/parts/register', {
          email: 'editor@example.com',
          body: { rows: [{ part_code: 'FIRST', part_name: 'First part' }] },
          headers,
        })
      ).status,
    ).toBe(200);
    const changed = { rows: [{ part_code: 'SECOND', part_name: 'Second part' }] };
    const conflict = await send('/api/parts/register', {
      email: 'editor@example.com',
      body: changed,
      headers,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'idempotency_conflict' });
    expect(
      (await send('/api/parts/register', { email: 'second-editor@example.com', body: changed, headers }))
        .status,
    ).toBe(200);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM parts').get()).toEqual({ n: 2 });
    expect(
      (await send('/api/parts/register', { email: 'viewer@example.com', body: changed, headers })).status,
    ).toBe(403);
  });

  it('coalesces concurrent identical mutations into one committed response', async () => {
    const options = {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'PARALLEL', part_name: 'Concurrent tee' }] },
      headers: { 'Idempotency-Key': 'registration-parallel' },
    };
    const responses = await Promise.all([
      send('/api/parts/register', options),
      send('/api/parts/register', options),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM idempotency_requests').get()).toEqual({ n: 1 });
  });

  it('does not double an uncertain retry and serializes concurrent independent inventory deltas', async () => {
    const zoneResponse = await send('/api/zones', {
      email: 'admin@example.com',
      body: {
        name: 'Isolated inventory test',
        polygon_in: [
          [10000, 10000],
          [10200, 10000],
          [10200, 10200],
          [10000, 10200],
        ],
        open_edges: [],
        wall_height_in: 96,
        notes: 'Test geometry, unverified',
      },
    });
    expect(zoneResponse.status).toBe(201);
    const { zone } = (await zoneResponse.json()) as { zone: { zone_id: string } };
    const shelfResponse = await send('/api/shelves', {
      email: 'editor@example.com',
      body: {
        name: 'RETRY-SHELF',
        zone_id: zone.zone_id,
        kind: 'shelving',
        x_in: 10020,
        y_in: 10020,
        rotation_deg: 0,
        width_in: 48,
        depth_in: 24,
        height_in: 72,
        cols: 2,
        rows: [{ row_index: 0, row_label: 'G', elevation_in: 4, clear_height_in: 60 }],
      },
    });
    expect(shelfResponse.status).toBe(201);
    const { shelf } = (await shelfResponse.json()) as { shelf: { shelf_id: string } };
    const slotResponse = await send('/api/slots', {
      email: 'editor@example.com',
      body: { shelf_id: shelf.shelf_id, row_index: 0, col_start: 1, width_span: 1, height_span: 1 },
    });
    expect(slotResponse.status).toBe(201);
    const { slot } = (await slotResponse.json()) as { slot: { slot_id: string } };
    const registration = await send('/api/parts/register', {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'STOCK-RETRY', part_name: 'Stock retry tee' }] },
    });
    const registered = (await registration.json()) as { results: { part_id: string }[] };
    const part_id = registered.results[0].part_id;
    expect(
      (
        await send('/api/locations/move', {
          email: 'editor@example.com',
          body: { part_id, slot_id: slot.slot_id, to_slot_id: slot.slot_id, mode: 'add' },
        })
      ).status,
    ).toBe(200);
    const options = {
      email: 'editor@example.com',
      body: { part_id, slot_id: slot.slot_id, delta: 5, reason: 'Test receiving' },
      headers: { 'Idempotency-Key': 'stock-retry-test-01' },
    };
    const first = await send('/api/stock/adjust', options);
    expect(first.status).toBe(200);
    const second = await send('/api/stock/adjust', options);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(db.sqlite.prepare('SELECT on_hand_qty FROM stock WHERE part_id=?').get(part_id)).toEqual({
      on_hand_qty: 5,
    });
    const concurrent = await Promise.all(
      [2, 3].map((delta) =>
        send('/api/stock/adjust', {
          email: 'editor@example.com',
          body: { part_id, slot_id: slot.slot_id, delta, reason: 'Concurrent receiving' },
          headers: { 'Idempotency-Key': `concurrent-stock-delta-${delta}` },
        }),
      ),
    );
    expect(concurrent.map((reply) => reply.status)).toEqual([200, 200]);
    expect(db.sqlite.prepare('SELECT on_hand_qty FROM stock WHERE part_id=?').get(part_id)).toEqual({
      on_hand_qty: 10,
    });
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM idempotency_requests').get()).toEqual({ n: 3 });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects malformed retry keys before any mutation', async () => {
    const response = await send('/api/parts/register', {
      email: 'editor@example.com',
      body: { rows: [{ part_code: 'BAD-KEY', part_name: 'Bad retry' }] },
      headers: { 'Idempotency-Key': 'short' },
    });
    expect(response.status).toBe(400);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM parts').get()).toEqual({ n: 0 });
  });
});
