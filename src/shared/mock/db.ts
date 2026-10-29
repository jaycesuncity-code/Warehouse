// Mock data layer: state, persistence, server-style ID minting, transactions, events.
// Rule checks live in rules.ts; endpoint logic lives in endpoints.ts.

import type { EventRecord, Opening, Role, Zone } from "../contract";
import { ID_ALPHABET, type IdPrefix } from "../ids";
import {
  DEMO_LOCATIONS,
  DEMO_OPENINGS,
  DEMO_PARTS,
  DEMO_SHELVES,
  DEMO_SLOTS,
  DEMO_ZONES,
  type DemoLocation,
  type DemoPart,
  type DemoShelf,
  type DemoSlot,
} from "./demo-data";

export type ZoneRow = Zone & { active: boolean };
export type OpeningRow = Opening & { active: boolean };
export type ShelfRow = DemoShelf;
export type SlotRow = DemoSlot;
export type PartRow = DemoPart;
export type LocationRow = DemoLocation;

export type Table = "zones" | "openings" | "shelves" | "slots" | "parts" | "locations";

export interface RowChange {
  table: Table;
  key: string;
  before: any | null;
  after: any | null;
}

export interface EventRow extends EventRecord {
  rows: RowChange[];
}

export interface DB {
  zones: ZoneRow[];
  openings: OpeningRow[];
  shelves: ShelfRow[];
  slots: SlotRow[];
  parts: PartRow[];
  locations: LocationRow[];
  events: EventRow[];
  seq: number;
}

const STORAGE_KEY = "sc.mock.db.v2";
const ROLE_KEY = "sc.mock.role";

// ---------------- persistence (localStorage is optional) ----------------

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function demoDB(): DB {
  return structuredClone({
    zones: DEMO_ZONES.map((z) => ({ ...z, active: true })),
    openings: DEMO_OPENINGS.map((o) => ({ ...o, active: true })),
    shelves: DEMO_SHELVES,
    slots: DEMO_SLOTS,
    parts: DEMO_PARTS,
    locations: DEMO_LOCATIONS,
    events: [],
    seq: 1,
  });
}

let db: DB | null = null;
let persistEnabled = true;

export function getDB(): DB {
  if (db) return db;
  const s = storage();
  if (s) {
    try {
      const raw = s.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DB;
        if (parsed && Array.isArray(parsed.shelves) && Array.isArray(parsed.zones)) {
          db = parsed;
          return db;
        }
      }
    } catch {
      /* corrupt or unavailable: fall back to demo data */
    }
  }
  db = demoDB();
  return db;
}

export function setDB(next: DB): void {
  db = next;
  persist();
}

export function persist(): void {
  if (!persistEnabled || !db) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota or private mode: keep working in memory */
  }
}

/** Large generated datasets (perf tests) skip localStorage. */
export function setPersistEnabled(on: boolean): void {
  persistEnabled = on;
}

export function resetDB(): void {
  db = demoDB();
  persistEnabled = true;
  persist();
}

// ---------------- role / network simulation ----------------

let roleCache: Role | null = null;
export function getRole(): Role {
  if (roleCache) return roleCache;
  try {
    const r = storage()?.getItem(ROLE_KEY);
    if (r === "viewer" || r === "editor" || r === "admin") return (roleCache = r);
  } catch {
    /* ignore */
  }
  return (roleCache = "editor");
}

export function setRole(role: Role): void {
  roleCache = role;
  try {
    storage()?.setItem(ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

export const sim = { offline: false, latencyMs: 40 };

// ---------------- IDs (server-style minting, contract §3) ----------------

function randomBody(): string {
  const out: string[] = [];
  const buf = new Uint8Array(16);
  // Rejection sampling: 31 symbols; accept bytes < 248 (= 8 * 31) to avoid modulo bias.
  while (out.length < 8) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < 8) out.push(ID_ALPHABET[b % 31]);
    }
  }
  return out.join("");
}

export function mintId(prefix: IdPrefix, d: DB = getDB()): string {
  const exists = (id: string) => {
    switch (prefix) {
      case "prt":
        return d.parts.some((p) => p.part_id === id);
      case "shf":
        return d.shelves.some((s) => s.shelf_id === id);
      case "slt":
        return d.slots.some((s) => s.slot_id === id);
      case "zon":
        return d.zones.some((z) => z.zone_id === id);
      case "opn":
        return d.openings.some((o) => o.opening_id === id);
      case "evt":
        return d.events.some((e) => e.event_id === id);
    }
  };
  for (;;) {
    const id = `${prefix}-${randomBody()}`;
    if (!exists(id)) return id; // retry on collision
  }
}

// ---------------- rows ----------------

export function keyOf(table: Table, row: any): string {
  switch (table) {
    case "zones":
      return row.zone_id;
    case "openings":
      return row.opening_id;
    case "shelves":
      return row.shelf_id;
    case "slots":
      return row.slot_id;
    case "parts":
      return row.part_id;
    case "locations":
      return `${row.part_id}|${row.slot_id}`;
  }
}

export function findRow<T = any>(d: DB, table: Table, key: string): T | undefined {
  return (d[table] as any[]).find((r) => keyOf(table, r) === key) as T | undefined;
}

// ---------------- transactions ----------------

/** A write runs on a copy of the data; it's committed only if it finishes without throwing. */
export class Tx {
  readonly changes: RowChange[] = [];
  constructor(public readonly d: DB) {}

  get<T = any>(table: Table, key: string): T | undefined {
    return findRow<T>(this.d, table, key);
  }

  insert<T extends object>(table: Table, row: T): T {
    (this.d[table] as any[]).push(row);
    this.changes.push({ table, key: keyOf(table, row), before: null, after: structuredClone(row) });
    return row;
  }

  /** Mutates a row in place, bumps its version and records before/after. */
  update<T extends { version: number }>(table: Table, key: string, fn: (row: T) => void): T {
    const row = findRow<T>(this.d, table, key);
    if (!row) throw new Error(`missing ${table} ${key}`);
    const before = structuredClone(row);
    fn(row);
    row.version = before.version + 1;
    const existing = this.changes.find((c) => c.table === table && c.key === key);
    if (existing) existing.after = structuredClone(row);
    else this.changes.push({ table, key, before, after: structuredClone(row) });
    return row;
  }
}

export interface WriteOptions {
  action: string;
  entity: string;
  entityId: string | (() => string);
  reason?: string | null;
  by: string;
}

/** Runs `fn` atomically and records one event. Returns fn's result plus the event id. */
export function write<R>(opts: WriteOptions, fn: (tx: Tx) => R): { result: R; event_id: string | null } {
  const current = getDB();
  const { events, ...rest } = current;
  const working: DB = { ...structuredClone(rest), events };
  const tx = new Tx(working);
  const result = fn(tx);
  let event_id: string | null = null;
  if (tx.changes.length) {
    event_id = mintId("evt", working);
    const entityId = typeof opts.entityId === "function" ? opts.entityId() : opts.entityId;
    const first = tx.changes[0];
    working.events = [
      ...events,
      {
        event_id,
        at: new Date().toISOString(),
        by: opts.by,
        action: opts.action,
        entity: opts.entity,
        entity_id: entityId,
        before: tx.changes.length === 1 ? first.before : tx.changes.map((c) => ({ [c.table]: c.before })),
        after: tx.changes.length === 1 ? first.after : tx.changes.map((c) => ({ [c.table]: c.after })),
        reason: opts.reason ?? null,
        undone_by: null,
        rows: tx.changes,
      },
    ];
    working.seq = current.seq + 1;
  }
  setDB(working);
  return { result, event_id };
}
