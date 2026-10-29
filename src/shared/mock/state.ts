/**
 * Mock data layer: the in-browser "database". Pure data and persistence, no business rules
 * (those live in rules.ts and the endpoint functions).
 *
 * State persists in localStorage (wrapped in try/catch: the app works without it, state then lives in memory
 * for the page). Every request re-reads storage, so two tabs stay in step.
 */
import type { ApiEvent, Opening, Zone } from '../contract';
import { DEMO_DATA, type DemoPart, type DemoShelf, type DemoSlot, type DemoStock } from './demo-data';

export type ZoneRec = Zone & { active: boolean };
export type OpeningRec = Opening & { active: boolean };
export type ShelfRec = DemoShelf & { active: boolean };
export type SlotRec = DemoSlot & { active: boolean };
export type PartRec = DemoPart;
export type StockRec = DemoStock & { active: boolean };

export interface MockState {
  schema: 1;
  zones: ZoneRec[];
  openings: OpeningRec[];
  shelves: ShelfRec[];
  slots: SlotRec[];
  parts: PartRec[];
  stock: StockRec[];
  events: ApiEvent[];
  /** Bumps on every committed write; part of layout_version. */
  seq: number;
  /** Time of the last committed write (ISO). */
  updated_at: string;
}

export const STATE_KEY = 'sc.mock.state.v1';
export const MAX_EVENTS = 400;

export function freshState(): MockState {
  const d = structuredClone(DEMO_DATA);
  return {
    schema: 1,
    zones: d.zones.map((z) => ({ ...z, active: true })),
    openings: d.openings.map((o) => ({ ...o, active: true })),
    shelves: d.shelves.map((s) => ({ ...s, active: true })),
    slots: d.slots.map((s) => ({ ...s, active: true })),
    parts: d.parts,
    stock: d.stock.map((s) => ({ ...s, active: true })),
    events: [],
    seq: 1,
    updated_at: '2026-10-28T12:00:00Z',
  };
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function detectStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__sc_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* blocked or unavailable: fall back to memory */
  }
  return memoryStorage();
}

let storage: StorageLike = detectStorage();
let lastRaw: string | null = null;
let lastParsed: MockState | null = null;

/** Tests (or callers without localStorage) can swap the storage; resets the cache. */
export function setMockStorage(s: StorageLike | null): void {
  storage = s ?? detectStorage();
  lastRaw = null;
  lastParsed = null;
}

function writeRaw(raw: string): void {
  try {
    storage.setItem(STATE_KEY, raw);
  } catch {
    // Quota exceeded or blocked: keep working from memory for this page.
  }
  lastRaw = raw;
}

/** Read the current state. Treat the result as read-only; writers clone it first (see tx.ts). */
export function loadState(): MockState {
  let raw: string | null;
  try {
    raw = storage.getItem(STATE_KEY);
  } catch {
    raw = null;
  }
  if (raw && raw === lastRaw && lastParsed) return lastParsed;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed && parsed.schema === 1 && Array.isArray(parsed.stock)) {
        lastRaw = raw;
        lastParsed = parsed;
        return parsed;
      }
    } catch {
      /* corrupt: start over */
    }
  }
  // Nothing usable stored: keep memory copy if we have one (storage blocked), otherwise seed.
  if (lastParsed && !raw) return lastParsed;
  const fresh = freshState();
  commitState(fresh);
  return fresh;
}

export function commitState(next: MockState): void {
  if (next.events.length > MAX_EVENTS) next.events = next.events.slice(next.events.length - MAX_EVENTS);
  lastParsed = next;
  writeRaw(JSON.stringify(next));
}

/** "Reset demo data": back to the dataset in demo-data.ts. */
export function resetState(): MockState {
  const fresh = freshState();
  lastParsed = null;
  lastRaw = null;
  try {
    storage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
  commitState(fresh);
  return fresh;
}
