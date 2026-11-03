/**
 * ID format helpers (validation only). The server mints every ID; the mock mimics it in mock/mint.ts.
 * Format: prefix + "-" + 8 characters from a 31-character alphabet (no 0, 1, i, l, o).
 */
import type { IdPrefix } from './contract';

export const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const ID_BODY_LENGTH = 8;

export const ID_PREFIXES: readonly IdPrefix[] = ['prt', 'zon', 'opn', 'shf', 'slt', 'evt', 'emp', 'kit', 'eqp', 'ety', 'cus', 'ebt', 'ebl', 'rev', 'elp'];

export const ID_PATTERNS: Record<IdPrefix, RegExp> = {
  eqp: /^eqp-[2-9a-hj-km-np-z]{8}$/,
  ety: /^ety-[2-9a-hj-km-np-z]{8}$/,
  cus: /^cus-[2-9a-hj-km-np-z]{8}$/,
  ebt: /^ebt-[2-9a-hj-km-np-z]{8}$/,
  ebl: /^ebl-[2-9a-hj-km-np-z]{8}$/,
  rev: /^rev-[2-9a-hj-km-np-z]{8}$/,
  elp: /^elp-[2-9a-hj-km-np-z]{8}$/,
  emp: /^emp-[2-9a-hj-km-np-z]{8}$/,
  kit: /^kit-[2-9a-hj-km-np-z]{8}$/,
  prt: /^prt-[2-9a-hj-km-np-z]{8}$/,
  zon: /^zon-[2-9a-hj-km-np-z]{8}$/,
  opn: /^opn-[2-9a-hj-km-np-z]{8}$/,
  shf: /^shf-[2-9a-hj-km-np-z]{8}$/,
  slt: /^slt-[2-9a-hj-km-np-z]{8}$/,
  evt: /^evt-[2-9a-hj-km-np-z]{8}$/,
};

export function isId(prefix: IdPrefix, value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERNS[prefix].test(value);
}

/** True when the text is exactly a part label ID. Only these are accepted from a QR scan. */
export function isPartId(value: unknown): value is string {
  return isId('prt', value);
}
export const isEquipmentId = (v: unknown): v is string => isId('eqp', v);
export const isZoneId = (v: unknown): v is string => isId('zon', v);
export const isOpeningId = (v: unknown): v is string => isId('opn', v);
export const isShelfId = (v: unknown): v is string => isId('shf', v);
export const isSlotId = (v: unknown): v is string => isId('slt', v);
export const isEventId = (v: unknown): v is string => isId('evt', v);

/** Client-created records use a temporary id until the server answers. */
export const isTempId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('tmp-');

/** Which entity an ID belongs to, or null when it is not one of ours. */
export function idKind(value: string): IdPrefix | null {
  for (const p of ID_PREFIXES) if (ID_PATTERNS[p].test(value)) return p;
  return null;
}

export const tempId = () => 'tmp-' + crypto.randomUUID();
