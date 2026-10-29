// Search-first map logic (Jayce's idea #8): what level to zoom to as results narrow.
// Pure functions, unit-tested in search.test.ts.

export type SearchLevel = "idle" | "none" | "unplaced" | "floor" | "shelf" | "slot";

export interface SearchItemLike {
  part_id: string;
  part_name: string;
  part_code: string;
  category?: string | null;
  locations: { slot_id: string; shelf_id: string; location_code: string }[];
}

export interface SearchFocus {
  level: SearchLevel;
  /** Shelves that get a pulsing dot. */
  shelfIds: string[];
  /** Slots that glow. */
  slotIds: string[];
  /** Set when exactly one part matched (open its card). */
  partId: string | null;
}

/**
 * - empty query            -> idle (zoom back out)
 * - no results             -> none ("No results")
 * - results, none on map   -> unplaced (list only)
 * - matches on 2+ shelves  -> floor (dots on every shelf)
 * - all on one shelf       -> shelf (zoom to the shelf, open its front view)
 * - exactly one slot       -> slot (zoom to the slot, open the part card)
 * Locations on shelves that aren't in the layout (deleted, not loaded) are ignored.
 */
export function searchFocus(query: string, items: SearchItemLike[], liveShelfIds?: Set<string>): SearchFocus {
  if (!query.trim()) return { level: "idle", shelfIds: [], slotIds: [], partId: null };
  if (!items.length) return { level: "none", shelfIds: [], slotIds: [], partId: null };
  const shelfIds = new Set<string>();
  const slotIds = new Set<string>();
  for (const it of items)
    for (const l of it.locations) {
      if (liveShelfIds && !liveShelfIds.has(l.shelf_id)) continue;
      shelfIds.add(l.shelf_id);
      slotIds.add(l.slot_id);
    }
  const partId = items.length === 1 ? items[0].part_id : null;
  const base = { shelfIds: [...shelfIds], slotIds: [...slotIds], partId };
  if (!shelfIds.size) return { level: "unplaced", ...base };
  if (shelfIds.size > 1) return { level: "floor", ...base };
  if (slotIds.size === 1) return { level: "slot", ...base };
  return { level: "shelf", ...base };
}

export interface ResultGroup {
  zoneName: string;
  shelves: {
    shelfId: string;
    shelfName: string;
    entries: { partId: string; partName: string; partCode: string; slotId: string; locationCode: string }[];
  }[];
}

/** Results grouped by zone, then shelf (for the result list). Parts with no location go in `unplaced`. */
export function groupResults(
  items: SearchItemLike[],
  shelfInfo: Map<string, { name: string; zoneName: string }>,
): { groups: ResultGroup[]; unplaced: SearchItemLike[] } {
  const zones = new Map<string, Map<string, ResultGroup["shelves"][number]>>();
  const unplaced: SearchItemLike[] = [];
  for (const it of items) {
    const live = it.locations.filter((l) => shelfInfo.has(l.shelf_id));
    if (!live.length) {
      unplaced.push(it);
      continue;
    }
    for (const l of live) {
      const info = shelfInfo.get(l.shelf_id)!;
      if (!zones.has(info.zoneName)) zones.set(info.zoneName, new Map());
      const shelves = zones.get(info.zoneName)!;
      if (!shelves.has(l.shelf_id)) shelves.set(l.shelf_id, { shelfId: l.shelf_id, shelfName: info.name, entries: [] });
      shelves.get(l.shelf_id)!.entries.push({
        partId: it.part_id,
        partName: it.part_name,
        partCode: it.part_code,
        slotId: l.slot_id,
        locationCode: l.location_code,
      });
    }
  }
  const num = { numeric: true } as const;
  const groups = [...zones.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, num))
    .map(([zoneName, shelves]) => ({
      zoneName,
      shelves: [...shelves.values()]
        .sort((a, b) => a.shelfName.localeCompare(b.shelfName, undefined, num))
        .map((s) => ({
          ...s,
          entries: s.entries.sort((a, b) => a.locationCode.localeCompare(b.locationCode, undefined, num)),
        })),
    }));
  return { groups, unplaced };
}

/** Fetch every matching page so a match beyond the first 100 parts still influences map focus. */
export async function allSearchPages<T extends { part_id: string }>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
  current: () => boolean = () => true,
): Promise<{ items: T[]; total: number } | undefined> {
  const items = new Map<string, T>();
  let offset = 0;
  let total: number;
  do {
    const page = await fetchPage(offset);
    if (!current()) return undefined;
    total = page.total;
    for (const item of page.items) items.set(item.part_id, item);
    if (!page.items.length) break;
    offset += page.items.length;
  } while (offset < total);
  return { items: [...items.values()], total };
}
