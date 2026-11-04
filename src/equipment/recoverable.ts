/**
 * Durable per-browser retry receipt for equipment mutations. A rejected request can
 * be edited; an unknown outcome must be retried with its original key and body.
 */
export const PENDING_MUTATION_KEY = 'equipment.pending_mutation';
const LEGACY_ORDER_KEY = 'equipment.pending_order';

export type MutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface PendingMutation {
  kind: string;
  path: string;
  method: MutationMethod;
  key: string;
  body: Record<string, unknown>;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads are best-effort so the page can render with disabled browser storage.
 * Writes must fail closed before sending a mutation if retry state cannot be saved.
 */
export class EquipmentStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'EquipmentStorageError'; }
}
export const browserEquipmentStore: Store = {
  getItem(key) {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { window.sessionStorage.setItem(key, value); }
    catch { throw new EquipmentStorageError('Browser session storage is unavailable. No equipment change was submitted. Enable session storage before saving.'); }
  },
  removeItem(key) {
    try { window.sessionStorage.removeItem(key); }
    catch { throw new Error('Could not clear the equipment recovery receipt. Verify the saved change before retrying.'); }
  },
};

export class EquipmentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EquipmentApiError';
  }
}

export function failureDisposition(error: unknown): 'rejected' | 'uncertain' {
  if (error instanceof EquipmentStorageError) return 'rejected';
  if (!(error instanceof EquipmentApiError)) return 'uncertain';
  // An in-flight key collision may be a request that just committed, so keep
  // the original receipt. A key/body mismatch is a definite rejection.
  if (error.status === 409 && error.code === 'idempotency_conflict') {
    return /different request/i.test(error.message) ? 'rejected' : 'uncertain';
  }
  if ([400, 401, 403, 404, 405, 409, 410, 415, 422].includes(error.status)) return 'rejected';
  return 'uncertain';
}

function validAttempt(value: unknown): value is PendingMutation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<PendingMutation>;
  return typeof a.kind === 'string' && a.kind.length > 0 &&
    typeof a.path === 'string' && /^\/(equipment|customers|staff)(\/|$)/.test(a.path) &&
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(a.method)) &&
    typeof a.key === 'string' && /^[A-Za-z0-9._:-]{8,200}$/.test(a.key) &&
    a.body !== null && typeof a.body === 'object' && !Array.isArray(a.body);
}

export function readPendingMutation(store: Pick<Storage, 'getItem'>): PendingMutation | null {
  const current = store.getItem(PENDING_MUTATION_KEY);
  if (current) {
    try {
      const attempt: unknown = JSON.parse(current);
      if (validAttempt(attempt)) return attempt;
    } catch { /* Ignore corrupt browser cache. */ }
  }
  // Existing users may have a pending order from the previous implementation.
  const legacy = store.getItem(LEGACY_ORDER_KEY);
  if (!legacy) return null;
  try {
    const old: unknown = JSON.parse(legacy);
    if (!old || typeof old !== 'object') return null;
    const value = old as {key?: unknown; body?: unknown};
    const recovered = {kind: 'order', path: '/equipment/orders', method: 'POST' as const,
      key: value.key, body: value.body};
    return validAttempt(recovered) ? recovered : null;
  } catch { return null; }
}

export function createMutation(kind: string, path: string, method: MutationMethod,
  body: Record<string, unknown>): PendingMutation {
  return {kind, path, method, body, key: crypto.randomUUID()};
}

export async function performMutation<T>(
  store: Store,
  attempt: PendingMutation,
  send: (request: PendingMutation) => Promise<T>,
  recovery = false,
): Promise<T> {
  if (!validAttempt(attempt)) throw new Error('Invalid equipment mutation receipt.');
  // Corrupt pending state cannot be treated as an empty slot: the original
  // request might already have committed and its retry key is now unreadable.
  const raw = store.getItem(PENDING_MUTATION_KEY);
  if (raw) {
    let valid = false;
    try { valid = validAttempt(JSON.parse(raw)); } catch { /* invalid saved JSON */ }
    if (!valid) throw new EquipmentStorageError('Saved equipment recovery data is unreadable. Check existing equipment and orders before making another change.');
  }
  const legacyRaw = store.getItem(LEGACY_ORDER_KEY);
  if (legacyRaw) {
    let validLegacy = false;
    try {
      const old = JSON.parse(legacyRaw) as {key?: unknown; body?: unknown} | null;
      validLegacy = validAttempt({kind: 'order', path: '/equipment/orders', method: 'POST',
        key: old?.key, body: old?.body});
    } catch { /* invalid saved JSON */ }
    if (!validLegacy) throw new EquipmentStorageError('Saved legacy order recovery data is unreadable. Check existing orders before making another change.');
  }
  const existing = readPendingMutation(store);
  if (existing && !recovery) {
    throw new Error('A prior equipment change has an uncertain result. Recover it before another change.');
  }
  if (recovery && (!existing || JSON.stringify(existing) !== JSON.stringify(attempt))) {
    throw new Error('Recovery must use the exact original request key, route and body.');
  }
  store.setItem(PENDING_MUTATION_KEY, JSON.stringify(attempt));
  try {
    const result = await send(attempt);
    store.removeItem(LEGACY_ORDER_KEY);
    store.removeItem(PENDING_MUTATION_KEY);
    return result;
  } catch (error) {
    if (failureDisposition(error) === 'rejected') {
      store.removeItem(PENDING_MUTATION_KEY);
      store.removeItem(LEGACY_ORDER_KEY);
    }
    throw error;
  }
}
