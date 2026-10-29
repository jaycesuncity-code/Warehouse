import { expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __sc: {
      api: import('../src/shared/api').ApiClient;
      getMockRole: () => string;
      setMockRole: (r: 'viewer' | 'editor' | 'admin') => void;
      resetDemoData: () => void;
      setMockLatency: (ms: number) => void;
    };
  }
}

/** Open a Warehouse app route with an instant mock. */
export async function openApp(page: Page, hash = '#/scan'): Promise<void> {
  await page.goto(`/warehouse/?latency=0${hash}`);
  await page.waitForFunction(() => !!window.__sc);
}

export async function partId(page: Page, code: string): Promise<string> {
  const id = await page.evaluate(async (c) => {
    const r = await window.__sc.api.searchParts({ q: c, limit: 50 });
    return r.items.find((p) => p.part_code === c)?.part_id ?? null;
  }, code);
  expect(id, `demo part ${code}`).toBeTruthy();
  return id as string;
}

export async function openPart(page: Page, code: string, view = ''): Promise<string> {
  await openApp(page, '#/scan');
  const id = await partId(page, code);
  await page.evaluate(([i, v]) => (window.location.hash = `#/part/${i}${v}`), [id, view ? `/${view}` : '']);
  return id;
}

export async function setRole(page: Page, role: 'viewer' | 'editor' | 'admin'): Promise<void> {
  await page.evaluate((r) => window.__sc.setMockRole(r), role);
}

export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => !!window.__sc);
}

/** Read the mock's own view of the world and check the rules that must always hold. */
export async function assertDataConsistent(page: Page): Promise<void> {
  const report = await page.evaluate(async () => {
    const problems: string[] = [];
    const layout = (await window.__sc.api.getLayout()).layout!;
    for (const s of layout.shelves) {
      for (const a of s.slots) {
        if (a.col_start < 1 || a.col_start + a.width_span - 1 > s.cols)
          problems.push(`${a.location_code} outside columns`);
        if (a.row_index < 0 || a.row_index + a.height_span > s.rows.length)
          problems.push(`${a.location_code} outside rows`);
        for (const b of s.slots) {
          if (a === b) continue;
          const c = a.col_start < b.col_start + b.width_span && b.col_start < a.col_start + a.width_span;
          const r = a.row_index < b.row_index + b.height_span && b.row_index < a.row_index + a.height_span;
          if (c && r) problems.push(`${a.location_code} overlaps ${b.location_code}`);
        }
      }
    }
    const parts = (await window.__sc.api.searchParts({ limit: 200 })).items;
    for (const p of parts) {
      let par = 0;
      let oh = 0;
      for (const l of p.locations) {
        if (l.on_hand_qty < 0 || l.par_qty < 0)
          problems.push(`${p.part_code} negative at ${l.location_code}`);
        par += l.par_qty;
        oh += l.on_hand_qty;
      }
      if (par !== p.par_total || oh !== p.on_hand_total) problems.push(`${p.part_code} totals do not add up`);
    }
    return problems;
  });
  expect(report).toEqual([]);
}

/** Collects anything that leaves the machine, plus console errors and page errors. */
export function watchPage(page: Page) {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { external, errors };
}

export async function blockExternal(page: Page, external: string[]): Promise<void> {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:')
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
}
