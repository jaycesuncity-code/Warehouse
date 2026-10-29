import { expect, test, type Page } from '@playwright/test';
import { assertDataConsistent, openApp, openPart, partId, reloadApp, setRole } from './helpers';

const tapSlot = (page: Page, code: string) =>
  page.locator(`[data-testid="front-slot"][data-slot-code="${code}"]`).click();
const location = (page: Page, partCode: string) =>
  page.evaluate(async (c) => {
    const r = await window.__sc.api.searchParts({ q: c, limit: 50 });
    return r.items
      .find((p) => p.part_code === c)!
      .locations.map((l) => ({
        code: l.location_code,
        on_hand: l.on_hand_qty,
        par: l.par_qty,
        with: l.co_located_parts.map((x) => x.part_name),
      }));
  }, partCode);
const shelfSlot = (page: Page, shelf: string, code: string) =>
  page.evaluate(
    async ([s, c]) => {
      const lay = (await window.__sc.api.getLayout()).layout!;
      return lay.shelves.find((x) => x.name === s)!.slots.find((x) => x.location_code === c) ?? null;
    },
    [shelf, code],
  );

test.describe('home and placeholders', () => {
  test('home has two big buttons; employee and map are placeholders', async ({ page }) => {
    await page.goto('/?latency=0');
    await expect(page.getByTestId('btn-warehouse')).toHaveText(/Warehouse version/);
    await expect(page.getByTestId('btn-employee')).toHaveText(/Employee version/);
    await expect(page.getByTestId('demo-badge')).toBeVisible();
    await page.getByTestId('btn-employee').click();
    await expect(page.getByTestId('employee-coming-soon')).toContainText('Coming soon');
    await page.goto('/?latency=0');
    await page.getByTestId('btn-warehouse').click();
    await expect(page.getByTestId('scan-screen')).toBeVisible();
    await expect(page.getByTestId('tab-scan')).toBeVisible();
    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('map-coming-soon')).toContainText('3D warehouse map: coming soon');
    await page.getByRole('link', { name: 'Back to the Warehouse app' }).click();
    await expect(page.getByTestId('scan-screen')).toBeVisible();
  });
});

test.describe('scanning and lookup', () => {
  test('simulate a scan opens the part', async ({ page }) => {
    await openApp(page);
    const id = await partId(page, 'CU-34-90');
    await page.getByTestId('simulate-select').selectOption(id);
    await page.getByTestId('simulate-go').click();
    await expect(page.getByTestId('part-code')).toHaveText('CU-34-90');
    await expect(page.getByTestId('part-name')).toContainText('Copper 90°');
  });

  test('keyboard-wedge scanner: type the ID and press Enter', async ({ page }) => {
    await openApp(page);
    const id = await partId(page, 'FLT-16X25X1');
    await page.keyboard.type(id);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('part-code')).toHaveText('FLT-16X25X1');
  });

  test('wedge accepts capital letters from a shouting scanner', async ({ page }) => {
    await openApp(page);
    const id = await partId(page, 'DISC-60A');
    await page.keyboard.type(id.toUpperCase());
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('part-code')).toHaveText('DISC-60A');
  });

  test('labels that are not ours get a friendly message', async ({ page }) => {
    await openApp(page);
    for (const v of ['__website__', '__old__']) {
      await page.getByTestId('simulate-select').selectOption(v);
      await page.getByTestId('simulate-go').click();
      await expect(page.getByTestId('scan-notice')).toContainText("That isn't one of our part labels");
      await expect(page.getByTestId('scan-screen')).toBeVisible();
    }
    await page.keyboard.type('hello world');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('scan-notice')).toContainText("That isn't one of our part labels");
  });

  test('a valid ID that is not in the database shows Unknown label', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('simulate-select').selectOption('__unknown__');
    await page.getByTestId('simulate-go').click();
    await expect(page.getByTestId('unknown-screen')).toContainText("We don't know this label");
    await expect(page.getByTestId('unknown-id')).toHaveText('prt-2222aaaa');
    await expect(page.getByTestId('unknown-screen')).toContainText('label generator');
    await page.getByTestId('scan-again').click();
    await expect(page.getByTestId('scan-screen')).toBeVisible();
  });

  test('manual lookup by name and by exact code; recent scans strip', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('lookup-input').fill('elbow');
    const rows = page.getByTestId('part-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    await page.locator('[data-testid="part-row"][data-part-code="CU-12-90"]').click();
    await expect(page.getByTestId('part-code')).toHaveText('CU-12-90');
    await page.getByTestId('tab-scan').click();
    await page.getByTestId('lookup-input').fill('CU-12-TEE');
    await expect(page.getByTestId('part-row')).toHaveCount(1);
    await page.getByTestId('lookup-input').press('Enter');
    await expect(page.getByTestId('part-code')).toHaveText('CU-12-TEE');
    await page.getByTestId('tab-scan').click();
    await expect(page.getByTestId('recent-scans')).toContainText('CU-12-TEE');
    await expect(page.getByTestId('recent-scans')).toContainText('CU-12-90');
    await page.getByTestId('lookup-input').fill('zzzz-nothing');
    await expect(page.getByTestId('no-results')).toBeVisible();
  });

  test('search tab finds by category and name', async ({ page }) => {
    await openApp(page, '#/search');
    await page.getByTestId('lookup-input').fill('filter');
    await expect(page.locator('[data-testid="part-row"][data-part-code="FLT-16X25X1"]')).toBeVisible();
  });
});

test.describe('part screen and quantity', () => {
  test('shows name, code, stock, price, size', async ({ page }) => {
    await openPart(page, 'CU-34-90');
    await expect(page.getByTestId('part-name')).toHaveText('3/4" Copper 90° Elbow');
    await expect(page.getByTestId('part-code')).toHaveText('CU-34-90');
    await expect(page.getByTestId('dept-chip').first()).toHaveText('Plumbing Install');
    await expect(page.getByTestId('onhand-total')).toHaveText('62');
    await expect(page.getByTestId('par-total')).toHaveText('100');
    await expect(page.getByTestId('status-chip')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('shortfall')).toContainText('Short 38');
    await expect(page.getByTestId('price-cost')).toHaveText('$1.85');
    await expect(page.getByTestId('price-sale')).toHaveText('$4.25');
    await expect(page.getByTestId('size-line')).toContainText('1 1/4"');
    await expect(page.getByTestId('where-button')).toBeVisible();
  });

  test('status chips: Out, Low, Full', async ({ page }) => {
    await openPart(page, 'PVC-3-SAN');
    await expect(page.getByTestId('status-chip')).toHaveAttribute('data-status', 'out');
    await openPart(page, 'CAP-45-5');
    await expect(page.getByTestId('status-chip')).toHaveAttribute('data-status', 'low');
    await openPart(page, 'DISC-60A');
    await expect(page.getByTestId('status-chip')).toHaveAttribute('data-status', 'full');
    await openPart(page, 'DUCT-6-COLLAR');
    await expect(page.getByTestId('shortfall')).toContainText('over par');
  });

  test('+1 / -1 batch into one saved change; Undo reverses it', async ({ page }) => {
    await openPart(page, 'CU-34-90');
    await page.getByTestId('qty-plus').click();
    await page.getByTestId('qty-plus').click();
    await page.getByTestId('qty-plus').click();
    await page.getByTestId('qty-minus').click();
    await expect(page.getByTestId('qty-value')).toHaveText('64');
    await expect(page.getByTestId('save-state')).toContainText('Saved');
    await expect(page.getByTestId('onhand-total')).toHaveText('64');
    expect((await location(page, 'CU-34-90'))[0].on_hand).toBe(64);
    await expect(page.getByTestId('toast')).toContainText('62 → 64');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('onhand-total')).toHaveText('62');
    expect((await location(page, 'CU-34-90'))[0].on_hand).toBe(62);
  });

  test('chips, typed value and Set count', async ({ page }) => {
    await openPart(page, 'CU-34-90');
    await page.getByTestId('qty-chip-10').click();
    await page.getByTestId('qty-chip--5').click();
    await expect(page.getByTestId('qty-value')).toHaveText('67');
    await expect(page.getByTestId('save-state')).toContainText('Saved');

    await page.getByTestId('qty-number').click();
    await page.getByTestId('number-input').fill('40');
    await page.getByTestId('number-confirm').click();
    await expect(page.getByTestId('qty-value')).toHaveText('40');
    await expect(page.getByTestId('save-state')).toContainText('Saved');
    expect((await location(page, 'CU-34-90'))[0].on_hand).toBe(40);

    const countedBefore = await page.getByTestId('counted-at').textContent();
    await page.getByTestId('set-count').click();
    await page.getByTestId('number-input').fill('55');
    await page.getByTestId('number-confirm').click();
    await expect(page.getByTestId('qty-value')).toHaveText('55');
    await expect(page.getByTestId('counted-at')).not.toHaveText(countedBefore!); // stamped with the new count time
    expect((await location(page, 'CU-34-90'))[0].on_hand).toBe(55);
    await assertDataConsistent(page);
  });

  test('reason chip is sent and never goes below zero', async ({ page }) => {
    await openPart(page, 'PVC-3-SAN');
    await expect(page.getByTestId('qty-value')).toHaveText('0');
    await expect(page.getByTestId('qty-minus')).toBeDisabled();
    await expect(page.getByTestId('qty-chip--5')).toBeDisabled();
    await expect(page.getByTestId('qty-chip--10')).toBeDisabled();
    await page.getByText('Add a reason (optional)').click();
    await page.getByRole('button', { name: 'Received' }).click();
    await page.getByTestId('qty-chip-5').click();
    await expect(page.getByTestId('save-state')).toContainText('Saved');
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.__sc.api.listEvents({ limit: 5 })).items.map((e) => e.reason),
        ),
      )
      .toContain('Received');
    // lower it to exactly zero with the typed value, then try to go lower
    await page.getByTestId('qty-number').click();
    await page.getByTestId('number-input').fill('0');
    await page.getByTestId('number-confirm').click();
    await expect(page.getByTestId('qty-value')).toHaveText('0');
    await expect(page.getByTestId('qty-minus')).toBeDisabled();
  });

  test('a part with two places has a picker for which count you are changing', async ({ page }) => {
    await openPart(page, 'SB-12-BV');
    await expect(page.getByTestId('onhand-total')).toHaveText('28');
    await page.getByTestId('pick-A2-1-1').click();
    await page.getByTestId('qty-plus').click();
    await expect(page.getByTestId('save-state')).toContainText('Saved');
    await expect(page.getByTestId('onhand-total')).toHaveText('29');
    const locs = await location(page, 'SB-12-BV');
    expect(locs.map((l) => l.on_hand).sort()).toEqual([10, 19]);
  });

  test('version conflict on Set count: Reload, and Keep mine for admins', async ({ page }) => {
    await openPart(page, 'CU-34-90');
    await page.getByTestId('demo-conflict-tool').locator('summary').click();
    await page.getByTestId('simulate-other-user').click();
    await expect(page.getByTestId('toast').first()).toContainText('Someone else added 3');
    await page.getByTestId('set-count').click();
    await page.getByTestId('number-input').fill('50');
    await page.getByTestId('number-confirm').click();
    await expect(page.getByTestId('conflict-message')).toHaveText(
      "Someone else just changed this count. It's now 65.",
    );
    await expect(page.getByRole('button', { name: 'Keep mine' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByTestId('onhand-total')).toHaveText('65');

    // admin may overwrite
    await setRole(page, 'admin');
    await reloadApp(page);
    await page.getByTestId('demo-conflict-tool').locator('summary').click();
    await page.getByTestId('simulate-other-user').click();
    await page.getByTestId('set-count').click();
    await page.getByTestId('number-input').fill('50');
    await page.getByTestId('number-confirm').click();
    await expect(page.getByTestId('conflict-message')).toContainText("It's now 68");
    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expect(page.getByTestId('qty-value')).toHaveText('50');
    expect((await location(page, 'CU-34-90'))[0].on_hand).toBe(50);
  });

  test('viewer is read-only and does not see cost', async ({ page }) => {
    await openApp(page);
    await setRole(page, 'viewer');
    await reloadApp(page);
    const id = await partId(page, 'CU-34-90');
    await page.evaluate((i) => (window.location.hash = `#/part/${i}`), id);
    await expect(page.getByTestId('view-only-note')).toBeVisible();
    await expect(page.getByTestId('qty-plus')).toBeDisabled();
    await expect(page.getByTestId('qty-minus')).toBeDisabled();
    await expect(page.getByTestId('set-count')).toBeDisabled();
    await expect(page.getByTestId('cost-hidden')).toBeVisible();
    await expect(page.getByTestId('price-cost')).toHaveCount(0);
    await page.getByTestId('where-button').click();
    await expect(page.getByTestId('view-only-note')).toBeVisible();
    for (const name of ['Move', 'Swap', 'Resize bin', 'Remove from this slot', '+ Add another location']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    // going straight to an edit address is blocked too
    await page.evaluate((i) => (window.location.hash = `#/part/${i}/move`), id);
    await expect(page.getByTestId('view-only-note')).toBeVisible();
    await expect(page.getByTestId('shelf-chooser')).toHaveCount(0);
    // and the server (mock) refuses an edit by a viewer
    const status = await page.evaluate(async (i) => {
      try {
        await window.__sc.api.adjustStock({ part_id: i, slot_id: 'slt-xxxxxxxx', delta: 1 });
        return 'ok';
      } catch (e) {
        return (e as { error: string }).error;
      }
    }, id);
    expect(status).toBe('forbidden');
  });
});

test.describe('where is it', () => {
  test('location code, plain directions, front view, floor plan and 3D link', async ({ page }) => {
    const id = await openPart(page, 'CU-34-90');
    await page.getByTestId('where-button').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-4');
    await expect(page.getByTestId('where-zone-shelf')).toHaveText('Storage - Parts & Tools 121 · Shelf B1');
    await expect(page.getByTestId('directions')).toHaveText(
      'Storage - Parts & Tools 121, shelf B1 (south wall, facing north), ground row, 4th slot from the left, standing in the aisle facing the shelf',
    );
    await expect(page.locator('[data-testid="front-slot"][data-highlight="true"]')).toHaveCount(1);
    await expect(page.getByTestId('floor-plan')).toHaveAttribute(
      'data-focus-zone',
      'STORAGE - PARTS & TOOLS 121',
    );
    await expect(page.getByTestId('plan-marker')).toBeVisible();
    const href = await page.getByTestId('open-3d').getAttribute('href');
    const url = new URL(href!, 'http://x');
    expect(url.pathname).toBe('/map/');
    expect(url.searchParams.get('shelf')).toMatch(/^shf-[2-9a-hj-km-np-z]{8}$/);
    expect(url.searchParams.get('slot')).toMatch(/^slt-[2-9a-hj-km-np-z]{8}$/);
    // the deep link lands on the map placeholder with the same target
    await page.getByTestId('open-3d').click();
    await expect(page.getByTestId('map-target')).toContainText(url.searchParams.get('shelf')!);
    expect(id).toBeTruthy();
  });

  test('mini floor plan geometry: WAREHOUSE 126 is 483 x 1203 in and A1 sits on its west wall facing east', async ({
    page,
  }) => {
    await openPart(page, 'DISC-60A', 'where');
    await expect(page.getByTestId('where-code')).toHaveText('A1-G-2');
    await expect(page.getByTestId('directions')).toContainText(
      'Warehouse 126, shelf A1 (west wall, facing east), ground row, 2nd slot',
    );
    const geo = await page.evaluate(() => {
      const wh = document.querySelector('[data-testid="floor-plan"] polygon[data-zone="WAREHOUSE 126"]')!;
      const a1 = document.querySelector('[data-testid="floor-plan"] polygon[data-shelf="A1"]')!;
      const front = document.querySelector('[data-testid="floor-plan"] line[data-front="A1"]')!;
      const pts = a1
        .getAttribute('data-points')!
        .split(' ')
        .map((p) => p.split(',').map(Number));
      return {
        w: Number(wh.getAttribute('data-width-in')),
        h: Number(wh.getAttribute('data-height-in')),
        bbox: wh.getAttribute('data-bbox'),
        pts,
        front: ['x1', 'y1', 'x2', 'y2'].map((k) => Number(front.getAttribute(k))),
      };
    });
    expect(geo.w).toBe(483);
    expect(geo.h).toBe(1203);
    expect(geo.bbox).toBe('0,0,483,1203');
    const xs = geo.pts.map((p) => p[0]);
    const ys = geo.pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(0); // against the west wall (x = 0)
    expect(Math.max(...xs)).toBe(24);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(96);
    expect(geo.front).toEqual([24, 960, 24, 864]); // the front edge is the east face, so it faces east
  });

  test('a part sharing a slot, and a bin that is too small, are called out', async ({ page }) => {
    await openPart(page, 'PVC-2-90', 'where');
    await expect(page.getByTestId('shares-slot')).toContainText('PVC Coupling');
    await openPart(page, 'FLT-16X25X1', 'where');
    await expect(page.getByTestId('where-code')).toHaveText('F1-G-1');
    await expect(page.getByTestId('directions')).toContainText('(east wall, facing west)');
  });

  test('part with no location: Not assigned yet, then Put it somewhere', async ({ page }) => {
    await openPart(page, 'SW-FLOAT-01');
    await expect(page.getByTestId('not-assigned')).toContainText('Not assigned yet');
    await page.getByTestId('put-somewhere').click();
    await page.getByTestId('shelf-B1').click();
    await tapSlot(page, 'B1-G-5');
    await expect(page.getByTestId('move-confirm')).toContainText('Not assigned yet');
    await page.getByTestId('par-stepper').getByRole('button', { name: 'Par: one more' }).click();
    await page.getByTestId('par-stepper').getByRole('button', { name: 'Par: one more' }).click();
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-5');
    const locs = await location(page, 'SW-FLOAT-01');
    expect(locs).toEqual([{ code: 'B1-G-5', on_hand: 0, par: 2, with: [] }]);
    await assertDataConsistent(page);
  });

  test('remove from this slot (with confirm and Undo); the part stays', async ({ page }) => {
    await openPart(page, 'SB-12-BV', 'where');
    await expect(page.getByTestId('where-card')).toHaveCount(2);
    await page.getByTestId('where-card').first().getByTestId('btn-remove').click();
    await expect(page.getByTestId('remove-dialog')).toContainText('The part stays in the system');
    await page.getByTestId('confirm-remove').click();
    await expect(page.getByTestId('where-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('where-card')).toHaveCount(2);
    await assertDataConsistent(page);
  });
});

test.describe('moving', () => {
  async function startMove(page: Page, code: string) {
    await openPart(page, code, 'where');
    await page.getByTestId('btn-move').click();
    await page.getByTestId('shelf-filter').fill('B1');
    await page.getByTestId('shelf-B1').click();
  }

  test('move to a free slot carries par and on hand; Undo puts it back', async ({ page }) => {
    await startMove(page, 'CU-12-90'); // B1-G-1, 96 of 120
    await tapSlot(page, 'B1-G-5');
    await expect(page.getByTestId('move-confirm')).toContainText('Par 120 and 96 on hand go with it');
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-5');
    expect(await location(page, 'CU-12-90')).toEqual([{ code: 'B1-G-5', on_hand: 96, par: 120, with: [] }]);
    expect((await shelfSlot(page, 'B1', 'B1-G-1'))!.part_count).toBe(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-1');
    await assertDataConsistent(page);
  });

  test('"Also keep it in the old spot" adds a second place', async ({ page }) => {
    await startMove(page, 'CU-12-90');
    await tapSlot(page, 'B1-G-5');
    await page.getByTestId('choice-keep').click();
    await page.getByTestId('onhand-stepper').getByRole('button', { name: 'On hand: one more' }).click();
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('where-card')).toHaveCount(2);
    const locs = await location(page, 'CU-12-90');
    expect(locs.map((l) => l.code).sort()).toEqual(['B1-G-1', 'B1-G-5']);
    expect(locs.find((l) => l.code === 'B1-G-5')).toMatchObject({ par: 120, on_hand: 1 });
    expect(locs.find((l) => l.code === 'B1-G-1')).toMatchObject({ par: 120, on_hand: 96 });
    await assertDataConsistent(page);
  });

  test('you cannot pick a spot the part is already in', async ({ page }) => {
    await startMove(page, 'CU-12-90');
    // its own slot is drawn as "already here" and is not tappable
    await expect(page.locator('[data-testid="front-slot"][data-slot-code="B1-G-1"]')).toHaveCount(1);
    await expect(page.locator('[role="button"][data-slot-code="B1-G-1"]')).toHaveCount(0);
  });

  async function intoOccupied(page: Page) {
    await startMove(page, 'CU-12-90'); // from B1-G-1 into B1-G-2 where CU-12-TEE (71) lives
    await tapSlot(page, 'B1-G-2');
    await expect(page.getByTestId('occupied-note')).toContainText('already here');
    await page.getByTestId('confirm-move').click();
    const dlg = page.getByTestId('occupied-dialog');
    await expect(dlg).toContainText('Something\'s already here: 1/2" Copper Tee (on hand 71)');
    return dlg;
  }

  test('occupied: Swap places', async ({ page }) => {
    const dlg = await intoOccupied(page);
    await expect(dlg).toContainText('The spots keep their own size');
    await dlg.getByTestId('opt-swap').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-2');
    expect(await location(page, 'CU-12-90')).toEqual([{ code: 'B1-G-2', on_hand: 96, par: 120, with: [] }]);
    expect(await location(page, 'CU-12-TEE')).toEqual([{ code: 'B1-G-1', on_hand: 71, par: 80, with: [] }]);
    await assertDataConsistent(page);
  });

  test('occupied: Put both here (share)', async ({ page }) => {
    const dlg = await intoOccupied(page);
    await dlg.getByTestId('opt-share').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-2');
    await expect(page.getByTestId('shares-slot')).toContainText('Copper Tee');
    expect((await location(page, 'CU-12-TEE'))[0]).toMatchObject({ code: 'B1-G-2', on_hand: 71 });
    expect((await location(page, 'CU-12-90')).map((l) => l.code)).toEqual(['B1-G-2']);
    await assertDataConsistent(page);
  });

  test('occupied: Move that part somewhere else first, then finish the move', async ({ page }) => {
    const dlg = await intoOccupied(page);
    await dlg.getByTestId('opt-move-other').click();
    await expect(page.getByTestId('nested-banner')).toContainText('Step 1');
    await page.getByTestId('shelf-B1').click();
    await tapSlot(page, 'B1-G-5');
    await page.getByTestId('confirm-move').click();
    // nested move done, original move retried and finished
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-2');
    expect(await location(page, 'CU-12-TEE')).toEqual([{ code: 'B1-G-5', on_hand: 71, par: 80, with: [] }]);
    expect(await location(page, 'CU-12-90')).toEqual([{ code: 'B1-G-2', on_hand: 96, par: 120, with: [] }]);
    await assertDataConsistent(page);
  });

  test('occupied: Choose a different spot', async ({ page }) => {
    const dlg = await intoOccupied(page);
    await dlg.getByTestId('opt-different').click();
    await expect(page.getByTestId('occupied-dialog')).toHaveCount(0);
    await tapSlot(page, 'B1-G-5');
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-5');
    expect((await location(page, 'CU-12-TEE'))[0].code).toBe('B1-G-2');
  });

  test('occupied: Cancel changes nothing', async ({ page }) => {
    const dlg = await intoOccupied(page);
    await dlg.getByTestId('opt-cancel').click();
    await expect(page.getByTestId('where-screen')).toBeVisible();
    expect((await location(page, 'CU-12-90'))[0].code).toBe('B1-G-1');
    expect((await location(page, 'CU-12-TEE'))[0].code).toBe('B1-G-2');
  });

  test('"Also keep" into an occupied spot has no Swap, but can still share', async ({ page }) => {
    await startMove(page, 'CU-12-90');
    await tapSlot(page, 'B1-G-2');
    await page.getByTestId('choice-keep').click();
    await page.getByTestId('confirm-move').click();
    const dlg = page.getByTestId('occupied-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('opt-swap')).toHaveCount(0);
    await dlg.getByTestId('opt-share').click();
    await expect(page.getByTestId('where-card')).toHaveCount(2);
    expect((await location(page, 'CU-12-90')).map((l) => l.code).sort()).toEqual(['B1-G-1', 'B1-G-2']);
    await assertDataConsistent(page);
  });

  test('swap flow: tap the other part on the shelf and confirm', async ({ page }) => {
    await openPart(page, 'CU-12-90', 'where');
    await page.getByTestId('btn-swap').click();
    await tapSlot(page, 'B1-G-3'); // CU-34-CPL
    await expect(page.getByTestId('swap-confirm')).toContainText('goes to');
    await expect(page.getByTestId('swap-explain')).toContainText('Counts stay with each part');
    await page.getByTestId('confirm-swap').click();
    await expect(page.getByTestId('where-code')).toHaveText('B1-G-3');
    expect((await location(page, 'CU-34-CPL'))[0]).toMatchObject({ code: 'B1-G-1', on_hand: 24, par: 80 });
    await assertDataConsistent(page);
  });

  test('swap flow: find the other part by code, and unequal sizes are explained', async ({ page }) => {
    await openPart(page, 'CU-12-90', 'where'); // B1-G-1 (2 wide)
    await page.getByTestId('btn-swap').click();
    await page.getByTestId('lookup-input').fill('SB-12-BV');
    await page.locator('[data-testid="part-row"][data-part-code="SB-12-BV"]').click();
    await page
      .getByTestId('other-locations')
      .getByRole('button', { name: /A2-1-1/ })
      .click();
    const dlg = page.getByTestId('swap-confirm');
    await expect(dlg).toContainText('different sizes');
    await expect(dlg).toContainText('6 wide × 1 tall');
    await expect(dlg).toContainText('2 wide × 1 tall');
    await page.getByTestId('confirm-swap').click();
    await expect(page.getByTestId('where-code')).toHaveText('A2-1-1');
    await assertDataConsistent(page);
  });
});

test.describe('resize', () => {
  test('shrink with no overlap saves and shows the new size', async ({ page }) => {
    await openPart(page, 'PVC-3-SAN', 'where'); // A2-G-2, 3 wide
    await page.getByTestId('btn-resize').click();
    await expect(page.getByTestId('current-size')).toContainText('3 wide × 1 tall');
    await page.getByRole('button', { name: 'Width: one less' }).click();
    await expect(page.getByTestId('ghost')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('resize-overlap')).toHaveCount(0);
    await page.getByTestId('apply-resize').click();
    await expect(page.getByTestId('where-code')).toHaveText('A2-G-2');
    expect((await shelfSlot(page, 'A2', 'A2-G-2'))!.width_span).toBe(2);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await shelfSlot(page, 'A2', 'A2-G-2'))!.width_span).toBe(3);
    await assertDataConsistent(page);
  });

  test('growing into a neighbor warns, lists it, and lets you remove the empty spot', async ({ page }) => {
    await openPart(page, 'PEX-12-RING', 'where'); // A2-G-3: cols 6-7; A2-G-4 (empty) is cols 8-12
    await page.getByTestId('btn-resize').click();
    await page.getByRole('button', { name: 'Width: one more' }).click();
    await expect(page.getByTestId('ghost')).toHaveAttribute('data-ok', 'false');
    const warn = page.getByTestId('resize-overlap');
    await expect(warn).toContainText('A2-G-4');
    await expect(warn).toContainText('Empty spot');
    await expect(page.getByTestId('apply-resize')).toBeDisabled();
    await page.getByTestId('overlap-remove').click();
    await expect(page.getByTestId('resize-overlap')).toHaveCount(0);
    await expect(page.getByTestId('apply-resize')).toBeEnabled();
    await page.getByTestId('apply-resize').click();
    await expect(page.getByTestId('where-code')).toHaveText('A2-G-3');
    expect((await shelfSlot(page, 'A2', 'A2-G-3'))!.width_span).toBe(3);
    expect(await shelfSlot(page, 'A2', 'A2-G-4')).toBeNull();
    await assertDataConsistent(page);
  });

  test('growing into a neighbor that holds a part: move the part away, then it fits', async ({ page }) => {
    await openPart(page, 'DISC-60A', 'where'); // A1-G-2 cols 4-6; A1-G-3 (LS-38-34-25) is cols 7-8
    await page.getByTestId('btn-resize').click();
    await page.getByRole('button', { name: 'Width: one more' }).click();
    const warn = page.getByTestId('resize-overlap');
    await expect(warn).toContainText('Line Set');
    await page.getByTestId('overlap-move').click();
    await page.getByTestId('shelf-A1').click();
    await tapSlot(page, 'A1-4-1');
    await page.getByTestId('confirm-move').click();
    // back on the resize screen: the neighbor is now an empty spot
    await expect(page.getByTestId('overlap-remove')).toBeVisible();
    await page.getByTestId('overlap-remove').click();
    await page.getByTestId('apply-resize').click();
    await expect(page.getByTestId('where-code')).toHaveText('A1-G-2');
    expect((await shelfSlot(page, 'A1', 'A1-G-2'))!.width_span).toBe(4);
    expect((await location(page, 'LS-38-34-25'))[0].code).toBe('A1-4-1');
    await assertDataConsistent(page);
  });

  test('size past the edge of the shelf is refused; anchor and bin size', async ({ page }) => {
    await openPart(page, 'DISC-60A', 'where');
    await page.getByTestId('btn-resize').click();
    await page.getByTestId('anchor-bottom-right').click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Width: one more' }).click();
    // 9 wide held at the bottom-right corner runs off the left edge (cols 4-6 -> right edge 6)
    await expect(page.getByTestId('resize-edge')).toBeVisible();
    await expect(page.getByTestId('apply-resize')).toBeDisabled();
    await page.getByRole('button', { name: 'Use the biggest size that fits' }).click();
    await expect(page.getByTestId('resize-edge')).toHaveCount(0);
    await expect(page.getByTestId('width-stepper-value')).not.toHaveText('9');
  });

  test('a bin bigger than the spot warns but can still be saved', async ({ page }) => {
    await openPart(page, 'DISC-60A', 'where'); // slot 3 wide (24in), bin 16x10x14
    await page.getByTestId('btn-resize').click();
    await page.getByLabel('Width (optional)').fill('40');
    await expect(page.getByTestId('bin-warning')).toContainText('bigger than the spot');
    await page.getByTestId('apply-resize').click();
    await expect(page.getByTestId('where-code')).toHaveText('A1-G-2');
    expect((await shelfSlot(page, 'A1', 'A1-G-2'))!.bin_width_in).toBe(40);
  });
});

test('mock data stays consistent after a long mixed session, and Reset demo data restores it', async ({
  page,
}) => {
  await openPart(page, 'CU-12-90', 'where');
  await page.getByTestId('btn-move').click();
  await page.getByTestId('shelf-B1').click();
  await tapSlot(page, 'B1-G-5');
  await page.getByTestId('confirm-move').click();
  await expect(page.getByTestId('where-code')).toHaveText('B1-G-5');
  await assertDataConsistent(page);
  await page.getByTestId('demo-badge').click();
  await page.getByTestId('reset-demo').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Demo data reset' })).toBeVisible();
  expect((await location(page, 'CU-12-90'))[0].code).toBe('B1-G-1');
  await assertDataConsistent(page);
});
