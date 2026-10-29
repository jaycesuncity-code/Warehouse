import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { MockState } from '../src/shared/mock/state';
import { inspectLabelPdf } from '../src/labels/pdf-check';

const editor = (page: Page) => page.frameLocator('#generator');
async function open(page: Page) {
  await page.goto('/labels/');
  await expect(page.locator('#status')).not.toContainText('Loading');
  await expect(page.locator('#status')).not.toContainText('failed to load');
}
async function add(page: Page, code: string, name: string, quantity = '') {
  const frame = editor(page);
  await frame.getByRole('tab', { name: 'Add one part' }).click();
  await frame.locator('#oneName').fill(name);
  await frame.locator('#oneCode').fill(code);
  await frame.locator('#oneQty').fill(quantity);
  await frame.getByRole('button', { name: 'Add this part' }).click();
  await expect(page.locator('#selection')).toContainText(code);
}
async function state(page: Page): Promise<MockState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('sc.mock.state.v1') || 'null') as MockState);
}
async function register(page: Page) {
  await page.locator('#register').click();
  await expect(page.locator('#register')).toBeEnabled();
}
async function generate(page: Page) {
  await page.locator('#generate').click();
  await expect(page.locator('#generate')).toBeEnabled();
}

test.describe('connected parts and labels', () => {
  test('manual staging, selected registration, exact PDF QR and scanner roundtrip', async ({ page }, testInfo) => {
    await open(page);
    await add(page, 'LABEL-SELECTED', 'Copper Tee', '42');
    await add(page, 'LABEL-NOT-SELECTED', 'Copper Elbow', '50');
    await page.locator('.part-row').filter({ hasText: 'LABEL-NOT-SELECTED' }).getByRole('checkbox').uncheck();
    await expect(editor(page).locator('#firstPage .printed')).toHaveCount(1);
    await expect(editor(page).locator('#pageInfo')).toContainText('1 selected label');
    await generate(page);
    await expect(page.locator('#status')).toContainText('need attention');
    expect((await state(page)).parts.some(part => part.part_code.startsWith('LABEL-'))).toBe(false);
    const stock = (await state(page)).stock;
    await register(page);
    await expect(page.locator('#status')).toContainText('1 selected part(s) verified');
    const registered = (await state(page)).parts.find(part => part.part_code === 'LABEL-SELECTED')!;
    expect(registered.part_id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);
    expect((await state(page)).parts.some(part => part.part_code === 'LABEL-NOT-SELECTED')).toBe(false);
    await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 1 verified label');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('sun-city-bin-labels.pdf');
    const pdfPath = testInfo.outputPath('sun-city-bin-labels.pdf');
    await download.saveAs(pdfPath);
    await testInfo.attach('Downloaded warehouse labels', { path: pdfPath, contentType: 'application/pdf' });
    const pdf = inspectLabelPdf(await readFile((await download.path())!));
    expect([pdf.width, pdf.height]).toEqual([612, 792]);
    expect(pdf.pages.flatMap(page => page.decoded)).toEqual([registered.part_id]);
    expect((await state(page)).stock).toEqual(stock);
    const inlinePdf = await page.evaluate(() => navigator.pdfViewerEnabled === true);
    if (inlinePdf) {
      const opened = page.waitForEvent('popup');
      await editor(page).locator('#btnTest').click();
      await (await opened).close();
      await expect(editor(page).locator('#pdfFrame')).toHaveAttribute('src', /^blob:/);
    } else {
      const calibrationDownload = page.waitForEvent('download');
      await editor(page).locator('#btnTest').click();
      expect((await calibrationDownload).suggestedFilename()).toBe('sun-city-print-test.pdf');
      await expect(editor(page).locator('#pdfFrame')).not.toHaveAttribute('src');
      await expect(editor(page).locator('#pdfFallback')).toBeVisible();
    }
    await expect(page.locator('#status')).toContainText('Printer test page ready');
    await expect(page.locator('#download')).toBeDisabled();
    await expect(page.locator('#openPdf')).toBeHidden();
    await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 1 verified label');
    // The actual keyboard-wedge scanner consumes the exact payload decoded from the PDF.
    await page.goto('/warehouse/?latency=0#/scan');
    await expect(page.getByTestId('scan-screen')).toBeVisible();
    await page.keyboard.type(pdf.pages[0].decoded[0]);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Copper Tee', exact: true })).toBeVisible();
  });

  test('PDF generation without an inline viewer never downloads until requested', async ({ page, context }) => {
    await context.addInitScript(() => Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false }));
    const downloads: string[] = [];
    page.on('download', item => downloads.push(item.suggestedFilename()));
    await open(page); await add(page, 'LABEL-NO-PDF-VIEWER', 'Portable PDF fitting'); await register(page);
    const stock = (await state(page)).stock;
    const registered = (await state(page)).parts.find(part => part.part_code === 'LABEL-NO-PDF-VIEWER')!;
    await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 1');
    await expect(editor(page).locator('#pdfFallback')).toBeVisible();
    await expect(editor(page).locator('#pdfFrame')).not.toHaveAttribute('src');
    expect(downloads).toEqual([]);
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('sun-city-bin-labels.pdf');
    const pdf = inspectLabelPdf(await readFile((await download.path())!));
    expect(pdf.pages.flatMap(page => page.decoded)).toEqual([registered.part_id]);
    expect(downloads).toEqual(['sun-city-bin-labels.pdf']);
    await expect(page.locator('#openPdf')).toHaveText('Download to view / print');
    await expect(page.locator('#openPdf')).toHaveAttribute('download', 'sun-city-bin-labels.pdf');
    const linkedDownload = page.waitForEvent('download');
    await page.locator('#openPdf').click();
    expect((await linkedDownload).suggestedFilename()).toBe('sun-city-bin-labels.pdf');
    const calibrationDownload = page.waitForEvent('download');
    await editor(page).locator('#btnTest').click();
    expect((await calibrationDownload).suggestedFilename()).toBe('sun-city-print-test.pdf');
    await expect(editor(page).locator('#lnkPdf')).toHaveAttribute('download', 'sun-city-print-test.pdf');
    await expect(editor(page).locator('#pdfFrame')).not.toHaveAttribute('src');
    await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 1');
    expect(downloads).toEqual(['sun-city-bin-labels.pdf', 'sun-city-bin-labels.pdf', 'sun-city-print-test.pdf']);
    expect((await state(page)).stock).toEqual(stock);
  });

  test('partial successes remain exportable and retry without duplicate records', async ({ page }) => {
    await open(page);
    await page.locator('#query').fill('PEX'); await page.locator('#find').click();
    await expect(page.locator('#searchResults button').first()).toBeVisible();
    const existing = (await state(page)).parts[0];
    await add(page, 'LABEL-PARTIAL', 'New Coupling');
    await add(page, existing.part_code, 'Incorrect description');
    await register(page);
    await expect(page.locator('#status')).toContainText('1 verified; 1 need attention');
    await expect(page.locator('#csv')).toBeEnabled();
    const downloadEvent = page.waitForEvent('download'); await page.locator('#csv').click();
    const csv = await readFile((await (await downloadEvent).path())!, 'utf8');
    expect(csv).toContain('LABEL-PARTIAL'); expect(csv).not.toContain('Incorrect description');
    await editor(page).getByRole('textbox', { name: 'Part name, row 2', exact: true }).fill(existing.part_name);
    await register(page); await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 2 verified label');
    expect((await state(page)).parts.filter(part => part.part_code === 'LABEL-PARTIAL')).toHaveLength(1);
  });

  test('CSV upload, appended paste, XLSX export and reimport preserve source columns', async ({ page }) => {
    await open(page);
    const source = 'part_name,part_code,expected_qty,Vendor,Notes,Empty\nBrass Adapter,00123,9,"  ACME, Inc.  ","Line 1\nLine 2",\n';
    await editor(page).locator('#fileIn').setInputFiles({ name: 'parts.csv', mimeType: 'text/csv', buffer: Buffer.from(source) });
    await editor(page).locator('#impAdd').click();
    await editor(page).getByRole('tab', { name: 'Paste a list' }).click();
    await editor(page).locator('#pasteArea').fill('part_name\tpart_code\nPEX Tee\tPASTED-TEE');
    await editor(page).locator('#btnPaste').click(); await editor(page).locator('#impAdd').click();
    await expect(page.locator('#selection')).toContainText('2 staged');
    await register(page);
    const downloadEvent = page.waitForEvent('download'); await page.locator('#xlsx').click();
    const download = await downloadEvent; const file = await readFile((await download.path())!);
    // Clear with an explicit confirmation, then import the exported workbook.
    page.once('dialog', dialog => dialog.accept()); await editor(page).locator('#btnClear').click();
    await editor(page).getByRole('tab', { name: 'Upload a spreadsheet' }).click();
    await editor(page).locator('#fileIn').setInputFiles({ name: 'resolved-parts.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
    await editor(page).locator('#impAdd').click();
    await expect(editor(page).getByRole('textbox', { name: 'Part code, row 1', exact: true })).toHaveValue('00123');
    await expect(editor(page).getByRole('textbox', { name: 'Vendor, row 1', exact: true })).toHaveValue('  ACME, Inc.  ');
    await expect(editor(page).getByRole('textbox', { name: 'Notes, row 1', exact: true })).toHaveValue('Line 1Line 2');
    // Underlying multiline data is preserved even though single-line HTML inputs hide line breaks.
    const notes = await page.evaluate(() => {
      const child = document.querySelector<HTMLIFrameElement>('#generator')!.contentWindow as Window & { __BLG: { rows: { ex: Record<string, string> }[] } };
      return child.__BLG.rows[0].ex.Notes;
    });
    expect(notes).toBe('Line 1\nLine 2');
    const count = (await state(page)).parts.length;
    await generate(page); await expect(page.locator('#status')).toContainText('PDF ready: 2');
    expect((await state(page)).parts).toHaveLength(count);
  });

  test('edits, settings and selections invalidate stale PDF outputs and drafts survive reload', async ({ page }) => {
    await open(page); await add(page, 'LABEL-STALE', 'Steel Elbow'); await register(page); await generate(page);
    await expect(page.locator('#download')).toBeEnabled();
    await editor(page).getByRole('textbox', { name: 'Expected quantity, row 1', exact: true }).fill('25');
    await expect(page.locator('#download')).toBeDisabled(); await expect(page.locator('#openPdf')).toBeHidden();
    await generate(page); await editor(page).locator('#s_skip').fill('2'); await editor(page).locator('#s_skip').press('Tab');
    await expect(page.locator('#download')).toBeDisabled();
    await generate(page); await page.locator('#none').click();
    await expect(page.locator('#download')).toBeDisabled();
    await page.reload(); await expect(page.locator('#selection')).toContainText('1 staged · 0 selected');
    await expect(editor(page).getByRole('textbox', { name: 'Expected quantity, row 1', exact: true })).toHaveValue('25');
    await page.locator('#all').click(); await generate(page);
    await expect(page.locator('#status')).toContainText('PDF ready: 1');
    expect((await state(page)).parts.filter(part => part.part_code === 'LABEL-STALE')).toHaveLength(1);
    // A previously queued import/edit may complete while a multi-page PDF yields.
    // Simulate that late edit after the renderer exposes its preview.
    await page.evaluate(() => {
      const child = document.querySelector<HTMLIFrameElement>('#generator')!.contentWindow as Window & {
        __BLG: { rows: { qty: string }[]; renderConfirmed: (rows: unknown[]) => Promise<Blob> };
      };
      const render = child.__BLG.renderConfirmed.bind(child.__BLG);
      child.__BLG.renderConfirmed = async rows => {
        const blob = await render(rows);
        child.__BLG.rows[0].qty = '26';
        window.dispatchEvent(new Event('warehouse-label-change'));
        return blob;
      };
    });
    await generate(page);
    await expect(page.locator('#status')).toContainText('list changed during generation');
    await expect(page.locator('#download')).toBeDisabled();
    await expect(page.locator('#openPdf')).toBeHidden();
    await expect(editor(page).locator('#pdfFrame')).not.toHaveAttribute('src');
    await expect(editor(page).locator('#lnkPdf')).not.toHaveAttribute('href');
  });

  test('viewer can find and reprint existing parts but cannot register a new part', async ({ page }) => {
    await open(page); await page.evaluate(() => localStorage.setItem('sc.mock.role', 'viewer'));
    await page.locator('#query').fill('PEX'); await page.locator('#find').click();
    await expect(page.locator('#searchResults button').first()).toBeVisible();
    await page.locator('#searchResults button').first().click();
    const before = structuredClone(await state(page));
    await generate(page); await expect(page.locator('#status')).toContainText('PDF ready: 1');
    expect(await state(page)).toEqual(before);
    await add(page, 'LABEL-VIEWER-NEW', 'New Viewer Fitting'); await register(page);
    await expect(page.locator('#selection')).toContainText('Viewers can reprint existing parts');
    expect((await state(page)).parts.some(part => part.part_code === 'LABEL-VIEWER-NEW')).toBe(false);
  });

  test('desktop and mobile controls remain reachable without outer horizontal scrolling', async ({ page }, testInfo) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await open(page);
      await add(page, 'LABEL-LAYOUT-' + viewport.width, 'Layout fitting');
      await expect(page.locator('#register')).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.locator('#register').scrollIntoViewIfNeeded();
      await expect(page.locator('#register')).toBeInViewport();
      const overflow = await page.evaluate(() => {
        const child = document.querySelector<HTMLIFrameElement>('#generator')!.contentWindow!;
        return child.document.documentElement.scrollWidth > child.innerWidth + 1;
      });
      expect(overflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`labels-${viewport.width}.png`), fullPage: true });
    }
  });
});
