/**
 * Server-style rules, kept separate from the data layer and from the endpoints so the map workstream
 * can reuse and extend them: role checks, version checks, grid bounds and overlap, quantity checks.
 */
import { roleAtLeast, type Role } from '../contract';
import { findOverlaps, rectOf, withinGrid, type GridRect } from '../grid';
import { forbidden, slotOccupied, slotOutOfBounds, validation, versionConflict } from './errors';
import { slotConflict } from './format';
import type { MockState, ShelfRec, SlotRec } from './state';

export function requireRole(role: Role, needed: 'any' | 'editor' | 'admin'): void {
  if (!roleAtLeast(role, needed)) {
    throw forbidden(
      needed === 'admin'
        ? 'Only an admin can do that.'
        : `Your role (${role}) is view-only. Ask an editor to make this change.`,
    );
  }
}

/** Replace-style writes must send the version they last saw. */
export function requireVersion(
  sent: unknown,
  row: { version: number },
  current: () => unknown,
  what?: string,
): void {
  if (sent === undefined || sent === null) throw validation({ version: 'Send the version you last saw.' });
  if (typeof sent !== 'number' || !Number.isInteger(sent))
    throw validation({ version: 'Version must be a whole number.' });
  if (sent !== row.version) throw versionConflict(current(), what);
}

export function requireInt(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw validation({ [field]: 'Must be a whole number.' });
  if (opts.min !== undefined && value < opts.min)
    throw validation({ [field]: `Must be at least ${opts.min}.` });
  if (opts.max !== undefined && value > opts.max)
    throw validation({ [field]: `Must be at most ${opts.max}.` });
  return value;
}

export function requireNumber(
  value: unknown,
  field: string,
  opts: { min?: number; positive?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw validation({ [field]: 'Must be a number.' });
  if (opts.positive && value <= 0) throw validation({ [field]: 'Must be more than 0.' });
  if (opts.min !== undefined && value < opts.min)
    throw validation({ [field]: `Must be at least ${opts.min}.` });
  return value;
}

export function optionalLength(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return requireNumber(value, field, { positive: true });
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw validation({ [field]: 'Required.' });
  return value.trim();
}

/** Slots on this shelf whose cells collide with `rect` (excluding one slot, e.g. the one being resized). */
export function slotsColliding(
  s: MockState,
  shelfId: string,
  rect: GridRect,
  excludeSlotId?: string,
): SlotRec[] {
  const others = s.slots.filter((x) => x.active && x.shelf_id === shelfId);
  return findOverlaps(rect, others, excludeSlotId);
}

/** Throws 409 slot_out_of_bounds / slot_occupied when `rect` doesn't fit the shelf grid or hits another slot. */
export function assertSlotFits(s: MockState, shelf: ShelfRec, rect: GridRect, excludeSlotId?: string): void {
  if (!withinGrid(rect, shelf.cols, shelf.rows.length)) {
    throw slotOutOfBounds(`That size goes past the edge of shelf ${shelf.name}.`);
  }
  const hits = slotsColliding(s, shelf.shelf_id, rect, excludeSlotId);
  if (hits.length) throw slotOccupied(hits.map((h) => slotConflict(s, h)));
}

export { rectOf };
