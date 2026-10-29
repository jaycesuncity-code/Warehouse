/**
 * A write transaction over a cloned state. Handlers mutate rows through update()/insert() so that
 *  - every touched row gets a "before" snapshot and a bumped `version`,
 *  - finish() records one event with before/after snapshots (used by undo),
 *  - if the handler throws, the clone is simply dropped: nothing is committed (atomic, like db.batch()).
 */
import type { ApiEvent, Role } from '../contract';
import { assertInventoryIntegrity } from './integrity';
import { mintId } from './mint';
import type { MockState } from './state';

export type Table = 'zones' | 'openings' | 'shelves' | 'slots' | 'parts' | 'stock' | 'employees' | 'packouts';

type AnyRow = { version: number; active?: boolean } & Record<string, unknown>;

export const rowKey = (table: Table, rowIn: object): string => {
  const row = rowIn as Record<string, unknown>;
  switch (table) {
    case 'employees':
      return `employees:${row.employee_id}`;
    case 'packouts':
      return `packouts:${row.kit_id}`;
    case 'zones':
      return `zones:${row.zone_id}`;
    case 'openings':
      return `openings:${row.opening_id}`;
    case 'shelves':
      return `shelves:${row.shelf_id}`;
    case 'slots':
      return `slots:${row.slot_id}`;
    case 'parts':
      return `parts:${row.part_id}`;
    case 'stock':
      return `stock:${row.part_id}|${row.slot_id}`;
  }
};

export interface RequestCtx {
  role: Role;
  email: string;
  name: string;
}

export const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export class Tx {
  readonly state: MockState;
  private before = new Map<string, unknown>();
  private touched: { table: Table; key: string }[] = [];

  constructor(
    base: MockState,
    readonly ctx: RequestCtx,
  ) {
    this.state = structuredClone(base);
  }

  private track(table: Table, key: string): void {
    if (!this.touched.some((t) => t.key === key)) this.touched.push({ table, key });
  }

  /** Change an existing row. Snapshots it once, runs the mutation, bumps its version. */
  update<R extends object>(table: Table, row: R, mutate: (r: R) => void): R {
    const key = rowKey(table, row);
    if (!this.before.has(key)) this.before.set(key, structuredClone(row));
    mutate(row);
    (row as unknown as AnyRow).version += 1;
    this.track(table, key);
    return row;
  }

  /** Add a brand-new row ("before" = nothing). */
  insert<R extends object>(table: Table, row: R): R {
    const key = rowKey(table, row);
    if (!this.before.has(key)) this.before.set(key, null);
    (this.state[table] as unknown as R[]).push(row);
    this.track(table, key);
    return row;
  }

  mint(prefix: Parameters<typeof mintId>[0]): string {
    const s = this.state;
    const taken = new Set<string>([
      ...s.employees.map((r) => r.employee_id),
      ...s.packouts.map((r) => r.kit_id),
      ...s.zones.map((r) => r.zone_id),
      ...s.openings.map((r) => r.opening_id),
      ...s.shelves.map((r) => r.shelf_id),
      ...s.slots.map((r) => r.slot_id),
      ...s.parts.map((r) => r.part_id),
      ...s.events.map((r) => r.event_id),
    ]);
    return mintId(prefix, taken);
  }

  get touchedCount(): number {
    return this.touched.length;
  }

  private lookupRow(key: string): unknown {
    const idx = key.indexOf(':');
    const table = key.slice(0, idx) as Table;
    const id = key.slice(idx + 1);
    const rows = this.state[table] as unknown as object[];
    return rows.find((r) => rowKey(table, r) === `${table}:${id}`) ?? null;
  }

  /** Record the event for everything touched so far and return it. */
  finish(action: string, entity: string, entityId: string, reason?: string | null): ApiEvent {
    assertInventoryIntegrity(this.state);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const t of this.touched) {
      before[t.key] = this.before.get(t.key) ?? null;
      after[t.key] = structuredClone(this.lookupRow(t.key));
    }
    const event: ApiEvent = {
      event_id: this.mint('evt'),
      at: isoNow(),
      by: this.ctx.email,
      action,
      entity,
      entity_id: entityId,
      before,
      after,
      reason: reason ?? null,
      undone_by: null,
    };
    this.state.events.push(event);
    this.state.seq += 1;
    this.state.updated_at = event.at;
    return event;
  }
}
