/** Map view adapter over the single canonical API; never owns data or a transport. */
import { api as shared } from '../shared/api';
export { ApiError, isApiError } from '../shared/api';
export const api = {
  ...shared,
  createShelf: async (...args: Parameters<typeof shared.createShelf>) => { const r = await shared.createShelf(...args); return {...r.shelf, event_id:r.event_id}; },
  patchShelf: async (...args: Parameters<typeof shared.patchShelf>) => { const r = await shared.patchShelf(...args); return {...r.shelf, event_id:r.event_id}; },
  duplicateShelf: async (...args: Parameters<typeof shared.duplicateShelf>) => { const r = await shared.duplicateShelf(...args); return {...r.shelf, event_id:r.event_id}; },
  createSlot: async (...args: Parameters<typeof shared.createSlot>) => { const r = await shared.createSlot(...args); return {...r.slot, shelf_id:r.shelf_id, event_id:r.event_id}; },
  patchSlot: async (...args: Parameters<typeof shared.patchSlot>) => { const r = await shared.patchSlot(...args); return {...r.slot, shelf_id:r.shelf_id, event_id:r.event_id}; },
  resizeSlot: async (...args: Parameters<typeof shared.resizeSlot>) => { const r = await shared.resizeSlot(...args); return {...r.slot, shelf_id:r.shelf_id, event_id:r.event_id}; },
  patchPart: async (...args: Parameters<typeof shared.patchPart>) => { const r = await shared.patchPart(...args); return {...r.part, event_id:r.event_id}; },
  patchZone: async (...args: Parameters<typeof shared.patchZone>) => { const r = await shared.patchZone(...args); return {...r.zone, event_id:r.event_id}; },
  patchOpening: async (...args: Parameters<typeof shared.patchOpening>) => { const r = await shared.patchOpening(...args); return {...r.opening, event_id:r.event_id}; },
  adjustStock: async (...args: Parameters<typeof shared.adjustStock>) => { const r = await shared.adjustStock(...args); return {event_id:r.event_id, part: await shared.getPart(args[0].part_id), affected_shelf_ids:[r.location.shelf_id]}; },
};
