import type { Layout, Shelf } from '../shared/contract';
import type { api } from './api';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reject malformed structure before replay can save any earlier items. Values remain API-validated. */
function validateSnapshot(value: unknown): asserts value is Layout {
  if (!record(value) || !Array.isArray(value.zones) || !Array.isArray(value.openings) || !Array.isArray(value.shelves))
    throw new Error("That file isn't a layout snapshot.");
  const rows = (items: unknown[], kind: string, idKey: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (!record(item) || typeof item[idKey] !== 'string' || !item[idKey].trim())
        throw new Error(`The snapshot contains an invalid ${kind} record.`);
      if (ids.has(item[idKey])) throw new Error(`The snapshot contains a duplicate ${kind} ID.`);
      ids.add(item[idKey]);
    }
  };
  rows(value.zones, 'zone', 'zone_id');
  rows(value.openings, 'opening', 'opening_id');
  rows(value.shelves, 'shelf', 'shelf_id');
  const slots: unknown[] = [];
  for (const shelf of value.shelves as Record<string, unknown>[]) {
    if (!Array.isArray(shelf.slots)) throw new Error('Every snapshot shelf must contain a slots array.');
    slots.push(...shelf.slots);
  }
  rows(slots, 'bin', 'slot_id');
}

export function parseSnapshot(text: string): Layout {
  const parsed: unknown = JSON.parse(text);
  const wrapped = record(parsed) && parsed.format === 'suncity-layout-snapshot';
  if (wrapped && parsed.format_version !== undefined && parsed.format_version !== 1)
    throw new Error('This layout snapshot version is not supported. Export it with a compatible app version.');
  const layout = wrapped ? parsed.layout : parsed;
  validateSnapshot(layout);
  return layout;
}

/** Replay geometry only. Every newly created parent receives a server ID before children are sent. */
export async function replaySnapshot(snapshot: Layout, current: Layout, client: typeof api) {
  validateSnapshot(snapshot);
  let ok = 0;
  const failed: string[] = [];
  const zoneIds = new Map<string, string>();
  const equalFields = (left: object, right: object, keys: string[]) => keys.every((key) =>
    JSON.stringify((left as Record<string, unknown>)[key] ?? null) ===
    JSON.stringify((right as Record<string, unknown>)[key] ?? null));
  const attempt = async <T>(label: string, call: () => Promise<T>): Promise<T | undefined> => {
    try {
      const value = await call();
      ok++;
      return value;
    } catch (error) {
      failed.push(`${label}: ${error instanceof Error ? error.message : 'Could not save.'}`);
      return undefined;
    }
  };
  for (const zone of snapshot.zones) {
    const { zone_id, version: _version, ...fields } = zone;
    const existing = current.zones.find((item) => item.zone_id === zone_id);
    const saved = await attempt(`zone ${zone.name}`, async () => {
      if (existing) return client.patchZone(existing.zone_id, { ...fields, version: existing.version });
      // A retry after partial success can reuse an identical saved room, without overwriting a namesake.
      const identical = current.zones.find((item) => equalFields(item, fields,
        ['name', 'room_no', 'polygon_in', 'open_edges', 'wall_height_in', 'notes', 'verified', 'area_kind']));
      return identical ?? (await client.createZone(fields)).zone;
    });
    if (saved) zoneIds.set(zone_id, saved.zone_id);
  }
  const mappedZone = (id: string | null): string | null => {
    if (id === null) return null;
    const mapped = zoneIds.get(id);
    if (mapped) return mapped;
    if (current.zones.some((zone) => zone.zone_id === id)) return id;
    throw new Error('The parent zone was not saved; fix it before retrying this item.');
  };
  for (const opening of snapshot.openings) {
    const { opening_id, version: _version, ...fields } = opening;
    await attempt(`opening ${opening.tag ?? opening_id}`, async () => {
      const values = { ...fields, zone_id: mappedZone(fields.zone_id) };
      const existing = current.openings.find((item) => item.opening_id === opening_id);
      if (!existing) {
        const identical = current.openings.find((item) => equalFields(item, values,
          ['kind', 'tag', 'x1_in', 'y1_in', 'x2_in', 'y2_in', 'height_in', 'zone_id', 'notes', 'verified']));
        if (identical) return identical;
      }
      return existing
        ? client.patchOpening(existing.opening_id, { ...values, version: existing.version })
        : client.createOpening(values);
    });
  }
  for (const shelf of snapshot.shelves) {
    const { shelf_id, version: _version, slots, zone_name: _zoneName, ...fields } = shelf;
    const saved = await attempt(`shelf ${shelf.name}`, async (): Promise<Shelf> => {
      const zone_id = mappedZone(fields.zone_id);
      if (!zone_id) throw new Error('Select a valid parent zone.');
      const values = { ...fields, zone_id, location_type: fields.location_type ?? 'primary', wall_ref: fields.wall_ref ?? null };
      const existing = current.shelves.find((item) => item.shelf_id === shelf_id);
      if (!existing) {
        const identical = current.shelves.find((item) => equalFields(item, values,
          ['name', 'zone_id', 'kind', 'x_in', 'y_in', 'rotation_deg', 'width_in', 'depth_in', 'height_in', 'cols', 'rows', 'wall_ref', 'notes', 'location_type']));
        if (identical) return client.getShelf(identical.shelf_id);
      }
      return existing
        ? client.patchShelf(existing.shelf_id, { ...values, version: existing.version })
        : client.createShelf(values);
    });
    if (!saved) continue;
    // A failed bin does not hide the outcome of the other bins in the shelf.
    for (const slot of slots) {
      await attempt(`bin ${slot.location_code || slot.slot_id}`, async () => {
        const existing = saved.slots.find((item) => item.slot_id === slot.slot_id) ?? saved.slots.find((item) =>
          equalFields(item, slot, ['slot_no', 'row_index', 'col_start', 'width_span', 'height_span', 'bin_type', 'bin_width_in', 'bin_height_in', 'bin_depth_in', 'bin_color']));
        const dimensions = {
          row_index: slot.row_index,
          col_start: slot.col_start,
          width_span: slot.width_span,
          height_span: slot.height_span,
        };
        const metadata = {
          bin_type: slot.bin_type,
          bin_width_in: slot.bin_width_in,
          bin_height_in: slot.bin_height_in,
          bin_depth_in: slot.bin_depth_in,
          bin_color: slot.bin_color,
        };
        if (!existing) return client.createSlot({ ...dimensions, ...metadata, slot_no: slot.slot_no, shelf_id: saved.shelf_id });
        let version = existing.version;
        if (Object.entries(dimensions).some(([key, value]) => existing[key as keyof typeof dimensions] !== value)) {
          const resized = await client.resizeSlot(existing.slot_id, { ...dimensions, version });
          version = resized.version;
        }
        if (Object.entries(metadata).some(([key, value]) => existing[key as keyof typeof metadata] !== value)) {
          return client.patchSlot(existing.slot_id, { ...metadata, version });
        }
        return existing;
      });
    }
  }
  return { ok, failed };
}
