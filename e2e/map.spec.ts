// End-to-end checks for the /map/ page (mock mode). Run: npm run build && npm run test:e2e
// Every test blocks non-local network requests and fails on console errors.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SceneShelf } from "../src/map/scene/Debug";
import type { Layout } from "../src/shared/contract";
import { pointInPolygon } from "../src/map/geometry";

test.use({ viewport: { width: 1280, height: 800 } });

const SHOTS = "artifacts/screens";
mkdirSync(SHOTS, { recursive: true });

type Role = "viewer" | "editor" | "admin";
type DB = ReturnType<typeof import('../src/shared/mock').getDB>;

declare global {
  interface Window {
    __mapDebug: {
      zones(): Record<string, {minX:number;maxX:number;minZ:number;maxZ:number;width:number;depth:number}>;
      footprint(): {minX:number;maxX:number;minZ:number;maxZ:number;width:number;depth:number};
      shelves(): SceneShelf[];
      westOfZero(): string[];
      project(x:number,y:number,h?:number): {x:number;y:number};
      searchDots(): number;
      camera(): {type:string;position:number[];zoom:number;target:number[];view:string};
      info(): {calls:number;triangles:number;geometries:number};
      measureFrames(ms?:number): Promise<{frames:number;avg:number;p95:number;max:number}>;
    };
    __mock: typeof import("../src/shared/mock");
    __mapTimings?: Record<string, number>;
    __releaseShelfCreate?: () => void;
    __restoreMapGraphics?: () => void;
  }
}

const blocked: string[] = [];
const consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  blocked.length = 0;
  consoleErrors.length = 0;
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:")
      return route.continue();
    blocked.push(u.href);
    return route.abort();
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
});

test.afterEach(async () => {
  expect(blocked, "no requests outside the app").toEqual([]);
  expect(consoleErrors, "console must be clean").toEqual([]);
});

async function open(page: Page, path = "/map/", role: Role = "editor") {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      localStorage.setItem("sc.mock.role", r);
      sessionStorage.setItem("e2e-init", "1");
    }
  }, role);
  await page.goto(path);
  await page.waitForFunction(() => window.__mapDebug && window.__mock && window.__mapDebug.shelves().length > 0, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(900); // first camera fit
}

const db = (page: Page) => page.evaluate(() => window.__mock.getDB()) as Promise<DB>;
const shelfByName = async (page: Page, name: string) =>
  (await db(page)).shelves.find((s) => s.active && s.name === name)!;
const slotsOf = async (page: Page, shelfId: string) =>
  (await db(page)).slots.filter((s) => s.active && s.shelf_id === shelfId);
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function selectShelfInTree(page: Page, zone: string, name: string) {
  const tab = page.getByTestId("left-tab-layout");
  if (await tab.isVisible().catch(() => false)) await tab.click();
  const btn = page.getByTestId(`tree-shelf-${name}`);
  if (!(await btn.isVisible().catch(() => false))) await page.getByTestId(`tree-zone-${zone}`).click();
  await btn.click();
  await page.waitForTimeout(800);
}

/** Screen point inside a front-view cell (row label, 1-based column). */
async function cellPoint(page: Page, row: string, col: number, cols: number) {
  const deck = await page.getByTestId(`row-${row}`).locator("rect").first().boundingBox();
  if (!deck) throw new Error("no deck");
  const cw = deck.width / cols;
  return { x: deck.x + (col - 0.5) * cw, y: deck.y - 8 };
}

async function dragCells(page: Page, row: string, c0: number, c1: number, cols: number) {
  // Undo/redo notifications can cover the bottom deck. Clear them through their real UI first.
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  while (await dismiss.count()) {
    try { await dismiss.first().click({ timeout: 1000 }); }
    catch (error) { if (await dismiss.count()) throw error; } // a notice may expire between reads
  }
  const a = await cellPoint(page, row, c0, cols);
  const b = await cellPoint(page, row, c1, cols);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Data invariants the mock must keep after any sequence of edits. */
async function assertConsistent(page: Page) {
  const d = await db(page);
  const idRe = /^(prt|zon|opn|shf|slt|evt)-[2-9a-hj-km-np-z]{8}$/;
  for (const s of d.shelves) expect(s.shelf_id).toMatch(idRe);
  for (const s of d.slots) expect(s.slot_id).toMatch(idRe);
  const activeSlots = d.slots.filter((s) => s.active);
  const shelves = new Map(d.shelves.filter((s) => s.active).map((s) => [s.shelf_id, s]));
  const cells = new Set<string>();
  for (const s of activeSlots) {
    const sh = shelves.get(s.shelf_id);
    expect(sh, `slot ${s.slot_id} on an active shelf`).toBeTruthy();
    expect(s.col_start).toBeGreaterThanOrEqual(1);
    expect(s.col_start + s.width_span - 1).toBeLessThanOrEqual(sh!.cols);
    expect(s.row_index + s.height_span - 1).toBeLessThan(sh!.rows.length);
    for (let r = s.row_index; r < s.row_index + s.height_span; r++)
      for (let c = s.col_start; c < s.col_start + s.width_span; c++) {
        const k = `${s.shelf_id}:${r}:${c}`;
        expect(cells.has(k), `two slots share cell ${k}`).toBe(false);
        cells.add(k);
      }
  }
  const slotIds = new Set(activeSlots.map((s) => s.slot_id));
  const partIds = new Set(d.parts.filter((p) => p.active).map((p) => p.part_id));
  for (const l of d.locations.filter((x) => x.active)) {
    expect(slotIds.has(l.slot_id), `location ${l.part_id} in an active slot`).toBe(true);
    expect(partIds.has(l.part_id)).toBe(true);
    expect(l.on_hand_qty).toBeGreaterThanOrEqual(0);
    expect(l.par_qty).toBeGreaterThanOrEqual(0);
  }
  for (const z of d.zones) for (const [x] of z.polygon_in) expect(x).toBeGreaterThanOrEqual(0);
}

// ---------------------------------------------------------------------------

test.describe("unavailable map graphics", () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`keeps search, shelf contents and scanner usable, then retries @${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
          if (["webgl", "webgl2", "experimental-webgl"].includes(contextId)) return null;
          return Reflect.apply(original, this, [contextId, ...args]);
        } as typeof original;
        window.__restoreMapGraphics = () => { HTMLCanvasElement.prototype.getContext = original; };
      });
      await page.goto("/map/");
      const fallback = page.getByTestId("map-graphics-unavailable");
      await expect(fallback).toBeVisible();
      await expect(fallback).toContainText("hardware acceleration");
      await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
      await expect(page.getByTestId("loading")).toHaveCount(0);
      await page.getByRole("button", { name: "Retry 3D map" }).click();
      await expect(fallback).toBeVisible();
      await shot(page, `graphics-unavailable-${viewport.width}`);

      // The real DOM shelf front and canonical part lookup do not require WebGL.
      await page.getByTestId("map-search").fill("prt-yegeqahj");
      await expect(page.getByTestId("part-card-name")).toHaveText("Air Filter 20x20x1 MERV 8");
      await expect(page.getByTestId("front-view")).toBeVisible();
      await page.getByRole("link", { name: "Open in the scan app" }).click();
      await expect(page).toHaveURL(/\/warehouse\/#\/part\/prt-yegeqahj$/);
      await expect(page.getByTestId("part-name")).toHaveText("Air Filter 20x20x1 MERV 8");

      // Recover in place once graphics are available; no application reload is required.
      await page.goBack();
      await expect(fallback).toBeVisible();
      await page.evaluate(() => window.__restoreMapGraphics?.());
      await page.getByRole("button", { name: "Retry 3D map" }).click();
      await page.waitForFunction(() => window.__mapDebug?.shelves().length > 0);
      await expect(fallback).toHaveCount(0);
      await expect(page.getByTestId("map-canvas")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});

test.describe("top-down scene (asserted from the rendered scene, not by eye)", () => {
  for (const vp of [
    { w: 1280, h: 800 },
    { w: 390, h: 844 },
  ]) {
    test(`building geometry and demo shelves @${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await open(page);
      await expect(page.getByTestId("view-plan")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("map-search")).toBeFocused();
      const zones = await page.evaluate(() => window.__mapDebug.zones());
      expect(zones["WAREHOUSE 126"]).toMatchObject({ minX: 0, minZ: 0, width: 483, depth: 1203 });
      expect(zones["STORAGE - FILTERS 120"].minZ).toBe(1683);
      expect(await page.evaluate(() => window.__mapDebug.footprint())).toMatchObject({
        minX: 0,
        minZ: 0,
        width: 1201,
        depth: 1947,
      });
      const shelves: {
        name: string;
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        front: { x: number; z: number };
      }[] = await page.evaluate(() => window.__mapDebug.shelves());
      const by = Object.fromEntries(shelves.map((s) => [s.name, s]));
      // A1: against the warehouse west wall (back on X = 0), facing east, Y 864..960
      expect(by.A1).toMatchObject({ minX: 0, maxX: 24, minZ: 864, maxZ: 960, front: { x: 1, z: 0 } });
      // B1 (contract §9: 240, 1651, 180°, 96 x 24): X 144..240, Y 1651..1675, faces north
      expect(by.B1).toMatchObject({ minX: 144, maxX: 240, minZ: 1651, maxZ: 1675, front: { x: 0, z: -1 } });
      // F1 (447.5, 1728, 90°, 96 x 24): X 447.5..471.5, Y 1728..1824, faces west
      expect(by.F1).toMatchObject({ minX: 447.5, maxX: 471.5, minZ: 1728, maxZ: 1824, front: { x: -1, z: 0 } });
      // Office side: nothing modeled west of X = 0 except the flat strip
      expect(await page.evaluate(() => window.__mapDebug.westOfZero())).toEqual([]);
      await shot(page, `plan-${vp.w}`);
    });
  }

  test("office side is not editable", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const mod = window.__mock;
      const d = mod.getDB();
      return {
        zonesWest: d.zones.filter((z: { polygon_in: number[][] }) => z.polygon_in.some((p) => p[0] < 0)).length,
      };
    });
    expect(r.zonesWest).toBe(0);
    await page.getByTestId("mode-edit").click();
    await selectShelfInTree(page, "WAREHOUSE 126", "A1");
    const x = page.getByTestId("shelf-x");
    await x.fill("-10");
    await x.press("Enter");
    await page.waitForTimeout(300);
    expect((await shelfByName(page, "A1")).x_in).toBe(24); // refused client-side (min 0); the API refuses too (unit test)
  });
});

test.describe("search-first map", () => {
  test("narrows: many shelves -> one shelf -> one slot -> none -> cleared", async ({ page }) => {
    await open(page);
    const search = page.getByTestId("map-search");
    const level = () => page.getByTestId("search-status").getAttribute("data-level");
    await search.fill("f");
    await expect.poll(level).toBe("floor");
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => window.__mapDebug.searchDots())).toBeGreaterThan(2);
    await shot(page, "search-dots-1280");
    await search.fill("filter");
    await expect.poll(level).toBe("shelf");
    await expect(page.getByTestId("front-view")).toBeVisible();
    await expect(page.getByTestId("inspector-title")).toHaveText("Shelf F1");
    expect(await page.evaluate(() => window.__mapDebug.searchDots())).toBe(1);
    await page.waitForTimeout(900);
    await shot(page, "search-zoom-shelf-1280");
    await search.fill("filter 20x20");
    await expect.poll(level).toBe("slot");
    await expect(page.getByTestId("slot-inspector")).toBeVisible();
    await expect(page.getByTestId("part-card-name")).toHaveText("Air Filter 20x20x1 MERV 8");
    await page.waitForTimeout(900);
    await shot(page, "search-zoom-slot-1280");
    await search.fill("filter 20x20-no-match");
    await expect.poll(level).toBe("none");
    await expect(page.getByTestId("search-status")).toHaveText(/No results/);
    await search.fill("");
    await expect(page.getByTestId("search-results")).toHaveCount(0);
    await expect(page.getByTestId("front-view")).toHaveCount(0);
  });

  test("a scanned prt- ID (keyboard wedge) jumps to its slot", async ({ page }) => {
    await open(page);
    await page.getByTestId("map-search").blur();
    await page.locator("header").click();
    await page.keyboard.type("prt-wt82v4gp", { delay: 5 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("part-card-name")).toHaveText(/6" Duct Start Collar/);
    await expect(page.getByTestId("inspector-title")).toHaveText("A1-2-1");
  });

  test("phone: search, dots, zoom to a shelf", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByTestId("map-search").fill("elbow");
    await expect(page.getByTestId("sheet-results")).toBeVisible();
    await page.waitForTimeout(900);
    await shot(page, "search-dots-390");
    await page.getByTestId("map-search").fill("filter");
    await expect(page.getByTestId("sheet-front")).toBeVisible();
    await page.waitForTimeout(900);
    await shot(page, "search-zoom-shelf-390");
  });
});

async function orbitAndWalk(page: Page, w: number) {
  await open(page);
  await page.getByTestId("view-orbit").click();
  await page.waitForTimeout(800);
  expect((await page.evaluate(() => window.__mapDebug.camera())).type).toBe("PerspectiveCamera");
  await selectOrSearch(page, w, "A1");
  await page.waitForTimeout(900);
  await shot(page, `orbit-${w}`);
  await page.getByTestId("view-walk").click();
  await page.waitForTimeout(700);
  const cam0 = await page.evaluate(() => window.__mapDebug.camera());
  expect(cam0.position[1]).toBeCloseTo(66, 0); // eye height 5'-6"
  expect(cam0.position[0]).toBeGreaterThan(60); // starts 5' in front of A1, not inside it
  await shot(page, `walk-${w}`);
  // A1's front is x=24 at z=912. Walking straight west must stop one body radius away.
  // The former diagonal path could slide south through door 35 on slower CI machines.
  try {
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await page.evaluate(() => window.__mapDebug.camera())).position[0], { timeout: 15_000 }).toBeLessThan(33.1);
    await page.waitForTimeout(250); // keep pushing against the shelf, after actually reaching it
  } finally {
    await page.keyboard.up("KeyW");
  }
  const atShelf = await page.evaluate(() => window.__mapDebug.camera());
  expect(atShelf.position[0]).toBeCloseTo(33.01, 1);
  expect(atShelf.position[2]).toBeCloseTo(cam0.position[2], 1);
  // The east wall is solid at z=912 (door 40 ends at z=898). Run backward into it.
  try {
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("KeyS");
    await expect.poll(async () => (await page.evaluate(() => window.__mapDebug.camera())).position[0], { timeout: 15_000 }).toBeGreaterThan(473);
    await page.waitForTimeout(250);
  } finally {
    await page.keyboard.up("KeyS");
    await page.keyboard.up("ShiftLeft");
  }
  const cam1 = await page.evaluate(() => window.__mapDebug.camera());
  expect(cam1.position[0]).toBeCloseTo(483 - 9.01, 1);
  expect(cam1.position[2]).toBeCloseTo(cam0.position[2], 1);
  expect(cam1.position[1]).toBeCloseTo(66, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("view-orbit")).toHaveAttribute("aria-checked", "true");
}

test.describe("navigation (desktop)", () => {
  test("plan-to-walk initializes the active camera and layout refreshes preserve its position", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('view-plan')).toHaveAttribute('aria-checked', 'true');
    await selectShelfInTree(page, 'WAREHOUSE 126', 'A1');
    await page.getByTestId('view-walk').click();
    await expect.poll(async () => (await page.evaluate(() => window.__mapDebug.camera())).position.map(value => Math.round(value)))
      .toEqual([84, 66, 912]);
    try {
      await page.keyboard.down('KeyS');
      await expect.poll(async () => (await page.evaluate(() => window.__mapDebug.camera())).position[0]).toBeGreaterThan(108);
    } finally { await page.keyboard.up('KeyS'); }
    const before = await page.evaluate(() => window.__mapDebug.camera());
    // Another employee changes inventory and unrelated geometry; focus refreshes the live layout.
    await page.evaluate(() => {
      const state = window.__mock.getDB();
      const stock = state.stock.find(item => item.active)!;
      const otherShelf = state.shelves.find(item => item.name === 'A2')!;
      const changes = [
        window.__mock.handleMockRequest('POST', '/api/stock/adjust', { role: 'editor', body: { part_id: stock.part_id, slot_id: stock.slot_id, delta: 1 } }),
        window.__mock.handleMockRequest('PATCH', `/api/shelves/${otherShelf.shelf_id}`, { role: 'editor', body: { version: otherShelf.version, name: 'A2 refreshed' } }),
      ];
      for (const change of changes) if (change.status >= 400) throw new Error(JSON.stringify(change.body));
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(async () => page.evaluate(() => window.__mapDebug.shelves().some(shelf => shelf.name === 'A2 refreshed'))).toBe(true);
    const after = await page.evaluate(() => window.__mapDebug.camera());
    expect(after.view).toBe('walk');
    expect(after.type).toBe('PerspectiveCamera');
    expect(after.position.map(value => Math.round(value * 1000))).toEqual(before.position.map(value => Math.round(value * 1000)));
  });

  test("3D orbit and walk @1280", async ({ page }) => {
    await orbitAndWalk(page, 1280);
    await expect(page.getByTestId("joystick")).toHaveCount(0); // mouse: no joystick
  });
});

test.describe("navigation (phone, touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("3D orbit and walk @390 with joystick", async ({ page }) => {
    await open(page);
    await page.getByTestId("view-walk").click();
    await expect(page.getByTestId("joystick")).toBeVisible();
    const rooms = (await db(page)).zones;
    await expect.poll(async () => {
      const position = await page.evaluate(() => window.__mapDebug.camera().position);
      return rooms.some(room => pointInPolygon({ x: position[0], y: position[2] }, room.polygon_in));
    }).toBe(true);
    const j = (await page.getByTestId("joystick").boundingBox())!;
    const before = await page.evaluate(() => window.__mapDebug.camera().position);
    await page.mouse.move(j.x + j.width / 2, j.y + j.height / 2);
    await page.mouse.down();
    try {
      // The initial plan target is in STORAGE 125 near its north wall. Back into its clear aisle.
      await page.mouse.move(j.x + j.width / 2, j.y + j.height - 4, { steps: 3 });
      await expect.poll(async () => {
        const position = await page.evaluate(() => window.__mapDebug.camera().position);
        return Math.hypot(position[0] - before[0], position[2] - before[2]);
      }).toBeGreaterThan(10);
    } finally { await page.mouse.up(); }
    const after = await page.evaluate(() => window.__mapDebug.camera().position);
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(10);
    await page.keyboard.press("Escape");
    await orbitAndWalk(page, 390);
  });
});

async function selectOrSearch(page: Page, w: number, name: string) {
  if (w >= 1024) return selectShelfInTree(page, "WAREHOUSE 126", name);
  await page.getByTestId("mobile-tab-tree").click();
  await page.getByTestId("tree-zone-WAREHOUSE 126").click();
  await page.getByTestId(`tree-shelf-${name}`).click();
}

test.describe("deep links", () => {
  test("scanner to map and back preserves the canonical part", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/warehouse/?latency=0#/part/prt-yegeqahj/where");
    await page.getByTestId("open-3d").click();
    await page.waitForFunction(() => window.__mapDebug && window.__mapDebug.shelves().length > 0);
    await expect(page.getByTestId("part-card-name")).toHaveText("Air Filter 20x20x1 MERV 8");
    await expect(page.getByTestId("slot-inspector")).toBeVisible();
    await expect(page.getByTestId("inspector-title")).toHaveText(/^F1-/);
    await expect(page.getByTestId("front-view")).toBeVisible();
    await page.getByRole("link", { name: "Open in the scan app" }).click();
    await expect(page).toHaveURL(/\/warehouse\/#\/part\/prt-yegeqahj$/);
    await expect(page.getByTestId("part-name")).toHaveText("Air Filter 20x20x1 MERV 8");
  });
  test("/map/?shelf=&slot=", async ({ page }) => {
    await open(page, "/map/?slot=slt-natbbe7k");
    await expect(page.getByTestId("inspector-title")).toHaveText("A2-G-1");
    await expect(page.getByTestId("slot-part")).toHaveCount(2); // a slot holding two parts
  });
});

test.describe("roles", () => {
  test("viewer: search, view, walk, read-only front view", async ({ page }) => {
    await open(page, "/map/", "viewer");
    await expect(page.getByTestId("mode-edit")).toBeDisabled();
    await page.getByTestId("map-search").fill("filter");
    await expect(page.getByTestId("front-view")).toBeVisible();
    await expect(page.getByTestId("front-tools")).toHaveCount(0);
    await expect(page.getByTestId("shelf-name")).toBeDisabled();
    await page.waitForTimeout(800);
    await shot(page, "viewer-1280");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await shot(page, "viewer-390");
  });
});

test.describe("editing flows (mock mode)", () => {
  test("add, place from wall, rotate, undo/redo, duplicate, delete, rows/cols, slots, bins, parts, conflicts", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await open(page, "/map/?latency=250");
    await page.getByTestId("mode-edit").click();

    // Hold the create response so the optimistic state is observed deterministically,
    // even when a slow render takes longer than the normal simulated API latency.
    await page.evaluate(() => {
      const request = window.__mock.mockTransport.request.bind(window.__mock.mockTransport);
      const gate = new Promise<void>((resolve) => { window.__releaseShelfCreate = resolve; });
      window.__mock.mockTransport.request = async (...args) => {
        if (args[0] === "POST" && args[1].split("?")[0] === "/api/shelves") {
          await gate;
          window.__mock.mockTransport.request = request;
        }
        return request(...args);
      };
    });
    // --- add a shelf by clicking the floor (tmp- id until the server answers)
    await page.getByTestId("add-shelf").click();
    await expect(page.getByTestId("tool-hint")).toBeVisible();
    const p = await page.evaluate(() => window.__mapDebug.project(240, 300, 0));
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("inspector-id")).toHaveText(/tmp-/);
    expect((await db(page)).shelves.some((shelf) => shelf.shelf_id.startsWith("tmp-"))).toBe(false);
    await page.evaluate(() => window.__releaseShelfCreate?.());
    await expect(page.getByTestId("inspector-id")).toHaveText(/^shf-[2-9a-hj-km-np-z]{8}/);
    await page.getByTestId("shelf-name").fill("S1");
    await page.getByTestId("shelf-name").press("Enter");
    await expect.poll(async () => !!(await shelfByName(page, "S1"))).toBe(true);
    const s1 = await shelfByName(page, "S1");
    expect(s1).toBeTruthy();

    // --- place it from a wall measurement: north wall of 126, 10' from the W end, against the wall
    await page.getByTestId("place-from-wall").getByRole("button").first().click();
    await page.getByTestId("pfw-wall").selectOption({ label: "north wall (40'-3\")" });
    await page.getByTestId("pfw-offset").fill("10'");
    await page.getByTestId("pfw-offset").press("Enter");
    await expect(page.getByTestId("pfw-result")).toHaveText(/X 10'-0", Y 2'-0", 0°/);
    await page.getByTestId("pfw-apply").click();
    await expect.poll(async () => (await shelfByName(page, "S1")).y_in).toBe(24);
    const s = await shelfByName(page, "S1");
    expect(s).toMatchObject({ x_in: 120, y_in: 24, rotation_deg: 0 });
    expect(s.wall_ref).toMatch(/north wall, 10'-0" from W end/);

    // --- rotate (R), undo, redo, undo
    await page.locator("header").click();
    await page.keyboard.press("r");
    await expect.poll(async () => (await shelfByName(page, "S1")).rotation_deg).toBe(90);
    await page.getByTestId("undo").click();
    await expect.poll(async () => (await shelfByName(page, "S1")).rotation_deg).toBe(0);
    await page.getByTestId("redo").click();
    await expect.poll(async () => (await shelfByName(page, "S1")).rotation_deg).toBe(90);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await shelfByName(page, "S1")).rotation_deg).toBe(0);

    // --- duplicate (Ctrl+D) and delete (Del, confirm)
    await page.locator("header").click();
    await page.keyboard.press("Control+d");
    await expect.poll(async () => !!(await shelfByName(page, "S2"))).toBe(true);
    expect(await shelfByName(page, "S2")).toMatchObject({ x_in: 168, y_in: 24 });
    await page.locator("header").click();
    await page.keyboard.press("Delete");
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => !!(await shelfByName(page, "S2"))).toBe(false);

    // --- deleting a shelf that holds parts -> 409 shelf_not_empty with choices
    await selectShelfInTree(page, "WAREHOUSE 126", "A2");
    await page.locator("header").click();
    await page.keyboard.press("Delete");
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("not-empty-dialog")).toBeVisible();
    await page.getByTestId("not-empty-dialog").getByRole("button", { name: "Cancel" }).click();
    expect(await shelfByName(page, "A2")).toBeTruthy();

    // --- front view of S1: draw slots, fill a row, resize into an overlap (409)
    await selectShelfInTree(page, "WAREHOUSE 126", "S1");
    await page.getByTestId("open-front-view").click();
    await expect(page.getByTestId("front-view")).toBeVisible();
    await dragCells(page, "G", 1, 3, 12);
    await expect.poll(async () => (await slotsOf(page, s1.shelf_id)).length).toBe(1);
    expect((await slotsOf(page, s1.shelf_id))[0]).toMatchObject({
      row_index: 0,
      col_start: 1,
      width_span: 3,
      height_span: 1,
    });
    await dragCells(page, "G", 5, 6, 12);
    await expect.poll(async () => (await slotsOf(page, s1.shelf_id)).length).toBe(2);
    await page.getByTestId("fill-row-select").selectOption("1");
    await page.getByTestId("fill-row-n").fill("4");
    await page.getByTestId("fill-row").click();
    await expect.poll(async () => (await slotsOf(page, s1.shelf_id)).filter((x) => x.row_index === 1).length).toBe(4);
    await page.getByTestId("fv-slot-S1-G-1").click();
    await expect(page.getByTestId("resize-handles")).toBeVisible();
    const h = await page.getByTestId("handle-r").boundingBox();
    const target = await cellPoint(page, "G", 6, 12);
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, h!.y + h!.height / 2, { steps: 6 });
    await expect(page.getByTestId("fv-preview")).toHaveAttribute("data-bad", "1");
    await page.mouse.up();
    await expect(page.getByTestId("occupied-dialog")).toBeVisible();
    await shot(page, "conflict-occupied-1280");
    await page.getByTestId("occupied-dialog").getByRole("button", { name: "Cancel" }).last().click();
    expect((await slotsOf(page, s1.shelf_id)).find((x) => x.row_index === 0 && x.col_start === 1)!.width_span).toBe(3);

    // --- columns: shrinking under slots -> 409 slot_out_of_bounds, explained, nothing changed
    await page.getByTestId("front-cols").fill("4");
    await page.getByTestId("front-cols").press("Enter");
    await expect(page.getByTestId("oob-dialog")).toBeVisible();
    await expect(page.getByTestId("oob-dialog")).toContainText("S1-G-2");
    await shot(page, "conflict-out-of-bounds-1280");
    await page.getByTestId("oob-dialog").getByRole("button", { name: "Cancel" }).click();
    expect((await shelfByName(page, "S1")).cols).toBe(12);
    // rows: add one, then remove it
    const rows0 = (await shelfByName(page, "S1")).rows.length;
    await page.getByTestId("add-row").click();
    await expect.poll(async () => (await shelfByName(page, "S1")).rows.length).toBe(rows0 + 1);
    await page.getByTestId("remove-row").click();
    await expect.poll(async () => (await shelfByName(page, "S1")).rows.length).toBe(rows0);

    // --- bin dimensions (bigger than the 12" slot -> warning, never blocked)
    await page.getByTestId("fv-slot-S1-G-1").click();
    await page.getByTestId("bin-w").fill("20");
    await page.getByTestId("bin-w").press("Enter");
    await expect(page.getByTestId("bin-too-big")).toBeVisible();
    const g1 = (await slotsOf(page, s1.shelf_id)).find((x) => x.row_index === 0 && x.col_start === 1)!;
    expect(g1.bin_width_in).toBe(20);
    await shot(page, "front-view-editor-1280");

    // --- assign a part by drag (unassigned list -> slot)
    await page.getByTestId("left-tab-parts").click();
    const filter = page.getByTestId("unassigned-list").getByTestId("part-row").filter({ hasText: "Condensate Float Switch" });
    await filter.dragTo(page.getByTestId("fv-slot-S1-G-1"));
    await expect
      .poll(async () =>
        (await db(page)).locations.some((l) => l.active && l.part_id === "prt-rudx5et8" && l.slot_id === g1.slot_id),
      )
      .toBe(true);

    // --- occupied slot -> share
    await page.getByTestId("parts-search").fill("wax");
    await page
      .getByTestId("parts-panel")
      .getByTestId("part-row")
      .filter({ hasText: "Wax Ring" })
      .first()
      .dragTo(page.getByTestId("fv-slot-S1-G-1"));
    await expect(page.getByTestId("occupied-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Put both here (share the slot)" }).click();
    await expect
      .poll(async () => (await db(page)).locations.filter((l) => l.active && l.slot_id === g1.slot_id).length)
      .toBe(2);

    // --- swap: tape into G-2, then move the filter from G-1 onto G-2 -> Swap places
    const g2 = (await slotsOf(page, s1.shelf_id)).find((x) => x.row_index === 0 && x.col_start === 5)!;
    await page.getByTestId("parts-search").fill("collar");
    await page
      .getByTestId("parts-panel")
      .getByTestId("part-row")
      .filter({ hasText: "Start Collar" })
      .first()
      .dragTo(page.getByTestId("fv-slot-S1-G-2"));
    await expect
      .poll(async () =>
        (await db(page)).locations.some((l) => l.active && l.part_id === "prt-wt82v4gp" && l.slot_id === g2.slot_id),
      )
      .toBe(true);
    await page.getByTestId("fv-slot-S1-G-1").click();
    await page.getByTestId("slot-part").filter({ hasText: "Condensate Float Switch" }).getByTestId("move-part").click();
    await page.getByTestId("fv-slot-S1-G-2").click();
    await expect(page.getByTestId("occupied-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Swap places" }).click();
    await expect
      .poll(async () =>
        (await db(page)).locations.some((l) => l.active && l.part_id === "prt-rudx5et8" && l.slot_id === g2.slot_id),
      )
      .toBe(true);
    const locs = (await db(page)).locations.filter((l) => l.active);
    expect(locs.some((l) => l.part_id === "prt-wt82v4gp" && l.slot_id === g1.slot_id)).toBe(true);
    expect(locs.some((l) => l.part_id === "prt-rudx5et8" && l.slot_id === g1.slot_id)).toBe(false);

    // --- version conflict: someone else changes S1, then we rename it
    await selectShelfInTree(page, "WAREHOUSE 126", "S1");
    await page.evaluate(() => {
      const sh = window.__mock
        .getDB()
        .shelves.find((x) => x.name === "S1" && x.active)!;
      sh.version += 1;
      sh.notes = "changed elsewhere";
    });
    await page.getByTestId("shelf-name").fill("S1x");
    await page.getByTestId("shelf-name").press("Enter");
    await expect(page.getByTestId("version-dialog")).toBeVisible();
    await expect(page.getByTestId("version-dialog").getByRole("button", { name: /Overwrite/ })).toHaveCount(0); // editors can't overwrite
    await shot(page, "conflict-version-1280");
    await page
      .getByTestId("version-dialog")
      .getByRole("button", { name: /Reload/ })
      .click();
    await expect(page.getByTestId("shelf-name")).toHaveValue("S1");
    expect((await shelfByName(page, "S1")).name).toBe("S1");

    await assertConsistent(page);
  });

  test("admin: overwrite on conflict, tick a room verified", async ({ page }) => {
    await open(page, "/map/", "admin");
    await page.getByTestId("mode-edit").click();
    await selectShelfInTree(page, "WAREHOUSE 126", "A2");
    await page.evaluate(() => {
      window.__mock.getDB().shelves.find((x) => x.name === "A2")!.version += 1;
    });
    await page.getByTestId("shelf-name").fill("A2-admin");
    await page.getByTestId("shelf-name").press("Enter");
    await page
      .getByTestId("version-dialog")
      .getByRole("button", { name: /Overwrite/ })
      .click();
    await expect.poll(async () => !!(await shelfByName(page, "A2-admin"))).toBe(true);
    await page.getByTestId("tree-zone-STORAGE 125").click();
    await expect(page.getByTestId("zone-inspector")).toBeVisible();
    await page.getByTestId("zone-verified").check();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => window.__mock.getDB().zones.find((z) => z.name === "STORAGE 125")!.verified,
          ),
      )
      .toBe(true);
    await assertConsistent(page);
  });

  test("API down: edits are listed, retried and saved when it's back", async ({ page }) => {
    await open(page);
    await page.getByTestId("mode-edit").click();
    await selectShelfInTree(page, "WAREHOUSE 126", "A2");
    await page.evaluate(() => window.__mock.setOffline(true));
    await page.locator("header").click();
    await page.keyboard.press("Shift+r");
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("failed-edits")).toContainText("Rotate A2");
    await expect(page.getByTestId("save-state")).toContainText("not saved");
    await shot(page, "offline-1280");
    await page.evaluate(() => window.__mock.setOffline(false));
    await expect(page.getByTestId("offline-banner")).toHaveCount(0, { timeout: 12_000 });
    await expect.poll(async () => (await shelfByName(page, "A2")).rotation_deg).toBe(285);
  });

  test("phone: conflict dialog fits", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByTestId("mode-edit").click();
    await page.getByTestId("mobile-tab-tree").click();
    await page.getByTestId("tree-zone-WAREHOUSE 126").click();
    await page.getByTestId("tree-shelf-A2").click();
    await page.getByTestId("mobile-tab-inspector").click();
    await page.evaluate(() => {
      window.__mock.getDB().shelves.find((x) => x.name === "A2")!.version += 1;
    });
    await page.getByTestId("shelf-name").fill("A2b");
    await page.getByTestId("shelf-name").press("Enter");
    await expect(page.getByTestId("version-dialog")).toBeVisible();
    await shot(page, "conflict-version-390");
  });
});


test('packout shelf type connects issued kits to map, scanner, and employee inventory', async ({ page }) => {
  await open(page, '/map/?latency=0', 'admin');
  await page.getByTestId('mode-edit').click();
  await selectShelfInTree(page, 'WAREHOUSE 126', 'A1');
  await page.getByTestId('shelf-location-type').selectOption('packout');
  await expect.poll(async () => (await shelfByName(page, 'A1')).location_type).toBe('packout');
  const fixture = await page.evaluate(() => {
    const mock = window.__mock;
    const post = (path: string, body: object) => {
      const result = mock.handleMockRequest('POST', `/api${path}`, { body, role: 'admin' });
      if (result.status >= 400) throw new Error(JSON.stringify(result.body));
      return result.body;
    };
    const employee = post('/employees', { name: 'Map tester', email: 'demo.admin@suncity.example' }) as { employee: { employee_id: string } };
    const kit = post('/packouts', { name: 'Map test kit', slot_id: 'slt-5jxbn9zp' }) as { kit: { kit_id: string; version: number } };
    post(`/packouts/${kit.kit.kit_id}/issue`, { employee_id: employee.employee.employee_id, version: kit.kit.version });
    return { shelf_id: mock.getDB().shelves.find((shelf) => shelf.name === 'A1')!.shelf_id };
  });
  await page.goto(`/map/?latency=0&shelf=${fixture.shelf_id}&slot=slt-5jxbn9zp&part=prt-26cr7rtx`);
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('slot-inspector')).toContainText('This kit is issued to an employee');
  await expect(page.getByTestId('slot-inspector').getByRole('button', { name: 'One more', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('add-part-submit')).toHaveCount(0);
  await expect(page.getByTestId('part-card')).toContainText('in issued kits');
  await page.goto('/warehouse/?latency=0#/part/prt-26cr7rtx');
  await expect(page.getByTestId('issued-kit-note')).toBeVisible();
  await expect(page.getByTestId('qty-adjust')).toHaveCount(0);
  await page.goto('/employee/?latency=0');
  await expect(page.getByTestId('employee-inventory')).toContainText('Map test kit');
});

test('snapshot export and import validate the whole file before replaying geometry', async ({ page }) => {
  await open(page, '/map/?latency=0', 'admin');
  await page.getByTestId('more-menu').click();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('export-snapshot').click();
  const download = await downloading;
  const snapshot = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
    format: string; format_version: number; layout: Layout;
  };
  expect(snapshot.format).toBe('suncity-layout-snapshot');
  expect(snapshot.format_version).toBe(1);
  const before = await db(page);
  const shelf = structuredClone(snapshot.layout.shelves[0]);
  const zone = structuredClone(snapshot.layout.zones.find(zone => zone.zone_id === shelf.zone_id)!);
  zone.zone_id = 'zon-22222222';
  zone.name = 'Imported room';
  shelf.shelf_id = 'shf-22222222';
  shelf.name = 'Imported shelf';
  shelf.zone_id = zone.zone_id;
  shelf.slots = shelf.slots.slice(0, 2).map((slot, index) => ({ ...slot, slot_id: `slt-2222222${index + 2}` }));
  snapshot.layout = { ...snapshot.layout, zones: [zone], openings: [], shelves: [shelf] };
  const upload = async (value: unknown) => {
    if (!(await page.getByTestId('export-snapshot').isVisible())) await page.getByTestId('more-menu').click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'layout-snapshot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
    });
  };
  await upload({ ...snapshot, layout: { ...snapshot.layout, shelves: [{ ...shelf, slots: [null] }] } });
  await expect(page.getByText('The snapshot contains an invalid bin record.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  expect((await db(page)).shelves).toEqual(before.shelves);
  expect((await db(page)).zones).toEqual(before.zones);

  await upload(snapshot);
  await expect(page.getByTestId('confirm-dialog')).toContainText('Import layout snapshot?');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Imported 4 items', { exact: true })).toBeVisible();
  const after = await db(page);
  const importedZone = after.zones.find(item => item.name === 'Imported room')!;
  const importedShelf = after.shelves.find(item => item.name === 'Imported shelf')!;
  expect(importedZone.zone_id).not.toBe(zone.zone_id);
  expect(importedShelf.shelf_id).not.toBe(shelf.shelf_id);
  expect(importedShelf.zone_id).toBe(importedZone.zone_id);
  expect(after.slots.filter(slot => slot.shelf_id === importedShelf.shelf_id)).toHaveLength(2);
  expect(after.stock).toEqual(before.stock);
  expect(after.parts).toEqual(before.parts);
  expect(importedZone.verified).toBe(false);
  await assertConsistent(page);
});

test.describe("performance", () => {
  test("300 shelves / 5,000 slots", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, "/map/?perf=1");
    const counts = await page.evaluate(() => {
      const d = window.__mock.getDB();
      return {
        shelves: d.shelves.filter((s: { active: boolean }) => s.active).length,
        slots: d.slots.filter((s: { active: boolean }) => s.active).length,
      };
    });
    expect(counts.shelves).toBe(300);
    expect(counts.slots).toBeGreaterThanOrEqual(4900);
    const load = await page.evaluate(() => window.__mapTimings?.layoutLoadMs ?? -1);
    await page.getByTestId("view-orbit").click();
    await page.waitForTimeout(1200);
    const orbit = await page.evaluate(() => window.__mapDebug.measureFrames(4000));
    const info = await page.evaluate(() => window.__mapDebug.info());
    await shot(page, "perf-orbit-1280");
    await page.getByTestId("view-plan").click();
    await page.waitForTimeout(800);
    const plan = await page.evaluate(() => window.__mapDebug.measureFrames(2000));
    const report = {
      counts,
      layoutLoadMs: Math.round(load),
      orbit,
      plan,
      drawCalls: info.calls,
      triangles: info.triangles,
    };
    writeFileSync("artifacts/perf.json", JSON.stringify(report, null, 2));
    console.log("PERF", JSON.stringify(report));
    expect(info.calls).toBeLessThan(150); // instancing keeps draw calls flat
  });
});
