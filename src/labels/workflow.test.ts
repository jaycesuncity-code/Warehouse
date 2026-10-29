import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../shared/api';
import { loadMockState, mockTransport, resetDemoData, setMockLatency, setMockRole, setMockStorage } from '../shared/mock';
import { csvFromMatrix, draftFingerprint, exportMatrix, resolveRows, type StagedRow } from './workflow';
const api = createApi(mockTransport);
const row = (key: number, code = 'LABEL-' + key, name = 'Test fitting ' + key): StagedRow => ({ k: key, id: '', idSrc: '', name, code, qty: '99', ex: {}, keepInvalid: false, iss: [] });
beforeEach(() => {
  const data = new Map<string, string>();
  setMockStorage({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } });
  resetDemoData(); setMockRole('editor'); setMockLatency(0);
});
describe('selected registration and reprinting', () => {
  it('registers only the selected rows with backend IDs and never changes stock', async () => {
    const all = [row(1), row(2)];
    const stock = structuredClone(loadMockState().stock);
    const results = await resolveRows(api, [all[1]], { allowCreate: true });
    expect(results.every(result => result.ok)).toBe(true);
    expect(all[0].id).toBe(''); expect(all[1].id).toMatch(/^prt-[2-9a-hj-km-np-z]{8}$/);
    expect(loadMockState().parts.some(part => part.part_code === 'LABEL-1')).toBe(false);
    expect(loadMockState().stock).toEqual(stock);
  });
  it('printing is read-only even for editors and never auto-registers unknown rows', async () => {
    const before = structuredClone(loadMockState());
    const registerParts = vi.fn(api.registerParts);
    const results = await resolveRows({ ...api, registerParts }, [row(1)], { allowCreate: false });
    expect(results[0]).toMatchObject({ ok: false, status: 'invalid' });
    expect(registerParts).not.toHaveBeenCalled();
    expect(loadMockState()).toEqual(before);
  });
  it('keeps partial success IDs and retries conflicts without creating duplicates', async () => {
    const existing = loadMockState().parts[0];
    const batch = [row(1), row(2, existing.part_code, 'Wrong description')];
    const first = await resolveRows(api, batch, { allowCreate: true });
    expect(first.map(result => result.ok)).toEqual([true, false]);
    const id = batch[0].id;
    batch[1].name = existing.part_name;
    const second = await resolveRows(api, batch, { allowCreate: true });
    expect(second.every(result => result.ok)).toBe(true);
    expect(batch[0].id).toBe(id); expect(batch[1].id).toBe(existing.part_id);
    expect(loadMockState().parts.filter(part => part.part_code === 'LABEL-1')).toHaveLength(1);
  });
  it('safely retries an ambiguous registration response that was lost after commit', async () => {
    const draft = [row(1)];
    const registerParts = vi.fn(async (input: Parameters<typeof api.registerParts>[0]) => {
      await api.registerParts(input); throw new Error('connection lost');
    });
    expect((await resolveRows({ ...api, registerParts }, draft, { allowCreate: true }))[0].ok).toBe(false);
    expect(draft[0].id).toBe('');
    expect((await resolveRows(api, draft, { allowCreate: true }))[0].ok).toBe(true);
    expect(loadMockState().parts.filter(part => part.part_code === 'LABEL-1')).toHaveLength(1);
  });
  it('blocks every duplicate, missing and invalid-ID row before registration', async () => {
    const rows = [row(1, 'DUP'), row(2, ' dup '), row(3, ''), { ...row(4), id: 'https://invalid.example' }];
    const registerParts = vi.fn(api.registerParts);
    expect((await resolveRows({ ...api, registerParts }, rows, { allowCreate: true })).every(result => !result.ok)).toBe(true);
    expect(registerParts).not.toHaveBeenCalled();
  });
  it('revalidates imported IDs and rejects a valid-looking ID belonging to another part', async () => {
    const existing = loadMockState().parts[0];
    const rows = [{ ...row(1), id: existing.part_id }];
    expect((await resolveRows(api, rows, { allowCreate: true }))[0]).toMatchObject({ ok: false, status: 'conflict' });
    expect(loadMockState().parts.some(part => part.part_code === 'LABEL-1')).toBe(false);
  });
  it('allows viewers to reprint by SKU but never register a new part', async () => {
    const existing = loadMockState().parts[0]; setMockRole('viewer');
    const registerParts = vi.fn(api.registerParts);
    const rows = [row(1, existing.part_code, existing.part_name), row(2)];
    expect((await resolveRows({ ...api, registerParts }, rows, { allowCreate: true })).map(result => result.ok)).toEqual([true, false]);
    expect(rows[0].id).toBe(existing.part_id); expect(registerParts).not.toHaveBeenCalled();
  });
  it('registers more than one API batch without omitting selected records', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => row(index));
    const registerParts = vi.fn(api.registerParts);
    const results = await resolveRows({ ...api, registerParts }, rows, { allowCreate: true });
    expect(registerParts.mock.calls.map(([request]) => request.rows.length)).toEqual([100, 100, 5]);
    expect(results.filter(result => result.ok)).toHaveLength(205);
    expect(new Set(rows.map(row => row.id)).size).toBe(205);
  });
  it('does not confirm a row edited while its API response was pending', async () => {
    const existing = loadMockState().parts[0];
    const draft = { ...row(1, existing.part_code, existing.part_name), id: existing.part_id };
    const getPart = async (id: string) => { const part = await api.getPart(id); draft.name = 'Changed'; return part; };
    expect((await resolveRows({ ...api, getPart }, [draft], { allowCreate: false }))[0]).toMatchObject({ ok: false, status: 'conflict' });
  });
  it('invalidates output for any selected data or setting change without depending on UI status', () => {
    const rows = [row(1)]; const settings = { skip: 0, labelW: 2.95 };
    const fingerprint = draftFingerprint(rows, settings);
    rows[0].iss.push('UI status'); expect(draftFingerprint(rows, settings)).toBe(fingerprint);
    rows[0].ex.Vendor = 'Changed'; expect(draftFingerprint(rows, settings)).not.toBe(fingerprint);
    rows[0].ex = {}; settings.skip = 1; expect(draftFingerprint(rows, settings)).not.toBe(fingerprint);
  });
  it('preserves extra columns, leading zeros, whitespace and CSV quoting in exports', () => {
    const rows = [{ ...row(1, '00123'), ex: { Vendor: '  ACME, Inc.  ', Notes: 'Line 1\n"Line 2"', Empty: '' } }];
    const matrix = exportMatrix(rows, ['Vendor', 'Notes', 'Empty', 'All blank']);
    expect(matrix[0]).toEqual(['part_id', 'part_name', 'part_code', 'expected_qty', 'Vendor', 'Notes', 'Empty', 'All blank']);
    expect(matrix[1]).toEqual(['', 'Test fitting 1', '00123', '99', '  ACME, Inc.  ', 'Line 1\n"Line 2"', '', '']);
    expect(csvFromMatrix(matrix)).toContain('"Line 1\n""Line 2"""');
  });
  it('exports formula-like cells as text and retains exact values in the XLSX matrix', () => {
    const matrix = exportMatrix([{ ...row(1), ex: { Note: '=HYPERLINK("https://example.invalid")' } }]);
    expect(matrix[1][4]).toBe('=HYPERLINK("https://example.invalid")');
    expect(csvFromMatrix(matrix)).toContain('"\'=HYPERLINK');
  });
});
