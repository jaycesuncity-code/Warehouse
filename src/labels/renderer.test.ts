import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { integratedRenderer } from './renderer';
import { inspectLabelPdf } from './pdf-check';
import type { StagedRow } from './workflow';
const source = readFileSync(new URL('../../labels/bin-label-generator.html', import.meta.url), 'utf8');
interface Renderer {
  rows: StagedRow[];
  S: Record<string, number>;
  extraColumns: string[];
  setSelection: (keys: number[]) => void;
  renderConfirmed: (rows: StagedRow[]) => Promise<Blob>;
  invalidate: () => void;
}
function editor() {
  const errors: unknown[] = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(integratedRenderer(source), {
    runScripts: 'dangerously', url: 'https://labels.test', virtualConsole: console,
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const window = dom.window;
  const bridge = (window as unknown as { __BLG: Renderer }).__BLG;
  expect(bridge, errors.map(String).join('\n')).toBeDefined();
  const bytes = (blob: Blob) => new Promise<Buffer>((resolve, reject) => {
    const reader = new window.FileReader(); reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
  return { dom, bridge, bytes };
}
const row = (index = 0): StagedRow => ({
  k: index + 1, id: 'prt-2222222' + '23456789abcdefghjkmnpqrstuvwxyz'[index], idSrc: 'reused',
  name: 'Test Tee', code: '001', qty: '99', ex: { Vendor: 'Test' }, keepInvalid: false, iss: [],
});
describe('preserved vector label renderer integration', () => {
  it('fails closed when the source integration anchors change', () => expect(() => integratedRenderer('<html></html>')).toThrow());
  it('uses the pinned official parser while keeping the historical reference unchanged', () => {
    const bytes = readFileSync(new URL('./vendor/xlsx-0.20.3.min.js.txt', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41');
    expect(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(source)}\0`), Buffer.from(source)])).digest('hex')).toBe('1d1d9fdde57a8d6674cdf8cc015593aeb4274d45');
    const { dom } = editor();
    expect((dom.window as unknown as { XLSX: { version: string } }).XLSX.version).toBe('0.20.3');
    dom.window.close();
  });
  it('renders immutable confirmed rows and decodes exact canonical IDs from the PDF vectors', async () => {
    const { dom, bridge, bytes } = editor();
    bridge.rows.push({ ...row(), name: 'Unselected' });
    await expect(bridge.renderConfirmed([{ ...row(), id: 'invented' }])).rejects.toThrow();
    const pdf = inspectLabelPdf(await bytes(await bridge.renderConfirmed([row()])));
    expect(bridge.rows[0].name).toBe('Unselected');
    expect(bridge.S.labelW).toBe(2.95); expect(bridge.S.labelH).toBe(.84);
    expect([pdf.width, pdf.height]).toEqual([612, 792]);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0].decoded).toEqual([row().id]);
    expect(pdf.pages[0].labels[0].w / 72).toBeCloseTo(2.95, 8);
    expect(-pdf.pages[0].labels[0].h / 72).toBeCloseTo(.84, 8);
    bridge.invalidate();
    expect(dom.window.document.querySelector('#pdfFrame')!.hasAttribute('src')).toBe(false);
    expect(dom.window.document.querySelector('#lnkPdf')!.hasAttribute('href')).toBe(false);
    dom.window.close();
  });
  it('honors 22 labels per Letter sheet and skips physical positions on only the first sheet', async () => {
    const { dom, bridge, bytes } = editor();
    const rows = Array.from({ length: 23 }, (_, index) => row(index)); bridge.S.skip = 2;
    const pdf = inspectLabelPdf(await bytes(await bridge.renderConfirmed(rows)));
    expect(pdf.pages).toHaveLength(2);
    expect(pdf.pages.map(page => page.labels.length)).toEqual([20, 3]);
    expect(pdf.pages.flatMap(page => page.decoded)).toEqual(rows.map(row => row.id));
    // First printable position is row two, column one; subsequent pages start at row one.
    expect(pdf.pages[0].labels[0].x).toBeCloseTo(90, 8);
    expect(pdf.pages[1].labels[0].y - pdf.pages[0].labels[0].y).toBeCloseTo((.84 + .035) * 72, 8);
    dom.window.close();
  });
  it('rejects duplicate IDs and invalid sheet geometry before producing a PDF', async () => {
    const { dom, bridge } = editor();
    await expect(bridge.renderConfirmed([row(), row()])).rejects.toThrow('Duplicate');
    bridge.S.rows = -1; await expect(bridge.renderConfirmed([row()])).rejects.toThrow('Invalid sheet');
    bridge.S.rows = 12; bridge.S.labelH = 1;
    await expect(bridge.renderConfirmed([row()])).rejects.toThrow('margins');
    dom.window.close();
  });
  it('preserves extra CSV values and treats hostile-looking cells and headers as data', () => {
    const { dom, bridge } = editor(); const document = dom.window.document;
    (document.querySelector('#pasteArea') as HTMLTextAreaElement).value = 'part_name,part_code,Vendor,Empty,__proto__\n"<img src=x onerror=alert(1)>",00123,"  ACME, Inc.  ",,test';
    (document.querySelector('#btnPaste') as HTMLButtonElement).click();
    (document.querySelector('#impAdd') as HTMLButtonElement).click();
    expect(bridge.rows[0].code).toBe('00123');
    expect(bridge.rows[0].ex.Vendor).toBe('  ACME, Inc.  ');
    expect(Object.hasOwn(bridge.rows[0].ex, 'Empty')).toBe(true);
    expect(Object.hasOwn(bridge.rows[0].ex, '__proto__')).toBe(true);
    expect(bridge.extraColumns).toEqual(['Vendor', 'Empty', '__proto__']);
    expect(document.querySelector('#grid img')).toBeNull();
    expect(Object.getPrototypeOf(bridge.rows[0].ex)).toBeNull();
    dom.window.close();
  });
  it('reports malformed quoted CSV without retaining an obsolete import mapping', () => {
    const { dom, bridge } = editor(); const document = dom.window.document;
    (document.querySelector('#pasteDelim') as HTMLSelectElement).value = 'comma';
    (document.querySelector('#pasteArea') as HTMLTextAreaElement).value = 'part_name,part_code\nTee,001';
    (document.querySelector('#btnPaste') as HTMLButtonElement).click();
    expect(document.querySelector('#impAdd')).not.toBeNull();
    (document.querySelector('#pasteArea') as HTMLTextAreaElement).value = 'part_name,part_code\n"Unclosed,001';
    (document.querySelector('#btnPaste') as HTMLButtonElement).click();
    expect(document.querySelector('#toast')!.textContent).toContain('Unclosed quote');
    expect(document.querySelector('#impAdd')).toBeNull();
    expect(bridge.rows).toHaveLength(0);
    dom.window.close();
  });
  it('shows only the selected subset in the physical sheet-position preview', () => {
    const { dom, bridge } = editor();
    bridge.rows.push(row(0), row(1), row(2)); bridge.S.skip = 2;
    bridge.setSelection([2]);
    expect(dom.window.document.querySelectorAll('#firstPage .printed')).toHaveLength(1);
    expect(dom.window.document.querySelectorAll('#firstPage .skipped')).toHaveLength(2);
    expect(dom.window.document.querySelector('#pageInfo')!.textContent).toContain('1 selected label');
    dom.window.close();
  });
});
