// Mock endpoints — one function per contract §7 endpoint. Each enforces the real rules:
// roles, versions, no overlapping slots, no negative quantity, events + undo.

import type {
  ErrorBody,
  LocationMove,
  Me,
  OpeningCreate,
  OpeningPatch,
  PartCreate,
  PartPatch,
  RegisterRow,
  Role,
  Row,
  ShelfCreate,
  ShelfPatch,
  SlotConflict,
  SlotCreate,
  SlotPatch,
  SlotResize,
  StockAdjust,
  ZoneCreate,
  ZonePatch,
} from "../contract";
import { isPartId } from "../ids";
import { round16 } from "../units";
import {
  findRow,
  getDB,
  getRole,
  keyOf,
  mintId,
  setDB,
  write,
  type DB,
  type EventRow,
  type LocationRow,
  type OpeningRow,
  type PartRow,
  type ShelfRow,
  type SlotRow,
  type Tx,
  type ZoneRow,
} from "./db";
import { anchoredResize, nextShelfName, overlappingSlots, rowsProblem, slotBoundsProblem } from "./rules";
import { activeLocationsForSlot, layoutView, partView, shelfView, slotCode, slotView } from "./views";

// ---------------- plumbing ----------------

export class MockHttpError extends Error {
  constructor(
    public status: number,
    public body: ErrorBody,
  ) {
    super(body.message);
  }
}

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  headers: Record<string, string>;
}

export interface Res {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function me(): Me {
  const role = getRole();
  const names: Record<Role, string> = { viewer: "Demo Viewer", editor: "Warehouse Manager (demo)", admin: "Admin (demo)" };
  return { email: `${role}@suncity.demo`, name: names[role], role };
}

function need(role: Role) {
  if (RANK[getRole()] < RANK[role])
    throw new MockHttpError(403, { error: "forbidden", message: `You need the ${role} role to do that.` });
}

function bad(message: string, fields?: Record<string, string>): never {
  throw new MockHttpError(400, { error: "validation", message, fields });
}

function notFound(what: string): never {
  throw new MockHttpError(404, { error: "not_found", message: `${what} not found.` });
}

function conflictVersion(current: unknown): never {
  throw new MockHttpError(409, {
    error: "version_conflict",
    message: "Someone else changed this since you loaded it.",
    current,
  });
}

function checkVersion(rowVersion: number, sent: unknown, current: () => unknown) {
  if (typeof sent !== "number") bad("version is required", { version: "Send the version you last saw" });
  if (sent !== rowVersion) conflictVersion(current());
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const len = (x: unknown) => (isNum(x) ? round16(x) : x);
const lenOrNull = (x: unknown) => (x == null ? null : isNum(x) ? round16(x) : bad("Lengths must be numbers in inches"));

function requirePositive(fields: Record<string, unknown>) {
  const errs: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (!isNum(v) || v <= 0) errs[k] = "Must be a number above 0";
  if (Object.keys(errs).length) bad("Some values are missing or invalid", errs);
}

function activeShelf(d: DB, id: string): ShelfRow {
  const s = d.shelves.find((x) => x.shelf_id === id && x.active);
  if (!s) notFound("Shelf");
  return s;
}

function activeSlot(d: DB, id: string): SlotRow {
  const s = d.slots.find((x) => x.slot_id === id && x.active);
  if (!s) notFound("Slot");
  return s;
}

function activePart(d: DB, id: string): PartRow {
  const p = d.parts.find((x) => x.part_id === id && x.active);
  if (!p) notFound("Part");
  return p;
}

function shelfSlots(d: DB, shelfId: string): SlotRow[] {
  return d.slots.filter((s) => s.active && s.shelf_id === shelfId);
}

function slotConflicts(d: DB, shelf: ShelfRow, overlapping: SlotRow[]): SlotConflict[] {
  return overlapping.map((o) => ({
    slot_id: o.slot_id,
    location_code: slotCode(shelf, o),
    parts: activeLocationsForSlot(d, o.slot_id).map((l) => ({
      part_id: l.part_id,
      part_name: d.parts.find((p) => p.part_id === l.part_id)?.part_name ?? l.part_id,
      on_hand_qty: l.on_hand_qty,
    })),
  }));
}

const by = () => me().email;

// ---------------- me / layout ----------------

export function getMe(): Res {
  return { body: me() };
}

export function getLayout(ctx: Ctx): Res {
  const d = getDB();
  const etag = `"layout-${d.seq}"`;
  if (ctx.headers["if-none-match"] === etag) return { status: 304, body: null, headers: { etag } };
  return { body: layoutView(d), headers: { etag } };
}

// ---------------- parts ----------------

export function getPart(ctx: Ctx): Res {
  const d = getDB();
  const p = d.parts.find((x) => x.part_id === ctx.params.part_id && x.active);
  if (!p) notFound("Part");
  return { body: partView(d, p) };
}

export function searchParts(ctx: Ctx): Res {
  const d = getDB();
  const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
  const category = ctx.query.get("category");
  const unassigned = ctx.query.get("unassigned") === "true" || ctx.query.get("unassigned") === "1"; // ADDITION (C)
  const limit = Math.min(Math.max(parseInt(ctx.query.get("limit") ?? "50", 10) || 50, 1), 1000);
  const offset = Math.max(parseInt(ctx.query.get("offset") ?? "0", 10) || 0, 0);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { p: PartRow; score: number }[] = [];
  for (const p of d.parts) {
    if (!p.active) continue;
    if (category && p.category !== category) continue;
    const hay = [p.part_name, p.part_code, p.category, p.description, p.department, p.part_id, ...(p.aliases ?? [])]
      .join(" ")
      .toLowerCase();
    if (tokens.length && !tokens.every((t) => hay.includes(t))) continue;
    let score = 0;
    const code = p.part_code.toLowerCase();
    if (q && (code === q || p.part_id === q)) score += 100;
    else if (q && code.startsWith(q)) score += 50;
    if (q && p.part_name.toLowerCase().includes(q)) score += 20;
    if (q && p.category.toLowerCase() === q) score += 10;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.part_name.localeCompare(b.p.part_name));
  let items = scored.map((s) => partView(d, s.p));
  if (unassigned) items = items.filter((i) => i.locations.length === 0);
  return { body: { items: items.slice(offset, offset + limit), total: items.length } };
}

export function createPart(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as PartCreate;
  if (!b?.part_code?.trim() || !b?.part_name?.trim())
    bad("Part code and name are required", { part_code: "Required", part_name: "Required" });
  const d = getDB();
  if (d.parts.some((p) => p.active && p.part_code.toLowerCase() === b.part_code.trim().toLowerCase()))
    bad("That part code is already used", { part_code: "Already used" });
  const part_id = mintId("prt");
  const { result, event_id } = write({ action: "create", entity: "part", entityId: part_id, by: by() }, (tx) =>
    tx.insert<PartRow>("parts", {
      part_id,
      part_code: b.part_code.trim(),
      part_name: b.part_name.trim(),
      category: b.category ?? "",
      description: b.description ?? "",
      department: b.department ?? "",
      unit: b.unit ?? "each",
      cost: b.cost ?? null,
      sale_price: b.sale_price ?? null,
      reorder_point: b.reorder_point ?? null,
      width_in: lenOrNull(b.width_in),
      height_in: lenOrNull(b.height_in),
      depth_in: lenOrNull(b.depth_in),
      weight_lb: b.weight_lb ?? null,
      active: true,
      version: 1,
      aliases: [],
    }),
  );
  return { status: 201, body: { ...partView(getDB(), result), event_id } };
}

export function patchPart(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const p = activePart(d, ctx.params.part_id);
  const b = ctx.body as PartPatch;
  checkVersion(p.version, b?.version, () => partView(d, p));
  const allowed = ["part_code", "part_name", "category", "description", "department", "unit", "cost", "sale_price", "reorder_point", "width_in", "height_in", "depth_in", "weight_lb"] as const;
  for (const k of ["width_in", "height_in", "depth_in"] as const) {
    if (k in b && b[k] != null && (!isNum(b[k]) || (b[k] as number) <= 0)) bad("Dimensions must be above 0", { [k]: "Must be above 0" });
  }
  const { event_id } = write({ action: "update", entity: "part", entityId: p.part_id, by: by() }, (tx) =>
    tx.update<PartRow>("parts", p.part_id, (row) => {
      for (const k of allowed) if (k in b) (row as any)[k] = k.endsWith("_in") ? lenOrNull((b as any)[k]) : (b as any)[k];
    }),
  );
  return { body: { ...partView(getDB(), findRow<PartRow>(getDB(), "parts", p.part_id)!), event_id } };
}

export function registerParts(ctx: Ctx): Res {
  need("editor");
  const rows = (ctx.body?.rows ?? ctx.body) as RegisterRow[];
  if (!Array.isArray(rows)) bad("Send { rows: [...] }");
  const out: { part_code: string; part_id: string | null; status: "reused" | "new" | "conflict"; message?: string }[] = [];
  const { event_id } = write({ action: "register", entity: "part", entityId: "batch", by: by() }, (tx) => {
    for (const r of rows) {
      const existing = tx.d.parts.find((p) => p.active && p.part_code.toLowerCase() === String(r.part_code).trim().toLowerCase());
      if (existing) {
        if (r.part_id && r.part_id !== existing.part_id) {
          out.push({ part_code: r.part_code, part_id: existing.part_id, status: "conflict", message: "Code already belongs to another ID" });
        } else out.push({ part_code: r.part_code, part_id: existing.part_id, status: "reused" });
        continue;
      }
      if (r.part_id && tx.d.parts.some((p) => p.part_id === r.part_id)) {
        out.push({ part_code: r.part_code, part_id: null, status: "conflict", message: "ID already used by another code" });
        continue;
      }
      const part_id = r.part_id && isPartId(r.part_id) ? r.part_id : mintId("prt", tx.d);
      tx.insert<PartRow>("parts", {
        part_id, part_code: String(r.part_code).trim(), part_name: String(r.part_name ?? "").trim(), category: r.category ?? "",
        description: "", department: "", unit: "each", cost: null, sale_price: null, reorder_point: null,
        width_in: null, height_in: null, depth_in: null, weight_lb: null, active: true, version: 1, aliases: [],
      });
      out.push({ part_code: r.part_code, part_id, status: "new" });
    }
  });
  return { body: { rows: out, event_id } };
}

// ---------------- stock ----------------

export function adjustStock(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as StockAdjust;
  const d = getDB();
  activePart(d, b?.part_id);
  activeSlot(d, b?.slot_id);
  const key = `${b.part_id}|${b.slot_id}`;
  const loc = d.locations.find((l) => l.active && keyOf("locations", l) === key);
  if (!loc) notFound("That part isn't in that slot");
  let next: number;
  if (isNum(b.set)) {
    checkVersion(loc.version, b.version, () => partView(d, activePart(d, b.part_id)).locations.find((l) => l.slot_id === b.slot_id));
    if (!Number.isInteger(b.set) || b.set < 0) bad("A count must be a whole number, 0 or more", { set: "0 or more" });
    next = b.set;
  } else if (isNum(b.delta)) {
    if (!Number.isInteger(b.delta)) bad("Change must be a whole number", { delta: "Whole number" });
    next = loc.on_hand_qty + b.delta;
    if (next < 0) bad(`Only ${loc.on_hand_qty} on hand; it can't go below 0.`, { delta: "Would go below 0" });
  } else bad("Send delta or set");
  const { event_id } = write({ action: isNum(b.set) ? "count" : "adjust", entity: "location", entityId: key, reason: b.reason, by: by() }, (tx) =>
    tx.update<LocationRow>("locations", key, (row) => {
      row.on_hand_qty = next;
      if (isNum(b.set)) {
        row.counted_at = new Date().toISOString();
        row.counted_by = by();
      }
    }),
  );
  const dd = getDB();
  const shelfId = activeSlot(dd, b.slot_id).shelf_id;
  return { body: { part: partView(dd, activePart(dd, b.part_id)), event_id, affected_shelf_ids: [shelfId] } };
}

// ---------------- locations ----------------

function upsertLocation(tx: Tx, part_id: string, slot_id: string, par_qty: number, on_hand_qty: number) {
  const key = `${part_id}|${slot_id}`;
  const existing = tx.get<LocationRow>("locations", key);
  if (existing) {
    tx.update<LocationRow>("locations", key, (r) => {
      r.active = true;
      r.par_qty = par_qty;
      r.on_hand_qty = on_hand_qty;
    });
  } else {
    tx.insert<LocationRow>("locations", { part_id, slot_id, par_qty, on_hand_qty, counted_at: null, counted_by: null, version: 1, active: true });
  }
}

function deactivateLocation(tx: Tx, part_id: string, slot_id: string) {
  tx.update<LocationRow>("locations", `${part_id}|${slot_id}`, (r) => {
    r.active = false;
  });
}

export function moveLocation(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as LocationMove;
  const d = getDB();
  const part = activePart(d, b?.part_id);
  const to = activeSlot(d, b?.to_slot_id);
  const toShelf = activeShelf(d, to.shelf_id);
  const mode = b.mode;
  if (!["move", "add", "swap", "share"].includes(mode)) bad("mode must be move, add, swap or share", { mode: "Invalid" });
  const from = b.from_slot_id ? activeSlot(d, b.from_slot_id) : null;
  const fromLoc = from ? d.locations.find((l) => l.active && l.part_id === part.part_id && l.slot_id === from.slot_id) : undefined;
  if (from && !fromLoc) bad("That part isn't in the slot it's being moved from", { from_slot_id: "Not there" });
  if ((mode === "move" || mode === "swap") && !from) bad(`${mode} needs from_slot_id`, { from_slot_id: "Required" });
  if (from && from.slot_id === to.slot_id) bad("That's the same slot", { to_slot_id: "Same as from" });
  const already = d.locations.find((l) => l.active && l.part_id === part.part_id && l.slot_id === to.slot_id);
  if (already) bad("That part is already in that slot", { to_slot_id: "Already there" });
  const occupants = activeLocationsForSlot(d, to.slot_id).filter((l) => l.part_id !== part.part_id);
  if (occupants.length && (mode === "move" || mode === "add")) {
    throw new MockHttpError(409, {
      error: "slot_occupied",
      message: "Something's already in that slot.",
      conflicts: slotConflicts(d, toShelf, [to]),
    });
  }
  for (const k of ["par_qty", "on_hand_qty"] as const) {
    if (b[k] != null && (!Number.isInteger(b[k]) || (b[k] as number) < 0)) bad("Quantities must be whole numbers, 0 or more", { [k]: "0 or more" });
  }
  const par = b.par_qty ?? fromLoc?.par_qty ?? 0;
  const onHand = b.on_hand_qty ?? fromLoc?.on_hand_qty ?? 0;

  const affected = new Set<string>([to.shelf_id]);
  if (from) affected.add(from.shelf_id);
  const { event_id } = write(
    { action: mode, entity: "location", entityId: `${part.part_id}|${to.slot_id}`, by: by() },
    (tx) => {
      if (mode === "swap" && from) {
        for (const o of occupants) {
          const already2 = tx.d.locations.find((l) => l.active && l.part_id === o.part_id && l.slot_id === from.slot_id);
          if (already2) bad(`${o.part_id} is already in the other slot; swap would duplicate it`);
          deactivateLocation(tx, o.part_id, to.slot_id);
          upsertLocation(tx, o.part_id, from.slot_id, o.par_qty, o.on_hand_qty);
        }
      }
      if (from && mode !== "add") deactivateLocation(tx, part.part_id, from.slot_id);
      upsertLocation(tx, part.part_id, to.slot_id, par, onHand);
    },
  );
  const dd = getDB();
  return { body: { part: partView(dd, activePart(dd, part.part_id)), event_id, affected_shelf_ids: [...affected] } };
}

export function deleteLocation(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as { part_id: string; slot_id: string };
  const d = getDB();
  const loc = d.locations.find((l) => l.active && l.part_id === b?.part_id && l.slot_id === b?.slot_id);
  if (!loc) notFound("That part isn't in that slot");
  const shelfId = activeSlot(d, b.slot_id).shelf_id;
  const { event_id } = write({ action: "remove", entity: "location", entityId: `${b.part_id}|${b.slot_id}`, by: by() }, (tx) =>
    deactivateLocation(tx, b.part_id, b.slot_id),
  );
  const dd = getDB();
  return { body: { ok: true, part: partView(dd, activePart(dd, b.part_id)), event_id, affected_shelf_ids: [shelfId] } };
}

/** ADDITION (C): PATCH /api/locations { part_id, slot_id, par_qty, version } — edit par only. */
export function patchLocation(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as { part_id: string; slot_id: string; par_qty: number; version: number };
  const d = getDB();
  const key = `${b?.part_id}|${b?.slot_id}`;
  const loc = d.locations.find((l) => l.active && keyOf("locations", l) === key);
  if (!loc) notFound("That part isn't in that slot");
  checkVersion(loc.version, b.version, () => partView(d, activePart(d, b.part_id)).locations.find((l) => l.slot_id === b.slot_id));
  if (!Number.isInteger(b.par_qty) || b.par_qty < 0) bad("Par must be a whole number, 0 or more", { par_qty: "0 or more" });
  const { event_id } = write({ action: "set_par", entity: "location", entityId: key, by: by() }, (tx) =>
    tx.update<LocationRow>("locations", key, (row) => {
      row.par_qty = b.par_qty;
    }),
  );
  const dd = getDB();
  return { body: { part: partView(dd, activePart(dd, b.part_id)), event_id, affected_shelf_ids: [activeSlot(dd, b.slot_id).shelf_id] } };
}

// ---------------- shelves ----------------

export function listShelves(): Res {
  const d = getDB();
  const groups = new Map<string, { zone_id: string | null; zone_name: string; shelves: unknown[] }>();
  for (const s of d.shelves.filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const zid = s.zone_id ?? "none";
    const zname = d.zones.find((z) => z.zone_id === s.zone_id)?.name ?? "No zone";
    if (!groups.has(zid)) groups.set(zid, { zone_id: s.zone_id, zone_name: zname, shelves: [] });
    const v = shelfView(d, s);
    groups.get(zid)!.shelves.push({ ...v, slots: undefined, slot_count: v.slots.length });
  }
  return { body: { zones: [...groups.values()] } };
}

export function getShelf(ctx: Ctx): Res {
  const d = getDB();
  return { body: shelfView(d, activeShelf(d, ctx.params.shelf_id)) };
}

function normalizeRows(rows: Row[]): Row[] {
  return rows.map((r, i) => ({
    row_index: i,
    row_label: i === 0 ? "G" : String(i),
    elevation_in: round16(r.elevation_in),
    clear_height_in: round16(r.clear_height_in),
  }));
}

function validateShelfGeometry(s: Partial<ShelfCreate>) {
  requirePositive({ width_in: s.width_in, depth_in: s.depth_in, height_in: s.height_in });
  const errs: Record<string, string> = {};
  if (!isNum(s.x_in)) errs.x_in = "Required";
  if (!isNum(s.y_in)) errs.y_in = "Required";
  if (!isNum(s.rotation_deg)) errs.rotation_deg = "Required";
  if (!Number.isInteger(s.cols) || (s.cols as number) < 1 || (s.cols as number) > 200) errs.cols = "1–200 columns";
  if (Object.keys(errs).length) bad("Some values are missing or invalid", errs);
  if (isNum(s.x_in) && s.x_in < 0) bad("Nothing is modeled west of X = 0 (office side)", { x_in: "Must be 0 or more" });
  const rp = rowsProblem(s.rows ?? [], s.height_in!);
  if (rp) bad(rp, { rows: rp });
}

export function createShelf(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as ShelfCreate;
  const d = getDB();
  const rows = normalizeRows(b?.rows ?? []);
  validateShelfGeometry({ ...b, rows });
  if (b.zone_id && !d.zones.some((z) => z.zone_id === b.zone_id && z.active)) bad("Unknown zone", { zone_id: "Unknown" });
  const taken = new Set(d.shelves.filter((s) => s.active).map((s) => s.name));
  let name = (b.name ?? "").trim();
  if (!name) name = nextShelfName("S0", taken);
  if (taken.has(name)) bad(`There's already a shelf named ${name}`, { name: "Already used" });
  const shelf_id = mintId("shf");
  const { event_id } = write({ action: "create", entity: "shelf", entityId: shelf_id, by: by() }, (tx) =>
    tx.insert<ShelfRow>("shelves", {
      shelf_id, name, zone_id: b.zone_id ?? null, kind: b.kind ?? "shelving",
      x_in: round16(b.x_in), y_in: round16(b.y_in), rotation_deg: round16(((b.rotation_deg % 360) + 360) % 360),
      width_in: round16(b.width_in), depth_in: round16(b.depth_in), height_in: round16(b.height_in),
      cols: b.cols, rows, wall_ref: b.wall_ref ?? null, notes: b.notes ?? "", version: 1, active: true,
    }),
  );
  const dd = getDB();
  return { status: 201, body: { ...shelfView(dd, activeShelf(dd, shelf_id)), event_id } };
}

export function patchShelf(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const shelf = activeShelf(d, ctx.params.shelf_id);
  const b = ctx.body as ShelfPatch;
  checkVersion(shelf.version, b?.version, () => shelfView(d, shelf));
  const next: ShelfRow = { ...shelf, rows: shelf.rows };
  const fields = ["name", "zone_id", "kind", "x_in", "y_in", "rotation_deg", "width_in", "depth_in", "height_in", "cols", "wall_ref", "notes"] as const;
  for (const k of fields) if (k in b) (next as any)[k] = (b as any)[k];
  if ("rows" in b && b.rows) next.rows = normalizeRows(b.rows);
  validateShelfGeometry(next);
  next.name = String(next.name).trim();
  if (!next.name) bad("Name is required", { name: "Required" });
  if (d.shelves.some((s) => s.active && s.shelf_id !== shelf.shelf_id && s.name === next.name))
    bad(`There's already a shelf named ${next.name}`, { name: "Already used" });
  if (next.zone_id && !d.zones.some((z) => z.zone_id === next.zone_id && z.active)) bad("Unknown zone", { zone_id: "Unknown" });
  const outOfBounds = shelfSlots(d, shelf.shelf_id)
    .map((s) => ({ s, reason: slotBoundsProblem(next, s) }))
    .filter((x) => x.reason);
  if (outOfBounds.length) {
    throw new MockHttpError(409, {
      error: "slot_out_of_bounds",
      message: `${outOfBounds.length} slot(s) would no longer fit on the shelf.`,
      slots: outOfBounds.map(({ s, reason }) => ({ slot_id: s.slot_id, location_code: slotCode(shelf, s), reason: reason! })),
    });
  }
  const { event_id } = write({ action: "update", entity: "shelf", entityId: shelf.shelf_id, by: by() }, (tx) =>
    tx.update<ShelfRow>("shelves", shelf.shelf_id, (row) => {
      for (const k of fields) if (k in b) (row as any)[k] = (next as any)[k];
      for (const k of ["x_in", "y_in", "width_in", "depth_in", "height_in"] as const) row[k] = len(row[k]) as number;
      row.rotation_deg = round16(((row.rotation_deg % 360) + 360) % 360);
      row.name = next.name;
      if ("rows" in b && b.rows) row.rows = next.rows;
    }),
  );
  const dd = getDB();
  return { body: { ...shelfView(dd, activeShelf(dd, shelf.shelf_id)), event_id } };
}

export function deleteShelf(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const shelf = activeShelf(d, ctx.params.shelf_id);
  const force = ctx.query.get("force") === "true" || ctx.body?.force === true;
  const slots = shelfSlots(d, shelf.shelf_id);
  const occupied = slots.filter((s) => activeLocationsForSlot(d, s.slot_id).length);
  if (occupied.length && !(force && getRole() === "admin")) {
    throw new MockHttpError(409, {
      error: "shelf_not_empty",
      message: `${occupied.length} slot(s) on ${shelf.name} still hold parts. Move or remove them first${getRole() === "admin" ? ", or force-delete as admin" : ""}.`,
      conflicts: slotConflicts(d, shelf, occupied),
    });
  }
  const { event_id } = write({ action: "delete", entity: "shelf", entityId: shelf.shelf_id, by: by() }, (tx) => {
    for (const s of occupied) for (const l of activeLocationsForSlot(tx.d, s.slot_id)) deactivateLocation(tx, l.part_id, l.slot_id);
    for (const s of slots) tx.update<SlotRow>("slots", s.slot_id, (r) => void (r.active = false));
    tx.update<ShelfRow>("shelves", shelf.shelf_id, (r) => void (r.active = false));
  });
  return { body: { ok: true, event_id } };
}

export function duplicateShelf(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const src = activeShelf(d, ctx.params.shelf_id);
  const r = (src.rotation_deg * Math.PI) / 180;
  const taken = new Set(d.shelves.filter((s) => s.active).map((s) => s.name));
  const shelf_id = mintId("shf");
  const { event_id } = write({ action: "duplicate", entity: "shelf", entityId: shelf_id, by: by() }, (tx) => {
    tx.insert<ShelfRow>("shelves", {
      ...structuredClone(src),
      shelf_id,
      name: nextShelfName(src.name, taken),
      x_in: round16(src.x_in + src.width_in * Math.cos(r)),
      y_in: round16(src.y_in + src.width_in * Math.sin(r)),
      wall_ref: null,
      version: 1,
      active: true,
    });
    for (const s of shelfSlots(tx.d, src.shelf_id)) {
      tx.insert<SlotRow>("slots", { ...structuredClone(s), slot_id: mintId("slt", tx.d), shelf_id, version: 1, active: true });
    }
  });
  const dd = getDB();
  return { status: 201, body: { ...shelfView(dd, activeShelf(dd, shelf_id)), event_id } };
}

// ---------------- slots ----------------

export function createSlot(ctx: Ctx): Res {
  need("editor");
  const b = ctx.body as SlotCreate;
  const d = getDB();
  const shelf = activeShelf(d, b?.shelf_id);
  const cand = { row_index: b.row_index, col_start: b.col_start, width_span: b.width_span ?? 1, height_span: b.height_span ?? 1 };
  const prob = slotBoundsProblem(shelf, cand);
  if (prob) bad(prob, { col_start: prob });
  const overlap = overlappingSlots(shelfSlots(d, shelf.shelf_id), cand);
  if (overlap.length)
    throw new MockHttpError(409, { error: "slot_occupied", message: "That space overlaps another slot.", conflicts: slotConflicts(d, shelf, overlap) });
  const sameRow = shelfSlots(d, shelf.shelf_id).filter((s) => s.row_index === cand.row_index);
  const slot_no = Number.isInteger(b.slot_no) ? (b.slot_no as number) : sameRow.reduce((m, s) => Math.max(m, s.slot_no), 0) + 1;
  const slot_id = mintId("slt");
  const { event_id } = write({ action: "create", entity: "slot", entityId: slot_id, by: by() }, (tx) =>
    tx.insert<SlotRow>("slots", {
      slot_id, shelf_id: shelf.shelf_id, slot_no, ...cand,
      bin_type: b.bin_type ?? "bin", bin_width_in: lenOrNull(b.bin_width_in), bin_height_in: lenOrNull(b.bin_height_in),
      bin_depth_in: lenOrNull(b.bin_depth_in), bin_color: b.bin_color ?? null, version: 1, active: true,
    }),
  );
  const dd = getDB();
  const sh = activeShelf(dd, shelf.shelf_id);
  return { status: 201, body: { ...slotView(dd, sh, activeSlot(dd, slot_id)), shelf_id: sh.shelf_id, event_id } };
}

export function patchSlot(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const slot = activeSlot(d, ctx.params.slot_id);
  const shelf = activeShelf(d, slot.shelf_id);
  const b = ctx.body as SlotPatch;
  checkVersion(slot.version, b?.version, () => slotView(d, shelf, slot));
  if ("slot_no" in b && (!Number.isInteger(b.slot_no) || (b.slot_no as number) < 1)) bad("Slot number must be 1 or more", { slot_no: "1 or more" });
  if ("bin_type" in b && !["bin", "box", "tote", "loose", "drawer"].includes(String(b.bin_type))) bad("Unknown bin type", { bin_type: "Unknown" });
  for (const k of ["bin_width_in", "bin_height_in", "bin_depth_in"] as const)
    if (k in b && b[k] != null && (!isNum(b[k]) || (b[k] as number) <= 0)) bad("Bin sizes must be above 0", { [k]: "Above 0" });
  const { event_id } = write({ action: "update", entity: "slot", entityId: slot.slot_id, by: by() }, (tx) =>
    tx.update<SlotRow>("slots", slot.slot_id, (row) => {
      if ("slot_no" in b) row.slot_no = b.slot_no!;
      if ("bin_type" in b) row.bin_type = b.bin_type!;
      if ("bin_color" in b) row.bin_color = b.bin_color ?? null;
      for (const k of ["bin_width_in", "bin_height_in", "bin_depth_in"] as const) if (k in b) row[k] = lenOrNull(b[k]) as number | null;
    }),
  );
  const dd = getDB();
  return { body: { ...slotView(dd, shelf, activeSlot(dd, slot.slot_id)), shelf_id: shelf.shelf_id, event_id } };
}

export function resizeSlot(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const slot = activeSlot(d, ctx.params.slot_id);
  const shelf = activeShelf(d, slot.shelf_id);
  const b = ctx.body as SlotResize;
  checkVersion(slot.version, b?.version, () => slotView(d, shelf, slot));
  if (!Number.isInteger(b.width_span) || !Number.isInteger(b.height_span)) bad("Spans must be whole cells", { width_span: "Whole number" });
  let cand = anchoredResize(slot, b.width_span, b.height_span, b.anchor);
  if (Number.isInteger(b.col_start)) cand = { ...cand, col_start: b.col_start! };
  if (Number.isInteger(b.row_index)) cand = { ...cand, row_index: b.row_index! };
  const prob = slotBoundsProblem(shelf, cand);
  if (prob)
    throw new MockHttpError(409, {
      error: "slot_out_of_bounds",
      message: prob,
      slots: [{ slot_id: slot.slot_id, location_code: slotCode(shelf, slot), reason: prob }],
    });
  const overlap = overlappingSlots(shelfSlots(d, shelf.shelf_id), cand, slot.slot_id);
  if (overlap.length)
    throw new MockHttpError(409, {
      error: "slot_occupied",
      message: `The new size overlaps ${overlap.length === 1 ? "another slot" : `${overlap.length} slots`}.`,
      conflicts: slotConflicts(d, shelf, overlap),
    });
  const { event_id } = write({ action: "resize", entity: "slot", entityId: slot.slot_id, by: by() }, (tx) =>
    tx.update<SlotRow>("slots", slot.slot_id, (row) => {
      row.col_start = cand.col_start;
      row.row_index = cand.row_index;
      row.width_span = cand.width_span;
      row.height_span = cand.height_span;
    }),
  );
  const dd = getDB();
  return { body: { ...slotView(dd, shelf, activeSlot(dd, slot.slot_id)), shelf_id: shelf.shelf_id, event_id } };
}

export function deleteSlot(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const slot = activeSlot(d, ctx.params.slot_id);
  const shelf = activeShelf(d, slot.shelf_id);
  if (activeLocationsForSlot(d, slot.slot_id).length)
    throw new MockHttpError(409, {
      error: "slot_not_empty",
      message: `${slotCode(shelf, slot)} still holds parts. Move or remove them first.`,
      conflicts: slotConflicts(d, shelf, [slot]),
    });
  const { event_id } = write({ action: "delete", entity: "slot", entityId: slot.slot_id, by: by() }, (tx) =>
    tx.update<SlotRow>("slots", slot.slot_id, (r) => void (r.active = false)),
  );
  return { body: { ok: true, event_id, affected_shelf_ids: [shelf.shelf_id] } };
}

// ---------------- zones / openings (admin writes) ----------------

const strip = <T extends { active: boolean }>({ active: _a, ...rest }: T) => rest;

export function listZones(): Res {
  return { body: { items: getDB().zones.filter((z) => z.active).map(strip) } };
}

function validatePolygon(poly: unknown) {
  if (!Array.isArray(poly) || poly.length < 3 || !poly.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])))
    bad("A zone polygon needs at least 3 [x, y] points", { polygon_in: "At least 3 points" });
  if ((poly as number[][]).some((p) => p[0] < 0)) bad("Nothing is modeled west of X = 0 (office side)", { polygon_in: "X must be 0 or more" });
}

export function createZone(ctx: Ctx): Res {
  need("admin");
  const b = ctx.body as ZoneCreate;
  if (!b?.name) bad("Name is required", { name: "Required" });
  validatePolygon(b.polygon_in);
  const zone_id = mintId("zon");
  const { event_id } = write({ action: "create", entity: "zone", entityId: zone_id, by: by() }, (tx) =>
    tx.insert<ZoneRow>("zones", {
      zone_id, name: b.name, room_no: b.room_no ?? "", polygon_in: b.polygon_in.map(([x, y]) => [round16(x), round16(y)]),
      open_edges: b.open_edges ?? [], wall_height_in: b.wall_height_in ?? null, notes: b.notes ?? "", verified: !!b.verified, version: 1, active: true,
    }),
  );
  return { status: 201, body: { ...strip(findRow<ZoneRow>(getDB(), "zones", zone_id)!), event_id } };
}

export function patchZone(ctx: Ctx): Res {
  need("admin");
  const d = getDB();
  const z = d.zones.find((x) => x.zone_id === ctx.params.zone_id && x.active);
  if (!z) notFound("Zone");
  const b = ctx.body as ZonePatch;
  checkVersion(z.version, b?.version, () => strip(z));
  if ("polygon_in" in b) validatePolygon(b.polygon_in);
  const { event_id } = write({ action: "update", entity: "zone", entityId: z.zone_id, by: by() }, (tx) =>
    tx.update<ZoneRow>("zones", z.zone_id, (row) => {
      for (const k of ["name", "room_no", "open_edges", "wall_height_in", "notes", "verified"] as const) if (k in b) (row as any)[k] = (b as any)[k];
      if (b.polygon_in) row.polygon_in = b.polygon_in.map(([x, y]) => [round16(x), round16(y)]);
    }),
  );
  return { body: { ...strip(findRow<ZoneRow>(getDB(), "zones", z.zone_id)!), event_id } };
}

export function listOpenings(): Res {
  return { body: { items: getDB().openings.filter((o) => o.active).map(strip) } };
}

function validateOpening(o: Partial<OpeningCreate>) {
  for (const k of ["x1_in", "y1_in", "x2_in", "y2_in"] as const) if (k in o && !isNum(o[k])) bad("Opening ends must be numbers", { [k]: "Number" });
  if (("x1_in" in o && (o.x1_in as number) < 0) || ("x2_in" in o && (o.x2_in as number) < 0)) bad("Nothing is modeled west of X = 0", { x1_in: "0 or more" });
  if ("kind" in o && !["door", "overhead", "opening"].includes(String(o.kind))) bad("Unknown opening kind", { kind: "Unknown" });
}

export function createOpening(ctx: Ctx): Res {
  need("admin");
  const b = ctx.body as OpeningCreate;
  validateOpening(b);
  const opening_id = mintId("opn");
  const { event_id } = write({ action: "create", entity: "opening", entityId: opening_id, by: by() }, (tx) =>
    tx.insert<OpeningRow>("openings", {
      opening_id, kind: b.kind, tag: b.tag ?? "", x1_in: round16(b.x1_in), y1_in: round16(b.y1_in), x2_in: round16(b.x2_in), y2_in: round16(b.y2_in),
      height_in: b.height_in ?? (b.kind === "door" ? 84 : b.kind === "overhead" ? 168 : 120), zone_id: b.zone_id ?? null, notes: b.notes ?? "",
      verified: !!b.verified, version: 1, active: true,
    }),
  );
  return { status: 201, body: { ...strip(findRow<OpeningRow>(getDB(), "openings", opening_id)!), event_id } };
}

export function patchOpening(ctx: Ctx): Res {
  need("admin");
  const d = getDB();
  const o = d.openings.find((x) => x.opening_id === ctx.params.opening_id && x.active);
  if (!o) notFound("Opening");
  const b = ctx.body as OpeningPatch;
  checkVersion(o.version, b?.version, () => strip(o));
  validateOpening(b);
  const { event_id } = write({ action: "update", entity: "opening", entityId: o.opening_id, by: by() }, (tx) =>
    tx.update<OpeningRow>("openings", o.opening_id, (row) => {
      for (const k of ["kind", "tag", "x1_in", "y1_in", "x2_in", "y2_in", "height_in", "zone_id", "notes", "verified"] as const)
        if (k in b) (row as any)[k] = k.endsWith("_in") ? round16((b as any)[k]) : (b as any)[k];
    }),
  );
  return { body: { ...strip(findRow<OpeningRow>(getDB(), "openings", o.opening_id)!), event_id } };
}

// ---------------- events / undo ----------------

const publicEvent = ({ rows: _rows, ...e }: EventRow) => e;

export function listEvents(ctx: Ctx): Res {
  const d = getDB();
  const entity = ctx.query.get("entity");
  const entityId = ctx.query.get("entity_id");
  const limit = Math.min(parseInt(ctx.query.get("limit") ?? "50", 10) || 50, 500);
  const items = d.events
    .filter((e) => (!entity || e.entity === entity) && (!entityId || e.entity_id === entityId || e.rows.some((r) => r.key === entityId)))
    .slice()
    .reverse()
    .slice(0, limit)
    .map(publicEvent);
  return { body: { items } };
}

function shelfIdsOfChange(d: DB, c: { table: string; key: string; before: any; after: any }): string[] {
  const row = c.after ?? c.before;
  if (c.table === "shelves") return [c.key];
  if (c.table === "slots") return [row.shelf_id];
  if (c.table === "locations") {
    const slot = d.slots.find((s) => s.slot_id === row.slot_id);
    return slot ? [slot.shelf_id] : [];
  }
  return [];
}

export function undoEvent(ctx: Ctx): Res {
  need("editor");
  const d = getDB();
  const ev = d.events.find((e) => e.event_id === ctx.params.event_id);
  if (!ev) notFound("Event");
  if (ev.undone_by) throw new MockHttpError(409, { error: "undo_stale", message: "That change was already undone." });
  if (["zones", "openings"].some((t) => ev.rows.some((r) => r.table === t))) need("admin");
  for (const c of ev.rows) {
    const cur = findRow<any>(d, c.table, c.key);
    if (!cur || !c.after || cur.version !== c.after.version)
      throw new MockHttpError(409, { error: "undo_stale", message: "Something changed since then, so it can't be undone automatically." });
  }
  const affected = new Set<string>();
  const { event_id } = write({ action: "undo", entity: ev.entity, entityId: ev.entity_id, by: by(), reason: `Undo ${ev.action}` }, (tx) => {
    for (const c of [...ev.rows].reverse()) {
      for (const sid of shelfIdsOfChange(tx.d, c)) affected.add(sid);
      tx.update<any>(c.table, c.key, (row) => {
        if (c.before) {
          const v = row.version;
          Object.assign(row, structuredClone(c.before));
          row.version = v;
        } else row.active = false;
      });
    }
  });
  // Events aren't versioned rows; mark the original as undone after the write commits.
  const dd = getDB();
  setDB({ ...dd, events: dd.events.map((e) => (e.event_id === ev.event_id ? { ...e, undone_by: event_id } : e)) });
  return { body: { ok: true, undone_event_id: ev.event_id, event_id, affected_shelf_ids: [...affected] } };
}

// ---------------- export ----------------

export function exportCsv(): Res {
  need("editor");
  const d = getDB();
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["part_id", "part_code", "part_name", "category", "department", "zone", "shelf", "row", "slot_no", "location_code", "slot_id", "par_qty", "on_hand_qty"].join(","),
  ];
  for (const p of d.parts.filter((x) => x.active)) {
    for (const l of partView(d, p).locations) {
      lines.push(
        [p.part_id, p.part_code, p.part_name, p.category, p.department, l.zone_name, l.shelf_name, l.row_label, l.slot_no, l.location_code, l.slot_id, l.par_qty, l.on_hand_qty]
          .map(esc)
          .join(","),
      );
    }
  }
  return { body: lines.join("\n") + "\n", headers: { "content-type": "text/csv" } };
}
