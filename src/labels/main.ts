import { integratedRenderer } from './renderer';
import { MODE } from '../shared/config';
import { api } from '../shared/api';
import {
  csvFromMatrix, draftFingerprint, exportMatrix, identityFingerprint,
  resolveRows, type RowResult, type StagedRow,
} from './workflow';
import type { Part } from '../shared/contract';
import generatorSource from '../../labels/bin-label-generator.html?raw';

type SheetAPI = {
  utils: {
    book_new: () => unknown;
    book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
    aoa_to_sheet: (rows: string[][]) => unknown;
  };
  write: (book: unknown, options: { bookType: string; type: string }) => ArrayBuffer;
};
type Bridge = {
  rows: StagedRow[];
  extraColumns: string[];
  S: Record<string, unknown>;
  refresh: () => void;
  setSelection: (keys: number[]) => void;
  invalidate: () => void;
  restoreDraft: (rows: StagedRow[], columns: string[]) => void;
  renderConfirmed: (rows: StagedRow[]) => Promise<Blob>;
};
type GeneratorWindow = Window & { __BLG?: Bridge; XLSX?: SheetAPI };
const frame = document.querySelector<HTMLIFrameElement>('#generator')!;
const list = document.querySelector<HTMLDivElement>('#selection')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const searchResults = document.querySelector<HTMLDivElement>('#searchResults')!;
const selected = new Map<number, boolean>();
const results = new Map<number, RowResult & { fingerprint: string }>();
const button = (id: string) => document.querySelector<HTMLButtonElement>('#' + id)!;
const child = () => frame.contentWindow as GeneratorWindow;
const bridge = (): Bridge => {
  if (!child()?.__BLG) throw new Error('The label editor is still loading.');
  return child().__BLG!;
};
const chosen = () => bridge().rows.filter(row => selected.get(row.k) !== false);
const fingerprint = () => draftFingerprint(chosen(), bridge().S);
const draftKey = 'sc.labels.draft.v2.' + MODE;
let ready = false;
let active = false;
let restoring = false;
let output: { blob: Blob; url: string; fingerprint: string } | null = null;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let searchSequence = 0;

function message(text: string, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}
function invalidateOutput(explain = false) {
  if (output) {
    URL.revokeObjectURL(output.url);
    if (explain) message('The list, selection or sheet setup changed. Generate a new PDF before printing.');
  }
  output = null;
  button('download').disabled = true;
  const open = document.querySelector<HTMLAnchorElement>('#openPdf')!;
  open.removeAttribute('href'); open.hidden = true;
  if (ready) bridge().invalidate();
}
function checkOutput(): boolean {
  if (!output || output.fingerprint !== fingerprint()) { invalidateOutput(true); return false; }
  return true;
}
function confirmedRows(): StagedRow[] {
  return chosen().filter(row => {
    const result = results.get(row.k);
    return result?.ok && result.fingerprint === identityFingerprint(row);
  });
}
function saveDraft() {
  if (!ready || restoring) return;
  try {
    localStorage.setItem(draftKey, JSON.stringify({
      rows: bridge().rows.map(row => ({ ...row, iss: [] })),
      columns: bridge().extraColumns,
      selected: bridge().rows.map(row => selected.get(row.k) !== false),
    }));
    document.querySelector('#draftStatus')!.textContent = 'Draft saved in this browser. IDs are verified again before printing.';
  } catch {
    document.querySelector('#draftStatus')!.textContent = 'Browser storage is unavailable. Keep this page open or export your draft.';
  }
}
function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null') as unknown;
    if (!saved || typeof saved !== 'object' || !('rows' in saved) || !Array.isArray(saved.rows) || saved.rows.length > 10000) return;
    const value = saved as { rows: unknown[]; columns?: unknown; selected?: unknown };
    const rows = value.rows.map((entry, index): StagedRow => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid draft');
      const row = entry as Record<string, unknown>;
      if (['id', 'idSrc', 'name', 'code', 'qty'].some(key => typeof row[key] !== 'string')) throw new Error('Invalid draft');
      const ex = row.ex && typeof row.ex === 'object' && !Array.isArray(row.ex)
        ? Object.fromEntries(Object.entries(row.ex).filter(([, item]) => typeof item === 'string')) as Record<string, string> : {};
      return { k: index + 1, id: row.id as string, idSrc: 'supplied', name: row.name as string, code: row.code as string, qty: row.qty as string, ex, keepInvalid: false, iss: [] };
    });
    restoring = true;
    rows.forEach((row, index) => selected.set(row.k, !Array.isArray(value.selected) || value.selected[index] !== false));
    bridge().restoreDraft(rows, Array.isArray(value.columns) ? value.columns.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    message('The saved draft could not be restored. Import the original spreadsheet again.', true);
  } finally { restoring = false; }
}
function renderSelection() {
  if (!ready) return;
  const rows = bridge().rows;
  bridge().setSelection(chosen().map(row => row.k));
  const keys = new Set(rows.map(row => row.k));
  for (const key of selected.keys()) if (!keys.has(key)) selected.delete(key);
  for (const [key, result] of results) {
    const row = rows.find(row => row.k === key);
    if (!row || result.fingerprint !== identityFingerprint(row)) results.delete(key);
  }
  list.replaceChildren();
  const heading = document.createElement('p');
  heading.textContent = `${rows.length} staged · ${chosen().length} selected · ${confirmedRows().length} verified`;
  list.append(heading);
  for (const row of rows) {
    const line = document.createElement('label'); line.className = 'part-row';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = selected.get(row.k) !== false; checkbox.disabled = active;
    checkbox.setAttribute('aria-label', `Select ${row.code || 'row'} ${row.name}`);
    checkbox.addEventListener('change', () => {
      selected.set(row.k, checkbox.checked); invalidateOutput(true); renderSelection(); saveDraft();
    });
    const description = document.createElement('span');
    description.textContent = `${row.code || 'MISSING SKU'} · ${row.name || 'MISSING NAME'}${row.id ? ' · ' + row.id : ''}`;
    const badge = document.createElement('small');
    const result = results.get(row.k);
    badge.textContent = result?.message || (!row.name.trim() || !row.code.trim() ? 'SKU and name required' : row.id ? 'ID needs verification' : 'Ready to register');
    badge.dataset.error = String(result ? !result.ok : false);
    line.append(checkbox, description, badge); list.append(line);
  }
  for (const id of ['register', 'generate']) button(id).disabled = active || chosen().length === 0;
  for (const id of ['find', 'all', 'none', 'refresh']) button(id).disabled = active;
  for (const id of ['csv', 'xlsx']) button(id).disabled = active || confirmedRows().length === 0;
  button('draft').disabled = active || rows.length === 0;
  button('download').disabled = active || !output;
  document.querySelectorAll<HTMLButtonElement>('.match').forEach(item => item.disabled = active);
}
function onEditorChange() {
  if (!ready) return;
  if (!active && output && output.fingerprint !== fingerprint()) invalidateOutput(true);
  renderSelection();
  clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 150);
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function record(result: RowResult) {
  const row = bridge().rows.find(row => row.k === result.key);
  if (row) results.set(result.key, { ...result, fingerprint: identityFingerprint(row) });
}
async function run(register: boolean) {
  if (!ready || active) return;
  const rows = chosen();
  if (!rows.length) { message('Select at least one part.', true); return; }
  invalidateOutput(); active = true; frame.inert = true; renderSelection();
  try {
    message(register ? 'Registering and matching selected parts…' : 'Verifying selected IDs before making the PDF…');
    const response = await resolveRows(api, rows, { allowCreate: register, onResult: record });
    bridge().refresh();
    const passed = response.filter(result => result.ok).length;
    const failed = response.length - passed;
    if (failed) {
      message(`${passed} verified; ${failed} need attention. Successful registrations are saved. Fix or deselect problem rows and retry.`, true);
    } else if (register) {
      message(`${passed} selected part(s) verified in the database. Choose Generate labels to preview and print.`);
    } else {
      const expected = fingerprint();
      const blob = await bridge().renderConfirmed(structuredClone(rows));
      if (expected !== fingerprint()) throw new Error('The list changed during generation. Generate the PDF again.');
      output = { blob, url: URL.createObjectURL(blob), fingerprint: expected };
      const open = document.querySelector<HTMLAnchorElement>('#openPdf')!;
      open.href = output.url; open.hidden = false;
      if (navigator.pdfViewerEnabled === true) {
        open.removeAttribute('download'); open.target = '_blank'; open.textContent = 'Open / print PDF';
      } else {
        open.download = 'sun-city-bin-labels.pdf'; open.removeAttribute('target'); open.textContent = 'Download to view / print';
      }
      const settings = bridge().S;
      const pages = Math.ceil((Number(settings.skip) + rows.length) / (Number(settings.rows) * 2));
      message(`PDF ready: ${rows.length} verified label(s) on ${pages} US Letter sheet(s). Use 100% / Actual size when printing.`);
    }
  } catch (error) {
    // A renderer may have exposed its preview before a late import/edit is
    // detected. Clear both frame and parent outputs on every failed generation.
    invalidateOutput();
    message(error instanceof Error ? error.message : 'Could not complete this action. Retry when connected.', true);
  } finally {
    active = false; frame.inert = false; renderSelection(); saveDraft();
  }
}
function exportRows(xlsx: boolean, draft = false) {
  const rows = draft ? bridge().rows : confirmedRows();
  if (!rows.length) return;
  const matrix = exportMatrix(rows, bridge().extraColumns);
  if (xlsx) {
    const sheet = child().XLSX;
    if (!sheet) { message('The spreadsheet editor is still loading.', true); return; }
    const book = sheet.utils.book_new();
    sheet.utils.book_append_sheet(book, sheet.utils.aoa_to_sheet(matrix), draft ? 'Draft parts' : 'Verified parts');
    saveBlob(new Blob([sheet.write(book, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), draft ? 'warehouse-parts-draft.xlsx' : 'resolved-parts.xlsx');
  } else {
    saveBlob(new Blob([csvFromMatrix(matrix)], { type: 'text/csv;charset=utf-8' }), draft ? 'warehouse-parts-draft.csv' : 'resolved-parts.csv');
  }
}
button('register').addEventListener('click', () => void run(true));
button('generate').addEventListener('click', () => void run(false));
button('download').addEventListener('click', () => { if (checkOutput()) saveBlob(output!.blob, 'sun-city-bin-labels.pdf'); });
button('csv').addEventListener('click', () => exportRows(false));
button('xlsx').addEventListener('click', () => exportRows(true));
button('draft').addEventListener('click', () => exportRows(true, true));
for (const [id, value] of [['all', true], ['none', false]] as const) button(id).addEventListener('click', () => {
  for (const row of bridge().rows) selected.set(row.k, value);
  invalidateOutput(true); renderSelection(); saveDraft();
});
button('refresh').addEventListener('click', renderSelection);
async function find() {
  if (!ready || active) return;
  const query = document.querySelector<HTMLInputElement>('#query')!.value.trim();
  if (!query) return;
  const sequence = ++searchSequence;
  searchResults.textContent = 'Searching…';
  try {
    const matches = (await api.searchParts({ q: query, limit: 50 })).items;
    if (sequence !== searchSequence) return;
    searchResults.replaceChildren();
    for (const part of matches) {
      const match = document.createElement('button'); match.textContent = part.part_code + ' · ' + part.part_name; match.className = 'match'; match.disabled = active;
      match.addEventListener('click', () => addExisting(part)); searchResults.append(match);
    }
    if (!matches.length) searchResults.textContent = 'No existing parts found.';
  } catch (error) {
    if (sequence === searchSequence) searchResults.textContent = 'Search failed: ' + (error instanceof Error ? error.message : 'Check your connection.');
  }
}
function addExisting(part: Part) {
  if (active) return;
  const rows = bridge().rows;
  const present = rows.find(row => row.id === part.part_id);
  if (present) {
    selected.set(present.k, true); message('That part is already staged and is now selected.');
  } else {
    const key = Math.min(0, ...rows.map(row => row.k)) - 1;
    rows.push({ k: key, id: part.part_id, idSrc: 'supplied', name: part.part_name, code: part.part_code, qty: '', ex: {}, keepInvalid: false, iss: [] });
    selected.set(key, true); message('Existing part added for reprinting. Generate labels to verify its ID.');
  }
  invalidateOutput(); bridge().refresh(); renderSelection(); saveDraft();
}
button('find').addEventListener('click', () => void find());
document.querySelector('#query')!.addEventListener('keydown', event => {
  if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void find(); }
});
window.addEventListener('warehouse-label-change', onEditorChange);
window.addEventListener('warehouse-generate', () => void run(false));
window.addEventListener('warehouse-print-test', () => {
  invalidateOutput(); renderSelection();
  message('Printer test page ready. Print at 100% / Actual size and measure its 1-inch square. Generate labels again to restore the label preview and downloads.');
});
window.addEventListener('pagehide', saveDraft);
frame.onload = () => {
  try {
    bridge(); ready = true;
    restoreDraft(); renderSelection();
    const doc = child().document;
    // One document scroll, so all controls stay reachable at mobile widths.
    const resize = () => { frame.style.height = Math.max(600, doc.body.scrollHeight + 16) + 'px'; };
    new ResizeObserver(resize).observe(doc.body); resize();
    message(bridge().rows.length ? 'Draft restored. Select parts, register new records, then generate labels.' : 'Add parts in the editor, then register the selected rows. Existing parts can be reprinted directly.');
    saveDraft();
  } catch (error) { message('Label editor failed to load: ' + String(error), true); }
};
const mode = document.createElement('p');
mode.textContent = MODE === 'mock' ? 'DEMO DATA — changes stay in this browser' : 'Warehouse database';
document.querySelector('header')!.append(mode);
frame.srcdoc = integratedRenderer(generatorSource);
