/**
 * Captures the key screens at phone (390 x 844) and desktop (1280 x 800) size into artifacts/screenshots/.
 * Run: npx playwright test e2e/screens.spec.ts
 */
import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openApp, openPart, partId, reloadApp, setRole } from './helpers';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1280x800', width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(`screenshots ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('capture', async ({ page }) => {
      test.setTimeout(180_000);
      const dir = `artifacts/screenshots/${vp.name}`;
      mkdirSync(dir, { recursive: true });
      let n = 0;
      const shot = async (p: Page, name: string, fullPage = true) => {
        n += 1;
        // Let toasts, pulses and transitions settle a little.
        await p.waitForTimeout(250);
        // A fixed tab bar would float in the middle of a full-page capture.
        if (fullPage)
          await p
            .addStyleTag({ content: 'nav[aria-label="Warehouse sections"]{display:none!important}' })
            .then((h) => h.evaluate((el) => (el as unknown as HTMLElement).setAttribute('data-shot', '1')));
        await p.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}-${name}.png`, fullPage });
        await p.evaluate(() => document.querySelectorAll('style[data-shot]').forEach((el) => el.remove()));
      };
      const tap = (code: string) =>
        page.locator(`[data-testid="front-slot"][data-slot-code="${code}"]`).click();

      await page.goto('/?latency=0');
      await shot(page, 'home');
      await page.goto('/employee/?latency=0');
      await shot(page, 'employee');
      await page.goto('/map/?latency=0');
      await expect(page.getByTestId('map-canvas')).toBeVisible();
      await shot(page, 'map');
      await page.goto('/warehouse/demo-labels.html?latency=0');
      await expect(page.getByTestId('demo-label').first()).toBeVisible();
      await shot(page, 'demo-labels');

      await openApp(page, '#/scan');
      await expect(page.getByTestId('simulate-select')).toBeVisible();
      await shot(page, 'scan');

      const id = await openPart(page, 'CU-34-90');
      await expect(page.getByTestId('part-code')).toHaveText('CU-34-90');
      await shot(page, 'part');

      await page.evaluate((i) => (window.location.hash = `#/part/${i}/where`), id);
      await expect(page.getByTestId('plan-marker')).toBeVisible();
      await shot(page, 'where-is-it');

      await page.getByTestId('btn-move').click();
      await expect(page.getByTestId('shelf-chooser')).toBeVisible();
      await shot(page, 'move-choose-shelf');
      await page.getByTestId('shelf-B1').click();
      await expect(page.getByTestId('shelf-front')).toBeVisible();
      await shot(page, 'move-pick-slot');
      await tap('B1-G-2');
      await expect(page.getByTestId('move-confirm')).toBeVisible();
      await shot(page, 'move-confirm-occupied', false);
      await page.getByTestId('confirm-move').click();
      await expect(page.getByTestId('occupied-dialog')).toBeVisible();
      await shot(page, 'occupied-warning', false);
      await page.getByTestId('opt-cancel').click();

      // resize with an overlap warning
      const pexId = await partId(page, 'PEX-12-RING');
      await page.evaluate((i) => (window.location.hash = `#/part/${i}/where`), pexId);
      await page.getByTestId('btn-resize').click();
      await page.getByRole('button', { name: 'Width: one more' }).click();
      await expect(page.getByTestId('resize-overlap')).toBeVisible();
      await shot(page, 'resize-overlap');

      // swap confirmation
      await page.evaluate((i) => (window.location.hash = `#/part/${i}/where`), id);
      await page.getByTestId('btn-swap').click();
      await tap('B1-G-3');
      await expect(page.getByTestId('swap-confirm')).toBeVisible();
      await shot(page, 'swap-confirm', false);

      // viewer
      await setRole(page, 'viewer');
      await reloadApp(page);
      await page.evaluate((i) => (window.location.hash = `#/part/${i}`), id);
      await expect(page.getByTestId('view-only-note')).toBeVisible();
      await shot(page, 'viewer-part');
      await page.evaluate((i) => (window.location.hash = `#/part/${i}/where`), id);
      await expect(page.getByTestId('where-card')).toBeVisible();
      await shot(page, 'viewer-where');

      // version conflict
      await setRole(page, 'editor');
      await reloadApp(page);
      await page.evaluate((i) => (window.location.hash = `#/part/${i}`), id);
      await page.getByTestId('demo-conflict-tool').locator('summary').click();
      await page.getByTestId('simulate-other-user').click();
      await page.getByTestId('set-count').click();
      await page.getByTestId('number-input').fill('50');
      await page.getByTestId('number-confirm').click();
      await expect(page.getByTestId('conflict-dialog')).toBeVisible();
      await shot(page, 'version-conflict', false);

      // shared bin and a not-assigned part
      await page.keyboard.press('Escape');
      await openPart(page, 'SW-FLOAT-01');
      await expect(page.getByTestId('not-assigned')).toBeVisible();
      await shot(page, 'not-assigned');
    });
  });
}
