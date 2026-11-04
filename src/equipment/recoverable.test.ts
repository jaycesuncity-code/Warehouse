import { describe, expect, it, vi } from 'vitest';
import {
  EquipmentApiError, PENDING_MUTATION_KEY, createMutation, failureDisposition,
  performMutation, readPendingMutation,
} from './recoverable';

class StorageStub {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}
const form = (quantity = 1) => ({header: {customer_id: 'cus-stk22222'}, lines: [{quantity}]});
const make = (body = form()) => createMutation('order', '/equipment/orders', 'POST', body);

describe('equipment recoverable mutations', () => {
  it.each([400, 403])('clears rejected HTTP %i so corrected details can be saved', async status => {
    const store = new StorageStub();
    await expect(performMutation(store as Storage, make(), async () => {
      throw new EquipmentApiError(status, status === 400 ? 'validation' : 'forbidden', 'Rejected');
    })).rejects.toThrow('Rejected');
    expect(readPendingMutation(store)).toBeNull();
    await expect(performMutation(store as Storage, make(form(2)), async () => 'saved')).resolves.toBe('saved');
  });

  it('treats changed-body idempotency conflict as rejected and in-progress collision as uncertain', async () => {
    expect(failureDisposition(new EquipmentApiError(409, 'idempotency_conflict', 'Retry key already used for a different request.'))).toBe('rejected');
    expect(failureDisposition(new EquipmentApiError(409, 'idempotency_conflict', 'An identical request is already being processed.'))).toBe('uncertain');
    expect(failureDisposition(new EquipmentApiError(409, 'version_conflict', 'Record changed.'))).toBe('rejected');
  });

  it('retains the original receipt after a network failure before the save and recovers', async () => {
    const store = new StorageStub();
    const attempt = make();
    await expect(performMutation(store as Storage, attempt, async () => {
      throw new TypeError('Failed to fetch');
    })).rejects.toThrow('Failed to fetch');
    expect(readPendingMutation(store)).toEqual(attempt);
    const sent = vi.fn(async () => ({batch_id: 'ebt-12345678'}));
    await performMutation(store as Storage, attempt, sent, true);
    expect(sent).toHaveBeenCalledWith(attempt);
    expect(readPendingMutation(store)).toBeNull();
  });

  it('replays after a lost successful response without creating another order', async () => {
    const store = new StorageStub();
    const saved = new Map<string, string>();
    const attempt = make();
    const send = vi.fn(async (a: typeof attempt) => {
      if (!saved.has(a.key)) saved.set(a.key, 'ebt-12345678');
      if (send.mock.calls.length === 1) throw new TypeError('Response lost after commit');
      return {batch_id: saved.get(a.key)};
    });
    await expect(performMutation(store as Storage, attempt, send)).rejects.toThrow();
    await expect(performMutation(store as Storage, attempt, send, true)).resolves.toEqual({batch_id: 'ebt-12345678'});
    expect(saved.size).toBe(1);
    expect(send.mock.calls[0][0].body).toEqual(send.mock.calls[1][0].body);
    expect(send.mock.calls[0][0].key).toBe(send.mock.calls[1][0].key);
  });

  it('blocks a new request when a pending recovery receipt is corrupted', async () => {
    const store = new StorageStub();
    store.setItem(PENDING_MUTATION_KEY, '{unreadable');
    const send = vi.fn(async () => ({ok: true}));
    await expect(performMutation(store as Storage, make(), send)).rejects.toThrow('unreadable');
    expect(send).not.toHaveBeenCalled();
    expect(store.getItem(PENDING_MUTATION_KEY)).toBe('{unreadable');
  });

  it('blocks a new request when an old pending-order receipt is corrupted', async () => {
    const store = new StorageStub();
    store.setItem('equipment.pending_order', 'not-json');
    const send = vi.fn(async () => ({ok: true}));
    await expect(performMutation(store as Storage, make(), send)).rejects.toThrow('legacy order recovery data is unreadable');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send a mutation when browser storage cannot persist the retry key', async () => {
    const send = vi.fn(async () => ({ok: true}));
    const store = {
      getItem: () => null,
      setItem: () => { throw new Error('Storage blocked'); },
      removeItem: () => undefined,
    };
    await expect(performMutation(store, make(), send)).rejects.toThrow('Storage blocked');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a second submission while an uncertain receipt exists', async () => {
    const store = new StorageStub();
    const original = make();
    await expect(performMutation(store as Storage, original, async () => { throw new Error('timeout'); })).rejects.toThrow();
    const send = vi.fn(async () => ({ok: true}));
    await expect(performMutation(store as Storage, make(form(2)), send)).rejects.toThrow('Recover it');
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers a pending order after reload with its unchanged request key and body', async () => {
    const store = new StorageStub();
    const original = make();
    store.setItem(PENDING_MUTATION_KEY, JSON.stringify(original));
    const fromReload = readPendingMutation(store)!;
    expect(fromReload).toEqual(original);
    await expect(performMutation(store as Storage, {...fromReload, body: form(2)}, async () => ({}), true))
      .rejects.toThrow('exact original');
    await performMutation(store as Storage, fromReload, async request => {
      expect(request.key).toBe(original.key);
      expect(request.body).toEqual(original.body);
      return {batch_id: 'ebt-12345678'};
    }, true);
  });

  it('recovers old equipment.pending_order sessions without changing the idempotency key', () => {
    const store = new StorageStub();
    store.setItem('equipment.pending_order', JSON.stringify({key: 'legacy-order-001', body: form()}));
    expect(readPendingMutation(store)).toEqual({
      kind: 'order', path: '/equipment/orders', method: 'POST', key: 'legacy-order-001', body: form(),
    });
  });
});

describe('double-click protection', () => {
 it('does not dispatch a second unit-creating request while the first is in flight',async()=>{
  const store=new StorageStub();
  const attempt=make();
  let finish!: (result: string) => void;
  const send=vi.fn(() => new Promise<string>(resolve=>{finish=resolve;}));
  const first=performMutation(store as Storage,attempt,send);
  const second=performMutation(store as Storage,make(form(2)),send);
  await expect(second).rejects.toThrow('Recover it');
  expect(send).toHaveBeenCalledTimes(1);
  finish('saved');
  await expect(first).resolves.toBe('saved');
  expect(readPendingMutation(store)).toBeNull();
 });
});
