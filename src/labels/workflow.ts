import type { ApiClient } from '../shared/api';
import { isPartId } from '../shared/ids';
import type { Part } from '../shared/contract';

/** A local draft is never an inventory record until the API confirms its ID. */
export interface StagedRow {
  k: number;
  id: string;
  idSrc: string;
  name: string;
  code: string;
  qty: string;
  ex: Record<string, string>;
  keepInvalid: boolean;
  iss: unknown[];
}

export type RowResult = {
  key: number;
  ok: boolean;
  message: string;
  status: 'verified' | 'registered' | 'reused' | 'invalid' | 'conflict' | 'failed';
};
type Catalog = Pick<ApiClient, 'me' | 'getPart' | 'searchParts' | 'registerParts'>;
const norm = (value: string) => value.trim().toLowerCase();
export const identityFingerprint = (row: StagedRow) => JSON.stringify([row.id, row.name, row.code]);

export function draftFingerprint(rows: StagedRow[], settings: Record<string, unknown>): string {
  return JSON.stringify({
    rows: rows.map(({ k, id, name, code, qty, ex }) => ({ k, id, name, code, qty, ex })),
    settings,
  });
}

/** Bounded parallel reads avoid issuing hundreds of HTTP requests at once. */
async function each<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function lookupError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
  if (status === 404) return 'Imported ID is not in the database. Correct or clear it in the editor.';
  if (status === 401 || status === 403) return 'Your session cannot read this part. Sign in and try again.';
  return 'Database verification failed. Keep the ID and retry when connected.';
}

/**
 * Only this explicit registration action may create parts. Print/reprint calls pass
 * allowCreate=false, which uses read endpoints exclusively, including for viewers.
 * Successful rows survive partial failures; a retry reuses the server's SKU identity.
 */
export async function resolveRows(
  catalog: Catalog,
  rows: StagedRow[],
  options: { allowCreate: boolean; onResult?: (result: RowResult) => void },
): Promise<RowResult[]> {
  const me = await catalog.me();
  const results = new Map<number, RowResult>();
  const initial = new Map(rows.map(row => [row.k, identityFingerprint(row)]));
  const codes = new Map<string, number>();
  const ids = new Map<string, number>();
  for (const row of rows) {
    const code = norm(row.code);
    codes.set(code, (codes.get(code) ?? 0) + 1);
    if (row.id) ids.set(row.id, (ids.get(row.id) ?? 0) + 1);
  }
  const report = (row: StagedRow, ok: boolean, status: RowResult['status'], message: string) => {
    const value = { key: row.k, ok, status, message };
    results.set(row.k, value);
    options.onResult?.(value);
  };
  const confirm = (row: StagedRow, part: Part, status: 'verified' | 'registered' | 'reused') => {
    if (identityFingerprint(row) !== initial.get(row.k)) {
      report(row, false, 'conflict', 'This row changed during verification. Retry the current row.');
    } else if (!isPartId(part.part_id) || norm(part.part_code) !== norm(row.code) || norm(part.part_name) !== norm(row.name)) {
      report(row, false, 'conflict', 'ID, SKU or name conflicts with the database. Review the row.');
    } else {
      row.id = part.part_id;
      row.idSrc = status === 'registered' ? 'new' : 'reused';
      initial.set(row.k, identityFingerprint(row));
      report(row, true, status, status === 'registered' ? 'Registered in database' : 'Existing ID verified');
    }
  };
  const pending: StagedRow[] = [];
  const valid: StagedRow[] = [];
  for (const row of rows) {
    if (!row.code.trim() || !row.name.trim()) report(row, false, 'invalid', 'Both SKU and part name are required.');
    else if (row.code.trim().length > 150 || row.name.trim().length > 500) report(row, false, 'invalid', 'Maximum: 150 characters for SKU, 500 for name.');
    else if ((codes.get(norm(row.code)) ?? 0) > 1) report(row, false, 'conflict', 'Duplicate SKU in selected rows. Deselect or remove the duplicate.');
    else if (row.id && (ids.get(row.id) ?? 0) > 1) report(row, false, 'conflict', 'Duplicate ID in selected rows. Review the SKU and name.');
    else if (row.id && !isPartId(row.id)) report(row, false, 'invalid', 'Invalid imported ID. Correct or clear it in the editor.');
    else valid.push(row);
  }
  await each(valid, async row => {
    if (row.id) {
      try { confirm(row, await catalog.getPart(row.id), 'verified'); }
      catch (error) { report(row, false, 'failed', lookupError(error)); }
    } else if (options.allowCreate && me.role !== 'viewer') {
      pending.push(row);
    } else {
      try {
        const response = await catalog.searchParts({ q: row.code.trim(), limit: 100 });
        const part = response.items.find(part => norm(part.part_code) === norm(row.code));
        if (part) confirm(row, part, 'reused');
        else report(row, false, 'invalid', me.role === 'viewer'
          ? 'Viewers can reprint existing parts. Ask an editor to register this part.'
          : 'This part is not registered. Use Register selected, then generate labels.');
      } catch (error) { report(row, false, 'failed', lookupError(error)); }
    }
  });
  // Smaller batches also bound the number of D1 writes per request.
  for (let start = 0; start < pending.length; start += 100) {
    const batch = pending.slice(start, start + 100);
    try {
      const response = await catalog.registerParts({ rows: batch.map(row => ({ part_code: row.code.trim(), part_name: row.name.trim() })) });
      const indexes = new Map<number, number>();
      for (const item of response.results) indexes.set(item.index, (indexes.get(item.index) ?? 0) + 1);
      await each(batch, async (row) => {
        const index = batch.indexOf(row);
        const item = response.results.find(item => item.index === index);
        if (!item || indexes.get(index) !== 1) {
          report(row, false, 'failed', 'Server returned an incomplete result. Retry to match any saved part.');
        } else if (item.status === 'conflict' || !isPartId(item.part_id)) {
          report(row, false, 'conflict', item.message || 'This SKU conflicts with an existing part.');
        } else {
          try { confirm(row, await catalog.getPart(item.part_id), item.status === 'new' ? 'registered' : 'reused'); }
          catch (error) { report(row, false, 'failed', lookupError(error)); }
        }
      });
    } catch {
      for (const row of batch) report(row, false, 'failed', 'Registration was not confirmed. Retry safely to match any part already saved.');
    }
  }
  return rows.map(row => results.get(row.k)!);
}

/** Keep all extra columns, including empty imported columns and leading-zero SKUs. */
export function exportMatrix(rows: StagedRow[], extraColumns: string[] = []): string[][] {
  const columns = [...new Set([...extraColumns, ...rows.flatMap(row => Object.keys(row.ex))])];
  return [
    ['part_id', 'part_name', 'part_code', 'expected_qty', ...columns],
    ...rows.map(row => [row.id, row.name, row.code, row.qty, ...columns.map(column => row.ex[column] ?? '')]),
  ];
}

export function csvFromMatrix(matrix: string[][]): string {
  // Quoting alone does not stop Excel interpreting an imported cell as a formula.
  // XLSX exports retain exact values as typed strings; CSV uses a text prefix.
  const safe = (value: string) => /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '\uFEFF' + matrix.map(row => row.map(value => '"' + safe(value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
