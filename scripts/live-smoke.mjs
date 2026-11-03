/**
 * Compiled Pages Functions + real local D1 verification. No account or deployed
 * resources are used. Tokens and signing keys exist only for this process, and
 * the worker's only allowed outbound request is its fixture JWKS endpoint.
 *
 * First run `npm run build` and compile Functions to artifacts/functions/index.js.
 * Then run `node scripts/live-smoke.mjs`, adding `--browser` for the production UI.
 */
/* global document, window */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from 'miniflare';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(root, 'artifacts/functions/index.js');
await access(workerPath).catch(() => {
  throw new Error(
    'Compile Pages Functions first: npx wrangler pages functions build functions --outdir=artifacts/functions',
  );
});
await access(join(root, 'dist/index.html')).catch(() => {
  throw new Error('Build production frontend assets first: npm run build');
});

const temporaryRoot = await mkdtemp(join(tmpdir(), 'warehouse-live-smoke-'));
const origin = 'https://warehouse-smoke.example.test';
const issuer = 'https://warehouse-smoke.cloudflareaccess.com';
const audience = 'warehouse-smoke-local-only';
const emails = {
  admin: 'admin@example.test',
  editor: 'editor@example.test',
  viewer: 'employee@example.test',
  outsider: 'other@example.test',
};
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = {
  ...keyPair.publicKey.export({ format: 'jwk' }),
  kid: 'smoke-key',
  alg: 'RS256',
  use: 'sig',
};
function token(email, overrides = {}, privateKey = keyPair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encoded({ alg: 'RS256', typ: 'JWT', kid: publicKey.kid })}.${encoded({
    iss: issuer,
    aud: [audience],
    iat: now,
    exp: now + 600,
    type: 'app',
    email,
    ...overrides,
  })}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}
const tokens = Object.fromEntries(Object.entries(emails).map(([role, email]) => [role, token(email)]));
let certificateFetches = 0;
const unexpectedOutbound = [];
const outboundService = (request) => {
  if (request.url !== `${issuer}/cdn-cgi/access/certs`) {
    unexpectedOutbound.push(request.url);
    throw new Error('Unexpected outbound request from the local smoke worker');
  }
  certificateFetches++;
  return Response.json({ keys: [publicKey] });
};
const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
async function assets(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const dist = join(root, 'dist');
  const file = resolve(dist, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(`${dist}${sep}`)) return new Response('Not found', { status: 404 });
  try {
    return new Response(await readFile(file), {
      headers: { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
const bindings = {
  CF_ACCESS_TEAM_DOMAIN: new URL(issuer).hostname,
  CF_ACCESS_AUD: audience,
  WAREHOUSE_EDITORS: emails.editor,
  WAREHOUSE_ADMINS: emails.admin,
};
const commonWorker = {
  modules: true,
  scriptPath: workerPath,
  compatibilityDate: '2026-10-01',
  serviceBindings: { ASSETS: assets },
  outboundService,
};
const databaseId = `local-smoke-${randomUUID()}`;
// The installed Miniflare 5 release exposes its documented v4-compatible adapter.
const options = convertV4MiniflareOptions({
  host: '127.0.0.1',
  port: 0,
  cf: false,
  log: new Log(LogLevel.ERROR),
  resourcePersistencePath: join(temporaryRoot, 'persist'),
  telemetry: { enabled: false },
  logRequests: false,
  workers: [
    { ...commonWorker, name: 'warehouse', bindings, d1Databases: { 'warehouse-db': databaseId } },
    { ...commonWorker, name: 'missing-access', bindings: {}, d1Databases: { 'warehouse-db': databaseId } },
    { ...commonWorker, name: 'wrong-binding', bindings, d1Databases: { DB: databaseId } },
  ],
});
let mf;
let db;
let apiRequests = 0;
const completed = [];
const appliedMigrations = [];
async function check(name, action) {
  await action();
  completed.push(name);
  console.log(`PASS ${name}`);
}
async function request(
  method,
  path,
  body,
  { role = 'editor', expected = 200, headers = {}, assertion = tokens[role], worker } = {},
) {
  const requestHeaders = { ...headers };
  if (assertion !== null) requestHeaders['Cf-Access-Jwt-Assertion'] = assertion;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const init = {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  apiRequests++;
  const response = worker
    ? await (await mf.getWorker(worker)).fetch(`${origin}${path}`, init)
    : await mf.dispatchFetch(`${origin}${path}`, init);
  const raw = await response.text();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${raw}; fixture certificate requests=${certificateFetches}; unexpected outbound=${JSON.stringify(unexpectedOutbound)}`,
  );
  const data =
    raw && response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(raw) : raw;
  if (path.startsWith('/api/')) assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return { response, data };
}
const get = async (path, options) => (await request('GET', path, undefined, options)).data;
const post = async (path, body, options) => (await request('POST', path, body, options)).data;
const canonicalId = /^prt-[2-9a-hj-km-np-z]{8}$/;
const scalar = async (sql) => Object.values(await db.prepare(sql).first())[0];
let browserResult = null;

async function browserSmoke({ parts, staging, stagingShelf, employee, kit }) {
  const { chromium, expect: baseExpect } = await import('@playwright/test');
  const expect = baseExpect.configure({ timeout: 20_000 });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath
      ? {
          executablePath,
          args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        }
      : {}),
  });
  const server = await mf.ready;
  const context = await browser.newContext({
    baseURL: server.origin,
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': tokens.editor },
  });
  const directory = join(root, 'artifacts/live-smoke');
  await mkdir(directory, { recursive: true });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === server.origin || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue()
      : route.abort('blockedbyclient');
  });
  // Production must ignore remembered demo settings and URL attempts to change role/mode.
  await context.addInitScript(() => {
    sessionStorage.setItem('sc.mode', 'mock');
    localStorage.setItem('sc.mock.role', 'admin');
  });
  const page = await context.newPage();
  const pageErrors = [];
  const routes = new Set();
  let browserApiRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) browserApiRequests++;
  });
  async function visit(path) {
    await page.goto(path);
    routes.add(new URL(page.url()).pathname);
    await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  }
  try {
    await visit('/?mode=mock&role=admin');
    await expect(page.getByTestId('btn-warehouse')).toBeVisible();
    await expect(page.getByTestId('btn-employee')).toBeVisible();
    await expect(page.getByTestId('role-badge')).toHaveText('Editor');

    const stockBefore = (await db.prepare('SELECT * FROM stock ORDER BY part_id,slot_id').all()).results;
    await visit('/labels/?mode=mock&role=admin');
    await expect(page.locator('#find')).toBeEnabled();
    const frame = page.frameLocator('#generator');
    await frame.getByRole('tab', { name: 'Add one part' }).click();
    await frame.locator('#oneName').fill('Browser-created live fitting');
    await frame.locator('#oneCode').fill('BROWSER-LIVE');
    await frame.locator('#oneQty').fill('99');
    await frame.getByRole('button', { name: 'Add this part' }).click();
    await page.locator('#register').click();
    await expect(page.locator('#status')).toContainText('1 selected part(s) verified in the database');
    const created = await db.prepare("SELECT part_id FROM parts WHERE part_code='BROWSER-LIVE'").first();
    assert.ok(created && canonicalId.test(created.part_id));
    await page.reload();
    await expect(page.locator('#selection')).toContainText(created.part_id);
    const labelDownloads = [];
    const recordDownload = (download) => labelDownloads.push(download.suggestedFilename());
    page.on('download', recordDownload);
    await page.locator('#generate').click();
    await expect(page.locator('#status')).toContainText('PDF ready: 1 verified label');
    if (!(await page.evaluate(() => navigator.pdfViewerEnabled === true))) {
      await expect(frame.locator('#pdfFallback')).toBeVisible();
      await expect(frame.locator('#pdfFrame')).not.toHaveAttribute('src');
    }
    assert.deepEqual(labelDownloads, [], 'Generating a preview must not start an unsolicited download');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'sun-city-bin-labels.pdf');
    const pdfPath = join(directory, 'browser-live-label.pdf');
    await download.saveAs(pdfPath);
    assert.deepEqual(labelDownloads, ['sun-city-bin-labels.pdf']);
    page.off('download', recordDownload);
    const pdf = await readFile(pdfPath);
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
    const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(
      pdf.toString('latin1'),
    );
    assert.ok(mediaBox, 'Downloaded PDF must declare its page bounds');
    assert.deepEqual(mediaBox.slice(1).map(Number), [0, 0, 612, 792]);
    assert.deepEqual(
      (await db.prepare('SELECT * FROM stock ORDER BY part_id,slot_id').all()).results,
      stockBefore,
    );
    assert.equal(await scalar("SELECT count(*) FROM parts WHERE part_code='BROWSER-LIVE'"), 1);

    await visit('/warehouse/?mode=mock&role=admin#/search');
    await expect(page.getByTestId('role-badge')).toHaveText('Editor');
    await page.getByTestId('lookup-input').fill('BROWSER-LIVE');
    await page.getByTestId('part-row').filter({ hasText: 'BROWSER-LIVE' }).click();
    await expect(page.getByTestId('part-name')).toHaveText('Browser-created live fitting');
    await page.reload();
    await expect(page.getByTestId('part-screen')).toHaveAttribute('data-part-id', created.part_id);
    await visit('/warehouse/?mode=mock#/scan');
    await expect(page.getByTestId('scan-screen')).toBeVisible();
    await page.keyboard.type(created.part_id);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('part-code')).toHaveText('BROWSER-LIVE');

    await visit('/warehouse/demo-labels.html?mode=mock');
    await expect(
      page.locator(`[data-testid="demo-label"][data-label-id="${created.part_id}"]`),
    ).toBeVisible();
    await expect(page.getByTestId('role-badge')).toHaveText('Editor');

    const beforeIssue = await Promise.all(parts.map((id) => get(`/api/parts/${id}`)));
    await visit('/packouts/?mode=mock');
    await expect(page.getByRole('heading', { name: 'Packouts & kits', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Local smoke kit/ }).click();
    await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption(employee.employee_id);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Issue kit', exact: true }).click();
    await expect(page.getByText('With Local smoke employee', { exact: true })).toBeVisible();
    assert.equal((await get('/api/packouts')).items[0].status, 'issued');
    await page.screenshot({ path: join(directory, 'packout-desktop.png'), fullPage: true });

    await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': tokens.viewer });
    await page.setViewportSize({ width: 390, height: 844 });
    await visit('/employee/?mode=mock&role=admin');
    await expect(page.getByTestId('role-badge')).toHaveText('Viewer');
    await expect(page.getByRole('region', { name: 'My issued kits' })).toContainText('Local smoke kit');
    await expect(
      page.getByRole('button', { name: /Issue kit|Return & reconcile|Transfer to kit/ }),
    ).toHaveCount(0);
    const denied = await page.request.post('/api/stock/adjust', {
      data: { part_id: parts[0], slot_id: staging, delta: -1 },
    });
    assert.equal(denied.status(), 403);
    assert.equal(await page.evaluate(() => localStorage.getItem('sc.mock.state.v1')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('sc.mode')), 'mock');

    await visit(`/map/?mode=mock&role=admin&shelf=${stagingShelf.shelf_id}&slot=${staging}&part=${parts[0]}`);
    await expect(page.getByTestId('loading')).toHaveCount(0);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await expect(page.getByTestId('map-search')).toBeVisible();
    await expect(page.getByTestId('add-shelf')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__mapDebug?.info().calls ?? 0)).toBeGreaterThan(0);
    assert.equal(await page.evaluate(() => window.__mapDebug.shelves().length), 3);
    await page.getByTestId('result-entry').filter({ hasText: 'LIVE PACKOUT-G-1' }).click();
    await expect(page.getByTestId('part-card-name')).toHaveText('Live fitting A');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
    );
    await page.screenshot({ path: join(directory, 'map-mobile.png'), fullPage: true });

    await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': tokens.editor });
    await visit('/packouts/?mode=mock');
    await page.getByRole('button', { name: /Local smoke kit/ }).click();
    await page.getByLabel('Remaining LIVE-A', { exact: true }).fill('2');
    await page.getByLabel('Remaining LIVE-B', { exact: true }).fill('1');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Return & reconcile', exact: true }).click();
    await expect(page.getByText('Kit returned and consumption recorded.', { exact: true })).toBeVisible();
    for (const [index, id] of parts.entries()) {
      const part = await get(`/api/parts/${id}`);
      assert.equal(part.on_hand_total, beforeIssue[index].on_hand_total - 1);
      assert.equal(part.available_total, part.on_hand_total);
    }
    assert.equal(
      (await get('/api/packouts')).items.find((row) => row.kit_id === kit.kit_id).status,
      'available',
    );
    assert.equal(routes.size, 7);
    assert.ok(browserApiRequests > 15);
    assert.deepEqual(pageErrors, []);
    return {
      part_id: created.part_id,
      routes: [...routes],
      api_requests: browserApiRequests,
      desktop: '1280x800',
      mobile: '390x844',
    };
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

try {
  mf = new Miniflare(options);
  await mf.ready;
  db = await mf.getD1Database('warehouse-db');
  await check('fail-closed configuration, signed identity, and invalid JWT rejection', async () => {
    await get('/api/me', { worker: 'missing-access', expected: 503 });
    await get('/api/health', { worker: 'wrong-binding', expected: 503 });
    await get('/api/parts', { assertion: null, expected: 401 });
    for (const overrides of [{ exp: 1 }, { iss: 'https://wrong.cloudflareaccess.com' }, { aud: ['wrong'] }]) {
      await get('/api/me', { assertion: token(emails.admin, overrides), expected: 401 });
    }
    const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await get('/api/me', { assertion: token(emails.admin, {}, wrongKey), expected: 401 });
    for (const role of ['admin', 'editor', 'viewer']) {
      const identity = await get('/api/me', { role });
      assert.equal(identity.email, emails[role]);
      assert.equal(identity.name, emails[role]);
      assert.equal(identity.role, role);
      assert.ok(Array.isArray(identity.permissions), 'new permissions contract should be present');
    }
    await get('/api/health', { expected: 503 });
  });

  await check(
    'ordered migrations on isolated D1 and unverified geometry without demo inventory',
    async () => {
      const directory = join(root, 'migrations');
      for (const file of (await readdir(directory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort()) {
        const statements = splitSqlQuery(await readFile(join(directory, file), 'utf8'));
        assert.ok(statements.length, `${file} must not be empty`);
        await db.batch(statements.map((statement) => db.prepare(statement)));
        appliedMigrations.push(file);
      }
      assert.deepEqual(await get('/api/health'), { ok: true, d1_bound: true, schema_ready: true });
      const layout = await get('/api/layout');
      assert.equal(layout.zones.length, 9);
      assert.equal(layout.openings.length, 18);
      assert.ok(layout.zones.every((zone) => zone.verified === false));
      assert.ok(layout.openings.every((opening) => opening.verified === false));
      assert.deepEqual(layout.shelves, []);
      assert.equal(await scalar('SELECT count(*) FROM parts'), 0);
      assert.equal(await scalar('SELECT count(*) FROM stock'), 0);
    },
  );

  await check('equipment D1 order, idempotency, receipt and QR label audit', async () => {
    const order = {
      header: { customer_id: 'cus-stk22222', po_number: '004471', requested_by_name: 'Warehouse smoke' },
      lines: [{ equipment_type_id: 'ety-22222222', manufacturer: 'Carrier', model: 'ABC-123', quantity: 10 }],
    };
    const headers = { 'Idempotency-Key': 'equipment-smoke-order-0001' };
    const created = await post('/api/equipment/orders', order, { role: 'admin', headers, expected: 201 });
    assert.equal(created.unit_ids.length, 10);
    assert.equal(new Set(created.unit_ids).size, 10);
    const retried = await post('/api/equipment/orders', order, { role: 'admin', headers, expected: 201 });
    assert.deepEqual(retried.unit_ids, created.unit_ids);
    assert.equal(await scalar('SELECT COUNT(*) FROM equipment'), 10);
    assert.equal(await scalar('SELECT COUNT(*) FROM stock'), 0);
    await post('/api/equipment/orders', order, { role: 'viewer', expected: 403 });
    await post('/api/equipment/orders', order, { role: 'editor', expected: 403 });
    const first = created.unit_ids[0];
    const received = await post(`/api/equipment/${first}/receive`, {
      version: 1, serial_number: 'S-123', confirmed_model: 'NOT-ORDERED',
    }, { role: 'admin' });
    assert.equal(received.unit.status, 'received');
    assert.equal(received.unit.serial_number, 'S-123');
    const mismatches = await get('/api/equipment/reviews', { role: 'admin' });
    assert.ok(mismatches.items.some((x) => x.issue_code === 'MODEL_MISMATCH'));
    const prepared = await post('/api/equipment/labels/prepare', {
      equipment_ids: created.unit_ids.slice(0, 3), skip_first_positions: 2,
    }, { role: 'admin' });
    assert.deepEqual(prepared.labels.map((l) => l.sheet_position), [3, 4, 5]);
    assert.ok(prepared.labels.every((l) => /^eqp-[2-9a-hj-km-np-z]{8}$/.test(l.equipment_id)));
    await post('/api/equipment/labels/confirm', {
      prepared_print_ids: prepared.labels.map((l) => l.label_print_id),
    }, { role: 'admin' });
    assert.equal(await scalar('SELECT COUNT(*) FROM equipment_label_prints WHERE confirmed_printed_at IS NOT NULL'), 3);
    const report = await get('/api/equipment/reports', { role: 'viewer' });
    assert.ok(report.statuses.some((x) => x.status === 'received' && x.total === 1));
    assert.equal(await scalar('SELECT COUNT(*) FROM stock'), 0);
  });

  let parts;
  let source;
  let sourceB;
  let spare;
  let staging;
  let stagingShelf;
  let employee;
  let kit;
  await check(
    'role enforcement, partial registration, canonical IDs, and retry-safe registration',
    async () => {
      await post('/api/parts/register', { rows: [] }, { role: 'viewer', expected: 403 });
      await post('/api/stock/adjust', {}, { role: 'viewer', expected: 403 });
      await post('/api/zones', {}, { role: 'editor', expected: 403 });
      await post('/api/parts', {}, { expected: 403, headers: { Origin: 'https://elsewhere.example.test' } });
      const body = {
        rows: [
          { part_code: 'LIVE-A', part_name: 'Live fitting A', cost: 4.25, aliases: ['first fitting'] },
          { part_code: 'LIVE-B', part_name: 'Live fitting B', cost: 2.5 },
          { part_code: 'INVALID', part_name: '' },
        ],
      };
      const first = await post('/api/parts/register', body, {
        headers: { 'Idempotency-Key': 'smoke-register' },
      });
      assert.deepEqual(
        first.results.map((row) => row.status),
        ['new', 'new', 'conflict'],
      );
      parts = first.results.slice(0, 2).map((row) => row.part_id);
      assert.ok(parts.every((id) => canonicalId.test(id)));
      const replay = await request('POST', '/api/parts/register', body, {
        headers: { 'Idempotency-Key': 'smoke-register' },
      });
      assert.deepEqual(replay.data, first);
      assert.equal(replay.response.headers.get('Idempotency-Replayed'), 'true');
      const confirmed = await post('/api/parts/register', { rows: body.rows.slice(0, 2) });
      assert.deepEqual(
        confirmed.results.map((row) => row.part_id),
        parts,
      );
      assert.deepEqual(
        confirmed.results.map((row) => row.status),
        ['reused', 'reused'],
      );
      assert.equal(await scalar('SELECT count(*) FROM parts'), 2);
      assert.equal(await scalar('SELECT count(*) FROM stock'), 0);
      assert.equal((await get(`/api/parts/${parts[0]}`, { role: 'viewer' })).cost, null);
    },
  );

  await check('database-backed shelves, slots, stock placement, search, par, undo, and redo', async () => {
    const zone = (await get('/api/zones')).items[0];
    await request(
      'PATCH',
      `/api/zones/${zone.zone_id}`,
      { version: zone.version, verified: 'false' },
      { role: 'admin', expected: 400 },
    );
    await request(
      'PATCH',
      `/api/zones/${zone.zone_id}`,
      { version: zone.version, notes: 'Local smoke fixture; unverified reference geometry.' },
      { role: 'admin' },
    );
    async function shelf(name, y, location_type) {
      return (
        await post(
          '/api/shelves',
          {
            name,
            location_type,
            zone_id: zone.zone_id,
            kind: 'shelving',
            x_in: 200,
            y_in: y,
            rotation_deg: 0,
            width_in: 96,
            depth_in: 24,
            height_in: 72,
            cols: 4,
            rows: [{ row_index: 0, row_label: 'G', elevation_in: 4, clear_height_in: 60 }],
          },
          { expected: 201 },
        )
      ).shelf;
    }
    async function slot(shelf_id, col_start = 1) {
      return (
        await post(
          '/api/slots',
          { shelf_id, row_index: 0, col_start, width_span: 1, height_span: 1 },
          { expected: 201 },
        )
      ).slot.slot_id;
    }
    const primary = await shelf('LIVE PRIMARY', 200, 'primary');
    const overstock = await shelf('LIVE OVERSTOCK', 400, 'overstock');
    stagingShelf = await shelf('LIVE PACKOUT', 600, 'packout');
    source = await slot(primary.shelf_id);
    sourceB = await slot(primary.shelf_id, 2);
    spare = await slot(overstock.shelf_id);
    staging = await slot(stagingShelf.shelf_id);
    await post('/api/locations/move', {
      part_id: parts[0],
      to_slot_id: source,
      mode: 'add',
      on_hand_qty: 50,
    });
    await post('/api/locations/move', {
      part_id: parts[1],
      to_slot_id: sourceB,
      mode: 'add',
      on_hand_qty: 20,
    });
    await post('/api/locations/move', {
      part_id: parts[0],
      from_slot_id: source,
      to_slot_id: spare,
      mode: 'move',
    });
    assert.equal((await get(`/api/parts/${parts[0]}`)).on_hand_total, 50);
    await post('/api/locations/move', {
      part_id: parts[0],
      from_slot_id: spare,
      to_slot_id: source,
      mode: 'move',
    });
    const part = await get(`/api/parts/${parts[0]}`);
    const changed = (
      await request('PATCH', '/api/locations', {
        part_id: parts[0],
        slot_id: source,
        par_qty: 12,
        version: part.locations[0].version,
      })
    ).data;
    assert.equal(changed.part.par_total, 12);
    const undo = await post(`/api/events/${changed.event_id}/undo`, {});
    assert.equal((await get(`/api/parts/${parts[0]}`)).par_total, 0);
    await post(`/api/events/${undo.event_id}/undo`, {});
    assert.equal((await get(`/api/parts/${parts[0]}`)).par_total, 12);
    assert.equal((await get('/api/parts?q=first%20fitting')).items[0].part_id, parts[0]);
    const first = await get('/api/parts?q=live&limit=1');
    const second = await get('/api/parts?q=live&limit=1&offset=1');
    assert.equal(first.total, 2);
    assert.equal(first.items.length, 1);
    assert.notEqual(first.items[0].part_id, second.items[0].part_id);
    const layout = await request('GET', '/api/layout');
    assert.deepEqual(layout.data.shelves.map((shelf) => shelf.location_type).sort(), [
      'overstock',
      'packout',
      'primary',
    ]);
    assert.ok(
      layout.data.shelves.some((shelf) => shelf.slots.some((slot) => slot.part_ids.includes(parts[0]))),
    );
    await request('GET', '/api/layout', undefined, {
      expected: 304,
      headers: { 'If-None-Match': layout.response.headers.get('ETag') },
    });
  });

  await check('actual D1 concurrency, idempotency receipts, and atomic failure rollback', async () => {
    const path = '/api/stock/adjust';
    const base = { part_id: parts[0], slot_id: source };
    const before = await get(`/api/parts/${parts[0]}`);
    const duplicate = { ...base, delta: 5, reason: 'Concurrent identical retry' };
    const results = await Promise.all(
      [0, 1].map(() => post(path, duplicate, { headers: { 'Idempotency-Key': 'smoke-duplicate-adjust' } })),
    );
    assert.equal(results[0].event_id, results[1].event_id);
    assert.equal((await get(`/api/parts/${parts[0]}`)).on_hand_total, before.on_hand_total + 5);
    assert.equal(
      await scalar("SELECT count(*) FROM idempotency_requests WHERE key='smoke-duplicate-adjust'"),
      1,
    );
    await post(
      path,
      { ...duplicate, delta: 6 },
      { expected: 409, headers: { 'Idempotency-Key': 'smoke-duplicate-adjust' } },
    );
    await Promise.all(
      [2, 3].map((delta) =>
        post(path, { ...base, delta }, { headers: { 'Idempotency-Key': `smoke-independent-${delta}` } }),
      ),
    );
    assert.equal((await get(`/api/parts/${parts[0]}`)).on_hand_total, before.on_hand_total + 10);

    const current = await get(`/api/parts/${parts[0]}`);
    const version = current.locations.find((location) => location.slot_id === source).version;
    const counted = await Promise.all(
      [31, 32].map(async (set) => {
        const response = await mf.dispatchFetch(`${origin}${path}`, {
          method: 'POST',
          headers: {
            'Cf-Access-Jwt-Assertion': tokens.editor,
            'Content-Type': 'application/json',
            'Idempotency-Key': `smoke-count-${set}`,
          },
          body: JSON.stringify({ ...base, set, version }),
        });
        apiRequests++;
        return { status: response.status, data: await response.json(), set };
      }),
    );
    assert.deepEqual(counted.map((row) => row.status).sort(), [200, 409]);
    assert.equal(
      (await get(`/api/parts/${parts[0]}`)).on_hand_total,
      counted.find((row) => row.status === 200).set,
    );

    const snapshot = async () => ({
      stock: (await db.prepare('SELECT * FROM stock ORDER BY part_id,slot_id').all()).results,
      revision: await scalar('SELECT revision FROM warehouse_meta'),
      events: await scalar('SELECT count(*) FROM events'),
      receipts: await scalar('SELECT count(*) FROM idempotency_requests'),
    });
    const saved = await snapshot();
    await db
      .prepare(
        "CREATE TRIGGER smoke_reject_event BEFORE INSERT ON events WHEN NEW.reason='rollback-fixture' BEGIN SELECT RAISE(ABORT,'isolated smoke rollback'); END",
      )
      .run();
    try {
      await post(
        path,
        { ...base, delta: 7, reason: 'rollback-fixture' },
        { expected: 503, headers: { 'Idempotency-Key': 'smoke-rollback' } },
      );
      assert.deepEqual(await snapshot(), saved);
    } finally {
      await db.prepare('DROP TRIGGER smoke_reject_event').run();
    }
    await post(
      path,
      { ...base, delta: 7, reason: 'rollback-fixture' },
      { headers: { 'Idempotency-Key': 'smoke-rollback' } },
    );
    assert.equal(await scalar("SELECT count(*) FROM idempotency_requests WHERE key='smoke-rollback'"), 1);
  });

  await check(
    'multi-part packout transfer, employee custody, counted return, and undo/redo conservation',
    async () => {
      employee = (
        await post(
          '/api/employees',
          { name: 'Local smoke employee', email: emails.viewer },
          { expected: 201 },
        )
      ).employee;
      kit = (await post('/api/packouts', { name: 'Local smoke kit', slot_id: staging }, { expected: 201 }))
        .kit;
      const initialTotals = await Promise.all(
        parts.map(async (id) => (await get(`/api/parts/${id}`)).on_hand_total),
      );
      for (const [index, qty] of [8, 6].entries()) {
        const part = await get(`/api/parts/${parts[index]}`);
        const from = part.locations.find((location) => location.slot_id === [source, sourceB][index]);
        kit = (
          await post(`/api/packouts/${kit.kit_id}/replenish`, {
            version: kit.version,
            part_id: parts[index],
            from_slot_id: from.slot_id,
            from_version: from.version,
            qty,
          })
        ).kit;
        assert.equal((await get(`/api/parts/${parts[index]}`)).on_hand_total, initialTotals[index]);
      }
      kit = (
        await post(`/api/packouts/${kit.kit_id}/issue`, {
          version: kit.version,
          employee_id: employee.employee_id,
        })
      ).kit;
      assert.equal(kit.status, 'issued');
      for (const [index, qty] of [8, 6].entries()) {
        const part = await get(`/api/parts/${parts[index]}`);
        assert.equal(part.on_hand_total, initialTotals[index]);
        assert.equal(part.available_total, initialTotals[index] - qty);
        assert.equal(part.issued_total, qty);
      }
      assert.equal((await get('/api/packouts', { role: 'viewer' })).items[0].kit_id, kit.kit_id);
      assert.deepEqual((await get('/api/packouts', { role: 'outsider' })).items, []);
      await post('/api/stock/adjust', { part_id: parts[0], slot_id: staging, delta: -1 }, { expected: 400 });
      await request(
        'DELETE',
        `/api/shelves/${stagingShelf.shelf_id}`,
        { force: true },
        { role: 'admin', expected: 400 },
      );
      await request(
        'PATCH',
        `/api/employees/${employee.employee_id}`,
        { version: employee.version, active: false },
        { expected: 400 },
      );
      await post(
        `/api/packouts/${kit.kit_id}/return`,
        { version: kit.version, counts: [{ part_id: parts[0], remaining_qty: 3 }] },
        { expected: 400 },
      );
      await post(
        `/api/packouts/${kit.kit_id}/return`,
        {
          version: kit.version,
          counts: [
            { part_id: parts[0], remaining_qty: 9 },
            { part_id: parts[1], remaining_qty: 2 },
          ],
        },
        { expected: 400 },
      );
      const returnBody = {
        version: kit.version,
        counts: [
          { part_id: parts[0], remaining_qty: 3 },
          { part_id: parts[1], remaining_qty: 2 },
        ],
      };
      const returned = await post(`/api/packouts/${kit.kit_id}/return`, returnBody, {
        headers: { 'Idempotency-Key': 'smoke-return-kit' },
      });
      kit = returned.kit;
      const expectedTotals = initialTotals.map((total, index) => total - [5, 4][index]);
      async function assertTotals(totals, issued) {
        for (const [index, id] of parts.entries()) {
          const part = await get(`/api/parts/${id}`);
          assert.equal(part.on_hand_total, totals[index]);
          assert.equal(part.issued_total, issued ? [8, 6][index] : 0);
          assert.equal(part.available_total, totals[index] - (issued ? [8, 6][index] : 0));
        }
      }
      await assertTotals(expectedTotals, false);
      const undo = await post(`/api/events/${returned.event_id}/undo`, {});
      await assertTotals(initialTotals, true);
      assert.equal(
        (await get('/api/packouts', { role: 'viewer' })).items[0].employee_id,
        employee.employee_id,
      );
      await post(`/api/events/${undo.event_id}/undo`, {});
      await assertTotals(expectedTotals, false);
      const replay = await request('POST', `/api/packouts/${kit.kit_id}/return`, returnBody, {
        headers: { 'Idempotency-Key': 'smoke-return-kit' },
      });
      assert.equal(replay.data.event_id, returned.event_id);
      assert.equal(replay.response.headers.get('Idempotency-Replayed'), 'true');
      await assertTotals(expectedTotals, false);
      assert.deepEqual((await get('/api/packouts', { role: 'viewer' })).items, []);
      const counts = (
        await db.prepare('SELECT counted_by,counted_at FROM stock WHERE slot_id=?').bind(staging).all()
      ).results;
      assert.ok(counts.every((row) => row.counted_by === emails.editor && row.counted_at));
    },
  );

  await check('auditable history, CSV identity export, and frontend route assets', async () => {
    const history = await get(`/api/events?entity=packout&entity_id=${kit.kit_id}`);
    assert.deepEqual(
      history.items.map((event) => event.action),
      ['undo', 'undo', 'return', 'issue', 'replenish', 'replenish', 'create'],
    );
    assert.ok(history.items.every((event) => event.by === emails.editor));
    const redacted = await get('/api/events', { role: 'viewer' });
    assert.ok(
      redacted.items.every(
        (event) => Object.keys(event.before).length === 0 && Object.keys(event.after).length === 0,
      ),
    );
    const csv = await get('/api/export.csv');
    assert.ok(parts.every((id) => csv.includes(id)));
    for (const route of [
      '/',
      '/warehouse/',
      '/warehouse/demo-labels.html',
      '/map/',
      '/labels/',
      '/employee/',
      '/packouts/',
    ]) {
      const { data, response } = await request('GET', route);
      assert.ok(response.headers.get('Content-Type').includes('text/html'));
      assert.ok(data.includes('<script'), `${route} has no compiled entrypoint`);
    }
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    // D1 exposes quick_check, rather than SQLite's unrestricted integrity_check pragma.
    assert.equal(await scalar('PRAGMA quick_check'), 'ok');
  });

  if (process.argv.includes('--browser')) {
    await check(
      'production browser routes, live registration/reload, scanner, viewer map, and packout return',
      async () => {
        browserResult = await browserSmoke({ parts, staging, stagingShelf, employee, kit });
      },
    );
  }

  await check('inventory and audit persist across a workerd restart', async () => {
    const saved = await Promise.all(parts.map((id) => get(`/api/parts/${id}`)));
    const eventCount = await scalar('SELECT count(*) FROM events');
    await mf.dispose();
    mf = new Miniflare(options);
    await mf.ready;
    db = await mf.getD1Database('warehouse-db');
    assert.deepEqual(await Promise.all(parts.map((id) => get(`/api/parts/${id}`))), saved);
    assert.equal(await scalar('SELECT count(*) FROM events'), eventCount);
    assert.equal((await get('/api/packouts')).items[0].status, 'available');
    if (browserResult)
      assert.equal((await get(`/api/parts/${browserResult.part_id}`)).part_code, 'BROWSER-LIVE');
    assert.deepEqual(await get('/api/health'), { ok: true, d1_bound: true, schema_ready: true });
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  });
  assert.ok(certificateFetches >= 2, 'Real JWT verification must request the fixture JWKS after restart');
  assert.deepEqual(unexpectedOutbound, []);
  const report = {
    ok: true,
    runtime: 'compiled Pages Functions in local workerd with D1',
    checks: completed,
    migrations: appliedMigrations,
    api_requests: apiRequests,
    certificate_fetches: certificateFetches,
    browser: browserResult,
    production_resources_used: false,
  };
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts/live-smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Local compiled-worker smoke passed: ${completed.length} checks, ${apiRequests} requests, ${appliedMigrations.length} migrations.`,
  );
} finally {
  await mf?.dispose();
  await rm(temporaryRoot, { recursive: true, force: true });
}
