import { expect, test, type Page } from '@playwright/test';
import type { Part } from '../src/shared/contract';
import { openApp } from './helpers';

type Fixture = { slots: string[]; shelfId: string; parts: Part[]; email: string };
async function fixture(page: Page): Promise<Fixture> {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const api = window.__sc.api;
    const layout = (await api.getLayout()).layout!;
    const shelf = layout.shelves.find(shelf => shelf.slots.filter(slot => slot.part_count === 0).length >= 2)!;
    if (!shelf) throw new Error('Fixture needs two free staging bins');
    await api.patchShelf(shelf.shelf_id, { version: shelf.version, location_type: 'packout' });
    const slots = shelf.slots.filter(slot => slot.part_count === 0).slice(0, 2).map(slot => slot.slot_id);
    const parts = (await api.searchParts({ limit: 100 })).items.filter(part => part.locations.some(location => !slots.includes(location.slot_id) && location.on_hand_qty >= 10)).slice(0, 2);
    if (parts.length !== 2) throw new Error('Fixture needs two stocked parts');
    return { slots, shelfId: shelf.shelf_id, parts, email: (await api.me()).email };
  });
  await page.goto('/packouts/?latency=0');
  await expect(page.getByRole('heading', { name: 'Packouts & kits', exact: true })).toBeVisible();
  return result;
}
async function employee(page: Page, name: string, email: string) {
  await page.getByRole('button', { name: 'Add kits & employees', exact: true }).click();
  await page.getByLabel('Employee name', { exact: true }).fill(name);
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await expect(page.getByText('Employee added.', { exact: true })).toBeVisible();
}
async function kit(page: Page, name: string, slot: string) {
  await page.getByRole('button', { name: 'Add kits & employees', exact: true }).click();
  await page.getByLabel('Kit name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Staging bin', exact: true }).selectOption(slot);
  await page.getByRole('button', { name: 'Create kit', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function transfer(page: Page, part: Part, qty: number) {
  await page.getByLabel('Find a part to transfer', { exact: true }).fill(part.part_code);
  await page.getByTestId('part-row').filter({ hasText: part.part_code }).click();
  const source = part.locations.find(location => !location.issued_kit_id && location.on_hand_qty >= qty)!;
  await page.getByRole('combobox', { name: 'Take from', exact: true }).selectOption(source.slot_id);
  await page.getByLabel('Quantity to transfer', { exact: true }).fill(String(qty));
  await page.getByRole('button', { name: 'Transfer to kit', exact: true }).click();
  await expect(page.getByText('Stock transferred into kit. Total inventory is unchanged.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer to kit', exact: true })).toHaveCount(0);
}
async function issue(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Employee', exact: true }).selectOption({ label: name });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Issue kit', exact: true }).click();
  await expect(page.getByText('With ' + name, { exact: true })).toBeVisible();
}
const currentPart = (page: Page, id: string) => page.evaluate(id => window.__sc.api.getPart(id), id);

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`packout lifecycle preserves inventory and audits counts at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const data = await fixture(page);
    await employee(page, 'Kit Technician', data.email);
    await kit(page, 'BOX 12 Plumbing', data.slots[0]);
    await expect(page.getByRole('button', { name: 'Issue kit', exact: true })).toBeDisabled();
    const initial = await Promise.all(data.parts.map(part => currentPart(page, part.part_id)));
    await transfer(page, data.parts[0], 8); await transfer(page, data.parts[1], 7);
    const staged = await Promise.all(data.parts.map(part => currentPart(page, part.part_id)));
    expect(staged.map(part => part.on_hand_total)).toEqual(initial.map(part => part.on_hand_total));
    expect(staged.map(part => part.available_total)).toEqual(initial.map(part => part.available_total));
    expect(staged.map(part => part.locations.find(location => location.slot_id === data.slots[0])?.on_hand_qty)).toEqual([8, 7]);
    await issue(page, 'Kit Technician');
    const issued = await Promise.all(data.parts.map(part => currentPart(page, part.part_id)));
    expect(issued.map(part => part.on_hand_total)).toEqual(initial.map(part => part.on_hand_total));
    expect(issued.map(part => part.issued_total)).toEqual([8, 7]);
    expect(issued.map(part => part.available_total)).toEqual(initial.map((part, index) => part.on_hand_total - [8, 7][index]));
    // Missing counts do not silently become zero or commit an inventory change.
    await page.getByRole('button', { name: 'Return & reconcile', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('remaining count for every issued part');
    await page.getByLabel('Remaining ' + data.parts[0].part_code, { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Return & reconcile', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('remaining count for every issued part');
    expect((await currentPart(page, data.parts[0].part_id)).on_hand_total).toBe(initial[0].on_hand_total);
    // Employee view is connected to the actual issued kit and offers no mutation controls.
    await page.goto('/employee/?latency=0');
    await expect(page.getByRole('region', { name: 'My issued kits' })).toContainText('BOX 12 Plumbing');
    await expect(page.getByRole('button', { name: /Issue kit|Return & reconcile|Transfer to kit/ })).toHaveCount(0);
    await page.goto('/packouts/?latency=0');
    await page.getByRole('button', { name: /BOX 12 Plumbing/ }).click();
    await page.getByLabel('Remaining ' + data.parts[0].part_code, { exact: true }).fill('3');
    await page.getByLabel('Remaining ' + data.parts[1].part_code, { exact: true }).fill('0');
    await page.getByLabel('Return notes (optional)', { exact: true }).fill('Job completed; counted each compartment.');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Return & reconcile', exact: true }).click();
    await expect(page.getByText('Kit returned and consumption recorded.', { exact: true })).toBeVisible();
    const returned = await Promise.all(data.parts.map(part => currentPart(page, part.part_id)));
    expect(returned.map(part => part.on_hand_total)).toEqual(initial.map((part, index) => part.on_hand_total - [5, 7][index]));
    expect(returned.map(part => part.available_total)).toEqual(returned.map(part => part.on_hand_total));
    await expect(page.getByText(/Returned and counted; 12 total units consumed/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText('With Kit Technician', { exact: true })).toBeVisible();
    expect((await currentPart(page, data.parts[0].part_id)).on_hand_total).toBe(initial[0].on_hand_total);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByText('Change restored.', { exact: true })).toBeVisible();
    expect((await currentPart(page, data.parts[0].part_id)).on_hand_total).toBe(initial[0].on_hand_total - 5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`packouts-${viewport.width}.png`), fullPage: true });
    await page.getByRole('link', { name: /Staging location/ }).click();
    // Wait for the staging deep link to finish selecting its shelf before changing tabs.
    await expect(page.getByTestId('front-view')).toBeVisible();
    if (viewport.width < 768) await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await expect(page.getByText('packout', { exact: true })).toBeVisible();
  });
}

test('viewer sees only their own kit and cannot mutate any packout', async ({ page }) => {
  const data = await fixture(page);
  await employee(page, 'Viewer Technician', 'demo.viewer@suncity.example');
  await employee(page, 'Other Technician', 'other@suncity.example');
  await kit(page, 'Assigned to viewer', data.slots[0]); await transfer(page, data.parts[0], 4); await issue(page, 'Viewer Technician');
  await kit(page, 'Another employee kit', data.slots[1]);
  const updated = await currentPart(page, data.parts[0].part_id);
  await transfer(page, updated, 3); await issue(page, 'Other Technician');
  await page.evaluate(() => window.__sc.setMockRole('viewer'));
  await page.goto('/employee/?latency=0');
  await expect(page.getByRole('region', { name: 'My issued kits' })).toContainText('Assigned to viewer');
  await expect(page.getByRole('region', { name: 'My issued kits' })).not.toContainText('Another employee kit');
  await page.goto('/packouts/?latency=0');
  await expect(page.getByRole('button', { name: /Assigned to viewer/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Another employee kit|Add kits & employees/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Assigned to viewer/ }).click();
  await expect(page.getByRole('button', { name: /Return & reconcile|Issue kit|Transfer to kit/ })).toHaveCount(0);
  await expect(page.getByLabel('Remaining ' + data.parts[0].part_code, { exact: true })).toHaveCount(0);
  const denied = await page.evaluate(async slot_id => {
    try { await window.__sc.api.createPackout({ name: 'Unauthorized kit', slot_id }); return 0; }
    catch (error) { return (error as { status: number }).status; }
  }, data.slots[0]);
  expect(denied).toBe(403);
  expect((await page.evaluate(() => window.__sc.api.listPackouts())).items.map(kit => kit.name)).toEqual(['Assigned to viewer']);
});

test('transfer conflicts refresh source stock and permit an informed retry', async ({ page }) => {
  const data = await fixture(page);
  await kit(page, 'Retry kit', data.slots[0]);
  const part = data.parts[0];
  const source = part.locations.find(location => !data.slots.includes(location.slot_id) && location.on_hand_qty >= 10)!;
  await page.getByLabel('Find a part to transfer', { exact: true }).fill(part.part_code);
  await page.getByTestId('part-row').filter({ hasText: part.part_code }).click();
  await page.getByRole('combobox', { name: 'Take from', exact: true }).selectOption(source.slot_id);
  await page.getByLabel('Quantity to transfer', { exact: true }).fill('2');
  // Another worker adjusts this source after the operator loaded its version.
  await page.evaluate(({ part_id, slot_id }) => window.__sc.api.adjustStock({ part_id, slot_id, delta: -1, reason: 'Concurrent count correction' }), { part_id: part.part_id, slot_id: source.slot_id });
  await page.getByRole('button', { name: 'Transfer to kit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Latest quantities loaded');
  await expect(page.getByRole('combobox', { name: 'Take from', exact: true }).locator('option:checked')).toContainText(`${source.on_hand_qty - 1} available`);
  expect((await currentPart(page, part.part_id)).locations.find(location => location.slot_id === data.slots[0])).toBeUndefined();
  await page.getByRole('button', { name: 'Transfer to kit', exact: true }).click();
  await expect(page.getByText('Stock transferred into kit. Total inventory is unchanged.', { exact: true })).toBeVisible();
  const updated = await currentPart(page, part.part_id);
  expect(updated.on_hand_total).toBe(part.on_hand_total - 1);
  expect(updated.locations.find(location => location.slot_id === data.slots[0])?.on_hand_qty).toBe(2);
  expect(updated.locations.find(location => location.slot_id === source.slot_id)?.on_hand_qty).toBe(source.on_hand_qty - 3);
});

test('employee retries a failed part lookup independently of kit refreshes', async ({ page }) => {
  await openApp(page);
  const part = (await page.evaluate(() => window.__sc.api.searchParts({ limit: 1 }))).items[0];
  await page.goto('/employee/?latency=0');
  await expect(page.getByRole('region', { name: 'My issued kits' })).not.toContainText('Loading');
  await page.evaluate(() => {
    const getPart = window.__sc.api.getPart;
    let fail = true;
    window.__sc.api.getPart = async id => {
      if (fail) { fail = false; throw new Error('Temporary lookup failure'); }
      return getPart(id);
    };
  });
  await page.getByTestId('lookup-input').fill(part.part_id);
  await page.getByTestId('lookup-go').click();
  await expect(page.getByRole('alert')).toContainText('Temporary lookup failure');
  // Refreshing employee custody must not dismiss a separate lookup error.
  await page.getByTestId('demo-badge').click();
  await page.getByTestId('role-editor').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('region', { name: 'My issued kits' })).not.toContainText('Loading');
  await expect(page.getByRole('alert')).toContainText('Temporary lookup failure');
  await page.getByRole('button', { name: 'Retry part lookup', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Part details' })).toContainText(part.part_code);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
