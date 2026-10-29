/** Errors thrown by mock endpoints; the router turns them into the contract's error bodies. */
import type { ApiErrorBody, ErrorCode, SlotConflict } from '../contract';
import { ERROR_STATUS } from '../contract';

export class HttpError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(code: ErrorCode, message: string, extra: Partial<ApiErrorBody> = {}) {
    super(message);
    this.status = ERROR_STATUS[code];
    this.body = { error: code, message, ...extra };
  }
}

export const validation = (fields: Record<string, string>, message = 'Some values need fixing.') =>
  new HttpError('validation', message, { fields });

export const notFound = (what: string) => new HttpError('not_found', `${what} was not found.`);

export const forbidden = (message = "Your role can't do that.") => new HttpError('forbidden', message);

export const slotOccupied = (conflicts: SlotConflict[]) =>
  new HttpError('slot_occupied', 'Something is already in that spot.', { conflicts });

export const versionConflict = (current: unknown, what = 'This') =>
  new HttpError('version_conflict', `${what} was just changed by someone else.`, { current });

export const slotOutOfBounds = (message = "That doesn't fit on the shelf.") =>
  new HttpError('slot_out_of_bounds', message);

export const slotNotEmpty = (message = 'That slot still has parts in it.') =>
  new HttpError('slot_not_empty', message);

export const shelfNotEmpty = (message = 'That shelf still has parts on it.') =>
  new HttpError('shelf_not_empty', message);

export const undoStale = (message = 'That change has been overtaken by a newer one.') =>
  new HttpError('undo_stale', message);
