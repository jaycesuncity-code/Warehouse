import { expect, test } from '@playwright/test';
import { blockExternal, openApp, partId, watchPage } from './helpers';

test('no request leaves the machine and the console stays clean across every page', async ({ page }) => {
  const { external, errors } = watchPage(page);
  await blockExternal(page, external);
  await page.goto('/?latency=0');
  await expect(page.getByTestId('btn-warehouse')).toBeVisible();
  await page.goto('/employee/?latency=0');
  await expect(page.getByTestId('employee-coming-soon')).toBeVisible();
  await page.goto('/map/?latency=0&shelf=shf-aaaaaaaa');
  await expect(page.getByTestId('map-coming-soon')).toBeVisible();
  await page.goto('/warehouse/demo-labels.html?latency=0');
  await expect(page.getByTestId('demo-label').first()).toBeVisible();
  expect(await page.getByTestId('demo-label').count()).toBeGreaterThanOrEqual(26);

  await openApp(page);
  const id = await partId(page, 'CU-34-90');
  for (const hash of [
    `#/search`,
    `#/part/${id}`,
    `#/part/${id}/where`,
    `#/part/${id}/move?slot=x`,
    `#/part/${id}/swap`,
    `#/part/${id}/resize`,
    '#/unknown/prt-2222aaaa',
  ]) {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  expect(external, 'requests to other hosts').toEqual([]);
  expect(errors, 'console errors and warnings').toEqual([]);
});

test('works when localStorage is blocked (state lives in memory for the page)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
      configurable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
      configurable: true,
    });
  });
  const { errors } = watchPage(page);
  await page.goto('/warehouse/?latency=0#/scan');
  await page.waitForFunction(() => !!window.__sc);
  const id = await partId(page, 'CU-34-90');
  await page.evaluate((i) => (window.location.hash = `#/part/${i}`), id);
  await page.getByTestId('qty-plus').click();
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await expect(page.getByTestId('onhand-total')).toHaveText('63');
  expect(errors).toEqual([]);
});
