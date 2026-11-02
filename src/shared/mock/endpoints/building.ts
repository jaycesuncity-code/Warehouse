/** Zones and openings: building geometry. Reads are open to everyone, writes are admin-only (router enforces). */
import {
  AREA_KINDS,
  type AreaKind,
  DEFAULT_DOOR_HEIGHT_IN,
  DEFAULT_OVERHEAD_HEIGHT_IN,
  type OpeningInput,
  type OpeningKind,
  type PatchOpeningRequest,
  type PatchZoneRequest,
  type Point,
  type ZoneInput,
} from '../../contract';
import { notFound, validation } from '../errors';
import { requireNumber, requireString, requireVersion } from '../rules';
import { readBoolean, readNullableText, readText } from '../input';
import type { OpeningRec, ZoneRec } from '../state';
import { ok, type Handler } from '../types';

const strip = <T extends { active: boolean }>(r: T): Omit<T, 'active'> => {
  const { active: _a, ...rest } = r;
  return rest;
};

export const listZones: Handler = (c) => ok({ items: c.state.zones.filter((z) => z.active).map(strip) });
export const listOpenings: Handler = (c) =>
  ok({ items: c.state.openings.filter((o) => o.active).map(strip) });

function readPolygon(v: unknown): Point[] {
  if (!Array.isArray(v) || v.length < 3) throw validation({ polygon_in: 'A zone needs at least 3 corners.' });
  return v.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw validation({ polygon_in: 'Each corner must be [x, y] in inches.' });
    }
    return [p[0], p[1]] as Point;
  });
}

function readOpenEdges(v: unknown, corners: number): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n) && n >= 0 && n < corners)) {
    throw validation({ open_edges: 'Edge numbers must run from 0 to the last corner.' });
  }
  return v as number[];
}

function readAreaKind(v: unknown): AreaKind | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !AREA_KINDS.includes(v as AreaKind))
    throw validation({ area_kind: `Use one of ${AREA_KINDS.join(', ')}, or leave it unset.` });
  return v as AreaKind;
}

const findZone = (c: Parameters<Handler>[0], id: string): ZoneRec => {
  const z = c.state.zones.find((x) => x.active && x.zone_id === id);
  if (!z) throw notFound('That zone');
  return z;
};

export const createZone: Handler = (c) => {
  const b: Partial<ZoneInput> = c.body ?? {};
  const polygon = readPolygon(b.polygon_in);
  const zone: ZoneRec = {
    zone_id: c.tx.mint('zon'),
    name: requireString(b.name, 'name'),
    room_no: readNullableText(b.room_no, 'room_no'),
    polygon_in: polygon,
    open_edges: readOpenEdges(b.open_edges, polygon.length),
    wall_height_in:
      b.wall_height_in == null ? null : requireNumber(b.wall_height_in, 'wall_height_in', { positive: true }),
    notes: readText(b.notes ?? '', 'notes'),
    verified: readBoolean(b.verified, 'verified'),
    version: 1,
    area_kind: readAreaKind(b.area_kind),
    active: true,
  };
  c.tx.insert('zones', zone);
  const ev = c.tx.finish('create', 'zone', zone.zone_id);
  return ok({ event_id: ev.event_id, zone: strip(zone) }, 201);
};

export const patchZone: Handler = (c) => {
  const zone = findZone(c, c.params.zone_id);
  const b: Partial<PatchZoneRequest> = c.body ?? {};
  requireVersion(b.version, zone, () => strip(zone), 'This zone');
  const next: Partial<ZoneRec> = {};
  if (b.name !== undefined) next.name = requireString(b.name, 'name');
  if (b.room_no !== undefined) next.room_no = readNullableText(b.room_no, 'room_no');
  if (b.polygon_in !== undefined) next.polygon_in = readPolygon(b.polygon_in);
  if (b.open_edges !== undefined || b.polygon_in !== undefined) {
    next.open_edges = readOpenEdges(
      b.open_edges ?? zone.open_edges,
      (next.polygon_in ?? zone.polygon_in).length,
    );
  }
  if (b.wall_height_in !== undefined)
    next.wall_height_in =
      b.wall_height_in === null
        ? null
        : requireNumber(b.wall_height_in, 'wall_height_in', { positive: true });
  if (b.notes !== undefined) next.notes = readText(b.notes, 'notes');
  if (b.verified !== undefined) next.verified = readBoolean(b.verified, 'verified');
  if (b.area_kind !== undefined) next.area_kind = readAreaKind(b.area_kind);
  c.tx.update('zones', zone, (z) => Object.assign(z, next));
  const ev = c.tx.finish('edit', 'zone', zone.zone_id);
  return ok({ event_id: ev.event_id, zone: strip(zone) });
};

const KINDS: OpeningKind[] = ['door', 'overhead', 'opening'];

function readOpening(b: Partial<OpeningInput>, partial: boolean): Partial<OpeningRec> {
  const out: Partial<OpeningRec> = {};
  if (!partial || b.kind !== undefined) {
    if (!b.kind || !KINDS.includes(b.kind)) throw validation({ kind: `Use one of ${KINDS.join(', ')}.` });
    out.kind = b.kind;
  }
  for (const k of ['x1_in', 'y1_in', 'x2_in', 'y2_in'] as const) {
    if (!partial || b[k] !== undefined) out[k] = requireNumber(b[k], k);
  }
  if (b.height_in !== undefined) out.height_in = requireNumber(b.height_in, 'height_in', { positive: true });
  if (b.tag !== undefined) out.tag = readNullableText(b.tag, 'tag');
  if (b.zone_id !== undefined) out.zone_id = readNullableText(b.zone_id, 'zone_id');
  if (b.notes !== undefined) out.notes = readText(b.notes, 'notes');
  if (b.verified !== undefined) out.verified = readBoolean(b.verified, 'verified');
  return out;
}

export const createOpening: Handler = (c) => {
  const f = readOpening(c.body ?? {}, false);
  if (f.zone_id != null && !c.state.zones.some((zone) => zone.active && zone.zone_id === f.zone_id))
    throw validation({ zone_id: 'Pick a zone that exists, or leave it unset.' });
  const opening: OpeningRec = {
    opening_id: c.tx.mint('opn'),
    kind: f.kind!,
    tag: f.tag ?? null,
    x1_in: f.x1_in!,
    y1_in: f.y1_in!,
    x2_in: f.x2_in!,
    y2_in: f.y2_in!,
    height_in: f.height_in ?? (f.kind === 'overhead' ? DEFAULT_OVERHEAD_HEIGHT_IN : DEFAULT_DOOR_HEIGHT_IN),
    zone_id: f.zone_id ?? null,
    notes: f.notes ?? '',
    verified: !!f.verified,
    version: 1,
    active: true,
  };
  c.tx.insert('openings', opening);
  const ev = c.tx.finish('create', 'opening', opening.opening_id);
  return ok({ event_id: ev.event_id, opening: strip(opening) }, 201);
};

export const patchOpening: Handler = (c) => {
  const opening = c.state.openings.find((o) => o.active && o.opening_id === c.params.opening_id);
  if (!opening) throw notFound('That opening');
  const b: Partial<PatchOpeningRequest> = c.body ?? {};
  requireVersion(b.version, opening, () => strip(opening), 'This opening');
  const next = readOpening(b, true);
  if (next.zone_id != null && !c.state.zones.some((zone) => zone.active && zone.zone_id === next.zone_id))
    throw validation({ zone_id: 'Pick a zone that exists, or leave it unset.' });
  c.tx.update('openings', opening, (o) => Object.assign(o, next));
  const ev = c.tx.finish('edit', 'opening', opening.opening_id);
  return ok({ event_id: ev.event_id, opening: strip(opening) });
};
