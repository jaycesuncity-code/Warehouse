// Map actions. Every write goes through `write()`: optimistic update + rollback, Saving/Saved
// state, 409 version_conflict -> "Changed by someone else", network failure -> listed as a failed
// edit (never silently dropped), and an undo entry when the server recorded an event.

import { api, ApiError, isApiError } from "./api";
import type {
  ErrorCode,
  Layout,
  LayoutShelf,
  LocationWrite,
  MoveMode,
  Opening,
  OpeningPatch,
  Part,
  PartPatch,
  PartSearchResult,
  Row,
  Shelf,
  ShelfBase,
  ShelfCreate,
  ShelfPatch,
  SlotCreate,
  SlotPatch,
  SlotWrite,
  UndoWrite,
  Zone,
  ZonePatch,
} from "../shared/contract";
import { isPartId, tempId } from "../shared/ids";
import { errorText } from "../shared/ui/ConflictDialog";
import {
  cellWidth,
  frontDir,
  normalizeDeg,
  placementFromCenter,
  round16,
  shelfCenter,
  shelfCorners,
  shelfToMap,
  slotRect,
} from "./units";
import { snapPlacement, snapTargets, buildWalls, zoneAt, type Vec } from "./geometry";
import {
  learnDepartments,
  patchShelfFields,
  removeShelf,
  removeSlot,
  shelvesBounds,
  slotSummary,
  toLayoutShelf,
  upsertOpening,
  upsertShelf,
  upsertSlot,
  upsertZone,
} from "./layoutOps";
import { PRESETS, rowsFor, type PresetKey, type ShelfSize } from "./presets";
import { searchFocus, type SearchFocus } from "./search";
import { flyTo, getMap, isAdmin, setMap, shelfById, toast, type DialogState, type Selection } from "./store";

// ---------------------------------------------------------------------------
// write helper
// ---------------------------------------------------------------------------

let failSeq = 0;

interface WriteOpts<T> {
  label: string;
  entity?: string;
  optimistic?: () => () => void;
  onOk?: (r: T) => void;
  conflict?: { what: string; reload: () => Promise<void>; overwrite?: () => Promise<void> };
  /** Error codes the caller handles itself (rethrown after rollback). */
  pass?: ErrorCode[];
  undoable?: boolean;
}

function addFailed(label: string, message: string, again: () => Promise<unknown>) {
  const id = ++failSeq;
  setMap((s) => ({
    offline: true,
    failed: [
      ...s.failed,
      {
        id,
        label,
        message,
        retry: async () => {
          setMap((st) => ({ failed: st.failed.filter((f) => f.id !== id) }));
          await again();
        },
      },
    ],
  }));
}

export function discardFailed(id: number) {
  setMap((s) => ({ failed: s.failed.filter((f) => f.id !== id) }));
}

export async function retryAllFailed() {
  for (const f of [...getMap().failed]) await f.retry();
}

function pushUndo(label: string, eventId: string, entity: string) {
  setMap((s) => ({ undoStack: [...s.undoStack.slice(-99), { label, eventId, entity }], redoStack: [] }));
}

export async function write<T>(call: () => Promise<T>, o: WriteOpts<T>): Promise<T | undefined> {
  setMap((s) => ({ saving: s.saving + 1 }));
  let rollback: (() => void) | undefined;
  try {
    rollback = o.optimistic?.();
    const r = await call();
    o.onOk?.(r);
    const ev = (r as { event_id?: string | null } | undefined)?.event_id;
    if (o.undoable !== false && ev) pushUndo(o.label, ev, o.entity ?? "shelf");
    setMap({ lastSavedAt: Date.now(), offline: false });
    return r;
  } catch (e) {
    rollback?.();
    if (isApiError(e, "network")) {
      addFailed(o.label, e.message, () => write(call, o));
      return undefined;
    }
    if (isApiError(e, "version_conflict") && o.conflict) {
      setMap({ dialog: { kind: "version", ...o.conflict } });
      return undefined;
    }
    if (e instanceof ApiError && o.pass?.some(code => code === e.code)) throw e;
    toast(errorText(e), "error");
    return undefined;
  } finally {
    setMap((s) => ({ saving: Math.max(0, s.saving - 1) }));
  }
}

const L = () => getMap().layout as Layout;

function learnParts(parts: Part[]) {
  if (!parts.length) return;
  setMap((s) => {
    const deptCache = { ...s.deptCache };
    for (const p of parts) if (p.department) deptCache[p.part_id] = p.department;
    return { deptCache };
  });
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export async function loadMe() {
  try {
    setMap({ me: await api.me() });
  } catch (e) {
    if (isApiError(e, "network")) setMap({ offline: true });
  }
}

export async function loadLayout(force = false): Promise<boolean> {
  const t0 = performance.now();
  try {
    const r = await api.getLayout(force ? null : getMap().etag);
    (window as unknown as { __mapTimings?: Record<string, number> }).__mapTimings = {
      ...((window as unknown as { __mapTimings?: Record<string, number> }).__mapTimings ?? {}),
      layoutLoadMs: performance.now() - t0,
    };
    if (r.notModified) return false;
    setMap((s) => ({
      layout: r.layout,
      etag: r.etag,
      loadError: null,
      offline: false,
      deptCache: learnDepartments(r.layout, { ...s.deptCache }),
    }));
    return true;
  } catch (e) {
    setMap({ loadError: errorText(e), offline: isApiError(e, "network") || getMap().offline });
    return false;
  }
}

function stripEvent<T extends object>(x: T): T {
  const { event_id: _e, ...rest } = x as T & { event_id?: unknown };
  return rest as T;
}

/** Puts a full shelf (from GET or a write) into the local layout + detail cache. */
export function applyShelf(sh: Shelf, replaceId?: string) {
  const clean = stripEvent(sh);
  setMap((s) => {
    if (!s.layout) return {};
    const prev = s.layout.shelves.find((x) => x.shelf_id === (replaceId ?? sh.shelf_id));
    const ls = toLayoutShelf(clean, prev, (id) => s.deptCache[id]);
    const detail = { ...s.shelfDetail, [sh.shelf_id]: clean };
    if (replaceId && replaceId !== sh.shelf_id) delete detail[replaceId];
    return { layout: upsertShelf(s.layout, ls, replaceId), shelfDetail: detail };
  });
}

function dropShelfLocally(id: string) {
  setMap((s) => {
    const detail = { ...s.shelfDetail };
    delete detail[id];
    const sel = s.selection;
    const selGone = sel && ((sel.kind === "shelf" && sel.id === id) || (sel.kind === "slot" && sel.shelfId === id));
    return {
      layout: s.layout ? removeShelf(s.layout, id) : s.layout,
      shelfDetail: detail,
      ...(selGone ? { selection: null, frontViewOpen: false } : {}),
    };
  });
}

export async function loadShelf(id: string): Promise<Shelf | null> {
  try {
    const sh = await api.getShelf(id);
    applyShelf(sh);
    return sh;
  } catch (e) {
    if (isApiError(e, "not_found")) dropShelfLocally(id);
    else if (isApiError(e, "network")) setMap({ offline: true });
    return null;
  }
}

async function reloadBuilding() {
  const [z, o] = await Promise.all([api.listZones(), api.listOpenings()]);
  setMap((s) => (s.layout ? { layout: { ...s.layout, zones: z.items, openings: o.items } } : {}));
}

// ---------------------------------------------------------------------------
// camera + selection
// ---------------------------------------------------------------------------

export function fitBounds(b: { minX: number; minY: number; maxX: number; maxY: number }, pad = 1.08, leftPx = 0) {
  if (!Number.isFinite(b.minX)) return;
  flyTo({
    center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, h: 0 },
    radius: Math.max(60, (Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2) * pad),
    leftPx,
  });
}

/** Desktop shows the result list over the left of the viewport. */
const resultsPanelPx = () => (typeof window !== "undefined" && window.innerWidth >= 1024 ? 330 : 0);

export function fitAll() {
  const lay = getMap().layout;
  if (!lay) return;
  const pts = lay.zones.flatMap((z) => z.polygon_in);
  fitBounds({
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  });
}

export function flyToShelf(sh: LayoutShelf, leftPx = 0) {
  const c = shelfCenter(sh);
  const f = frontDir(sh.rotation_deg);
  flyTo({
    center: { x: c.x, y: c.y, h: sh.height_in / 2 },
    radius: Math.max(sh.width_in, sh.height_in) * 0.62 + 12,
    from: f,
    leftPx,
  });
}

export function flyToSlot(sh: LayoutShelf, slotId: string, leftPx = 0) {
  const sl = sh.slots.find((s) => s.slot_id === slotId);
  const r = sl && slotRect(sh, sl);
  if (!sl || !r) return flyToShelf(sh, leftPx);
  const p = shelfToMap(sh, r.left + r.width / 2, sh.depth_in / 2);
  flyTo({
    center: { x: p.x, y: p.y, h: r.bottom + r.height / 2 },
    radius: Math.max(30, Math.max(r.width, r.height) * 1.4),
    from: frontDir(sh.rotation_deg),
    leftPx,
  });
}

export function select(sel: Selection, opts: { fly?: boolean; front?: boolean; leftPx?: number } = {}) {
  setMap((s) => ({
    selection: sel,
    frontViewOpen: opts.front ?? (sel?.kind === "shelf" || sel?.kind === "slot" ? s.frontViewOpen || false : false),
    // phones: picking a shelf/slot from the Layout or Results sheet closes it to show the map
    mobilePanel:
      sel && (sel.kind === "shelf" || sel.kind === "slot") && (s.mobilePanel === "tree" || s.mobilePanel === "results")
        ? null
        : s.mobilePanel,
  }));
  if (!sel) return;
  const lay = L();
  if (sel.kind === "shelf" || sel.kind === "slot") {
    const shelfId = sel.kind === "shelf" ? sel.id : sel.shelfId;
    const sh = lay.shelves.find((x) => x.shelf_id === shelfId);
    if (!sh) return;
    if (!shelfId.startsWith("tmp-")) void loadShelf(shelfId);
    if (opts.fly) {
      if (sel.kind === "slot") flyToSlot(sh, sel.id, opts.leftPx);
      else flyToShelf(sh, opts.leftPx);
    }
  } else if (sel.kind === "zone" && opts.fly) {
    const z = lay.zones.find((x) => x.zone_id === sel.id);
    if (z)
      fitBounds({
        minX: Math.min(...z.polygon_in.map((p) => p[0])),
        maxX: Math.max(...z.polygon_in.map((p) => p[0])),
        minY: Math.min(...z.polygon_in.map((p) => p[1])),
        maxY: Math.max(...z.polygon_in.map((p) => p[1])),
      });
  } else if (sel.kind === "opening" && opts.fly) {
    const o = lay.openings.find((x) => x.opening_id === sel.id);
    if (o) flyTo({ center: { x: (o.x1_in + o.x2_in) / 2, y: (o.y1_in + o.y2_in) / 2, h: 0 }, radius: 180 });
  }
}

export function openFrontView(open = true) {
  setMap({ frontViewOpen: open });
}

// ---------------------------------------------------------------------------
// shelves
// ---------------------------------------------------------------------------

function overwriteFor(fn: () => Promise<void>) {
  return isAdmin(getMap()) ? fn : undefined;
}

export async function patchShelf(id: string, fields: Partial<ShelfBase>, label = "Edit shelf", pass: ErrorCode[] = []) {
  const sh = shelfById(getMap(), id);
  if (!sh || id.startsWith("tmp-")) return undefined;
  const body = { ...fields, version: sh.version } as ShelfPatch;
  const prev = sh;
  return write(() => api.patchShelf(id, body), {
    label,
    entity: "shelf",
    optimistic: () => {
      setMap((s) => ({ layout: patchShelfFields(s.layout!, id, fields) }));
      return () => setMap((s) => ({ layout: s.layout ? upsertShelf(s.layout, prev) : s.layout }));
    },
    onOk: (r) => applyShelf(r),
    pass,
    conflict: {
      what: `shelf ${sh.name}`,
      reload: async () => void (await loadShelf(id)),
      overwrite: overwriteFor(async () => {
        const cur = await api.getShelf(id);
        await write(() => api.patchShelf(id, { ...fields, version: cur.version } as ShelfPatch), {
          label,
          entity: "shelf",
          onOk: (r) => applyShelf(r),
        });
      }),
    },
  });
}

export function moveShelfTo(id: string, x_in: number, y_in: number) {
  return patchShelf(id, { x_in: round16(x_in), y_in: round16(y_in) }, "Move shelf");
}

export function rotateShelf(id: string, delta: number) {
  const sh = shelfById(getMap(), id);
  if (!sh) return;
  const c = shelfCenter(sh);
  const rotation_deg = normalizeDeg(round16(sh.rotation_deg + delta));
  const p = placementFromCenter(c.x, c.y, rotation_deg, sh.width_in, sh.depth_in);
  setMap({ lastRotation: rotation_deg });
  return patchShelf(id, { ...p, rotation_deg }, `Rotate ${sh.name}`);
}

export async function duplicateShelf(id: string) {
  const sh = shelfById(getMap(), id);
  if (!sh) return;
  const r = await write(() => api.duplicateShelf(id), {
    label: `Duplicate ${sh.name}`,
    entity: "shelf",
    onOk: (x) => applyShelf(x),
  });
  if (r) {
    select({ kind: "shelf", id: r.shelf_id });
    toast(`Made ${r.name}`, "success");
  }
  return r;
}

/** Row tool: N identical units end to end, continuing to the right of the selected unit. */
export async function rowOfUnits(id: string, n: number) {
  let cur = id;
  let made = 0;
  for (let i = 0; i < n; i++) {
    const r = await duplicateShelf(cur);
    if (!r) break;
    cur = r.shelf_id;
    made++;
  }
  if (made) toast(`Added ${made} unit${made === 1 ? "" : "s"} in a row`, "success");
}

export function deleteShelf(id: string) {
  const sh = shelfById(getMap(), id);
  if (!sh) return;
  setMap({
    dialog: {
      kind: "confirm",
      title: `Delete ${sh.name}?`,
      message: `${sh.name} and its empty slots will be removed (soft delete; it can be undone).`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => doDeleteShelf(id, false),
    },
  });
}

async function doDeleteShelf(id: string, force: boolean) {
  const sh = shelfById(getMap(), id);
  if (!sh) return;
  try {
    await write(() => api.deleteShelf(id, { force }), {
      label: `Delete ${sh.name}`,
      entity: "shelf",
      optimistic: () => {
        const prev = sh;
        setMap((s) => ({ layout: removeShelf(s.layout!, id) }));
        return () => setMap((s) => ({ layout: upsertShelf(s.layout!, prev) }));
      },
      onOk: () => dropShelfLocally(id),
      pass: ["shelf_not_empty"],
    });
  } catch (e) {
    const err = e as ApiError;
    setMap({
      dialog: {
        kind: "shelf_not_empty",
        shelfName: sh.name,
        message: err.message,
        conflicts: err.body.conflicts ?? [],
        canForce: isAdmin(getMap()),
        onForce: () => doDeleteShelf(id, true),
        onOpen: () => select({ kind: "shelf", id }, { fly: true, front: true }),
      },
    });
  }
}

function snapCtxFor(excludeId: string | null) {
  const s = getMap();
  const lay = s.layout!;
  const others = lay.shelves.filter((x) => x.shelf_id !== excludeId);
  const { walls } = buildWalls(lay.zones, lay.openings);
  const t = s.snapEdges ? snapTargets(others, walls) : { segments: [], points: [] };
  return { grid: s.snap, ...t };
}

/** Applies the current snap settings to a candidate placement. */
export function snapShelf(
  sh: Pick<ShelfBase, "x_in" | "y_in" | "rotation_deg" | "width_in" | "depth_in">,
  excludeId: string | null,
) {
  const s = getMap();
  if (!s.snap && !s.snapEdges)
    return { x_in: round16(sh.x_in), y_in: round16(sh.y_in), snapped: null as string | null };
  return snapPlacement(sh, snapCtxFor(excludeId));
}

export function sizeFor(preset: PresetKey): ShelfSize {
  return preset === "last" ? getMap().lastSize : PRESETS[preset];
}

/** "Add shelf": click the floor to drop a unit centred on the click. */
export async function addShelfAt(at: Vec, preset: PresetKey) {
  const s = getMap();
  const lay = s.layout!;
  const size = sizeFor(preset);
  const rotation_deg = s.lastRotation;
  const p0 = placementFromCenter(at.x, at.y, rotation_deg, size.width_in, size.depth_in);
  const p = snapShelf({ ...p0, rotation_deg, width_in: size.width_in, depth_in: size.depth_in }, null);
  const zone = zoneAt(
    lay.zones,
    shelfCenter({ x_in: p.x_in, y_in: p.y_in, rotation_deg, width_in: size.width_in, depth_in: size.depth_in }),
  );
  const body: ShelfCreate = {
    name: `Shelf ${lay.shelves.length + 1}`,
    zone_id: zone?.zone_id ?? lay.zones[0]?.zone_id ?? "",
    kind: size.kind,
    x_in: p.x_in,
    y_in: p.y_in,
    rotation_deg,
    width_in: size.width_in,
    depth_in: size.depth_in,
    height_in: size.height_in,
    cols: size.cols,
    rows: rowsFor(size),
    wall_ref: null,
    notes: "",
  };
  setMap({ lastSize: size });
  return createShelf(body, "Add shelf");
}

export async function createShelf(body: ShelfCreate, label = "Add shelf") {
  const tmp = tempId();
  const tmpShelf: LayoutShelf = {
    ...body,
    kind: body.kind ?? "shelving",
    shelf_id: tmp,
    name: body.name || "New shelf",
    zone_name: L().zones.find((z) => z.zone_id === body.zone_id)?.name ?? "",
    wall_ref: body.wall_ref ?? null,
    notes: body.notes ?? "",
    version: 0,
    slots: [],
  };
  const r = await write(() => api.createShelf(body), {
    label,
    entity: "shelf",
    optimistic: () => {
      setMap((s) => ({ layout: upsertShelf(s.layout!, tmpShelf), selection: { kind: "shelf", id: tmp } }));
      return () =>
        setMap((s) => ({
          layout: removeShelf(s.layout!, tmp),
          selection: s.selection?.kind === "shelf" && s.selection.id === tmp ? null : s.selection,
        }));
    },
    onOk: (x) => {
      applyShelf(x, tmp);
      setMap((s) => ({
        selection:
          s.selection?.kind === "shelf" && s.selection.id === tmp ? { kind: "shelf", id: x.shelf_id } : s.selection,
      }));
    },
  });
  return r;
}

export async function setCols(id: string, cols: number) {
  try {
    await patchShelf(id, { cols }, "Change columns", ["slot_out_of_bounds"]);
  } catch (e) {
    const err = e as ApiError;
    const slots = (err.body.slots as { slot_id: string; location_code: string; reason: string }[]) ?? [];
    setMap({
      dialog: {
        kind: "out_of_bounds",
        title: `${slots.length} slot${slots.length === 1 ? "" : "s"} won't fit in ${cols} columns`,
        slots,
        onFix: async () => {
          const sh = shelfById(getMap(), id)!;
          for (const o of slots) {
            const sl = sh.slots.find((x) => x.slot_id === o.slot_id);
            if (!sl) continue;
            const width_span = Math.max(1, Math.min(sl.width_span, cols));
            const col_start = Math.max(1, Math.min(sl.col_start, cols - width_span + 1));
            const ok = await resizeSlot(
              id,
              sl.slot_id,
              { width_span, height_span: sl.height_span, col_start, row_index: sl.row_index },
              true,
            );
            if (!ok) return;
          }
          await patchShelf(id, { cols }, "Change columns");
        },
      },
    });
  }
}

export async function setRows(id: string, rows: Row[], label = "Edit rows") {
  try {
    await patchShelf(id, { rows }, label, ["slot_out_of_bounds"]);
  } catch (e) {
    const err = e as ApiError;
    const slots = (err.body.slots as { slot_id: string; location_code: string; reason: string }[]) ?? [];
    setMap({ dialog: { kind: "out_of_bounds", title: "Some slots would no longer fit", slots } });
  }
}

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

export function applySlot(r: SlotWrite) {
  const shelfId = r.shelf_id;
  const clean = stripEvent(r);
  setMap((s) => {
    if (!s.layout) return {};
    const sh = s.layout.shelves.find((x) => x.shelf_id === shelfId);
    const prev = sh?.slots.find((x) => x.slot_id === r.slot_id);
    const ls = slotSummary(clean, prev, (id) => s.deptCache[id]);
    const detail = s.shelfDetail[shelfId];
    const { shelf_id: _sid, ...slotOnly } = clean;
    const nextDetail = detail
      ? {
          ...detail,
          slots: (detail.slots.some((x) => x.slot_id === r.slot_id)
            ? detail.slots.map((x) => (x.slot_id === r.slot_id ? slotOnly : x))
            : [...detail.slots, slotOnly]
          ).sort((a, b) => a.row_index - b.row_index || a.col_start - b.col_start),
        }
      : undefined;
    return {
      layout: upsertSlot(s.layout, shelfId, ls),
      shelfDetail: nextDetail ? { ...s.shelfDetail, [shelfId]: nextDetail } : s.shelfDetail,
    };
  });
}

function occupiedDialog(
  err: ApiError,
  allow: ("swap" | "share" | "different" | "cancel")[],
  movingName?: string,
): Promise<"swap" | "share" | "different" | "cancel"> {
  return new Promise((resolve) => {
    setMap({
      dialog: {
        kind: "occupied",
        conflicts: err.body.conflicts ?? [],
        movingName,
        allow,
        resolve: (c) => {
          setMap({ dialog: null });
          resolve(c);
        },
      },
    });
  });
}

export async function createSlot(shelfId: string, body: Omit<SlotCreate, "shelf_id">) {
  try {
    const r = await write(() => api.createSlot({ ...body, shelf_id: shelfId }), {
      label: "Add slot",
      entity: "slot",
      onOk: applySlot,
      pass: ["slot_occupied"],
    });
    return r;
  } catch (e) {
    await occupiedDialog(e as ApiError, ["different", "cancel"]);
    return undefined;
  }
}

export async function resizeSlot(
  shelfId: string,
  slotId: string,
  spans: { width_span: number; height_span: number; col_start?: number; row_index?: number },
  quiet = false,
): Promise<boolean> {
  const sl = shelfById(getMap(), shelfId)?.slots.find((x) => x.slot_id === slotId);
  if (!sl) return false;
  try {
    const r = await write(() => api.resizeSlot(slotId, { ...spans, version: sl.version }), {
      label: `Resize ${sl.location_code}`,
      entity: "slot",
      onOk: applySlot,
      pass: ["slot_occupied", "slot_out_of_bounds"],
      conflict: { what: `slot ${sl.location_code}`, reload: async () => void (await loadShelf(shelfId)) },
    });
    return !!r;
  } catch (e) {
    const err = e as ApiError;
    if (err.code === "slot_occupied") await occupiedDialog(err, ["different", "cancel"]);
    else if (!quiet)
      setMap({
        dialog: {
          kind: "out_of_bounds",
          title: "That size doesn't fit the shelf",
          slots: (err.body.slots as never) ?? [],
        },
      });
    else toast(err.message, "error");
    return false;
  }
}

export async function patchSlot(
  shelfId: string,
  slotId: string,
  fields: Omit<SlotPatch, "version">,
  label = "Edit bin",
) {
  const sl = shelfById(getMap(), shelfId)?.slots.find((x) => x.slot_id === slotId);
  if (!sl) return;
  return write(() => api.patchSlot(slotId, { ...fields, version: sl.version }), {
    label,
    entity: "slot",
    onOk: applySlot,
    conflict: {
      what: `slot ${sl.location_code}`,
      reload: async () => void (await loadShelf(shelfId)),
      overwrite: overwriteFor(async () => {
        const cur = await api.getShelf(shelfId);
        const v = cur.slots.find((x) => x.slot_id === slotId)?.version ?? sl.version;
        await write(() => api.patchSlot(slotId, { ...fields, version: v }), { label, entity: "slot", onOk: applySlot });
      }),
    },
  });
}

export async function deleteSlot(shelfId: string, slotId: string) {
  const sl = shelfById(getMap(), shelfId)?.slots.find((x) => x.slot_id === slotId);
  if (!sl) return;
  try {
    await write(() => api.deleteSlot(slotId), {
      label: `Delete ${sl.location_code}`,
      entity: "slot",
      onOk: () =>
        setMap((s) => ({
          layout: removeSlot(s.layout!, shelfId, slotId),
          selection:
            s.selection?.kind === "slot" && s.selection.id === slotId ? { kind: "shelf", id: shelfId } : s.selection,
        })),
      pass: ["slot_not_empty"],
    });
  } catch (e) {
    toast((e as ApiError).message, "warn");
  }
}

/** "Fill row": N equal slots across an empty row. */
export async function fillRow(shelfId: string, rowIndex: number, n: number) {
  const sh = shelfById(getMap(), shelfId);
  if (!sh) return;
  if (sh.slots.some((s) => s.row_index <= rowIndex && s.row_index + s.height_span - 1 >= rowIndex)) {
    toast(`Row ${sh.rows[rowIndex]?.row_label} already has slots. Remove them first, or draw slots by hand.`, "warn");
    return;
  }
  if (n < 1 || n > sh.cols) {
    toast(`Pick 1 to ${sh.cols} slots (the shelf has ${sh.cols} columns).`, "warn");
    return;
  }
  const base = Math.floor(sh.cols / n);
  let extra = sh.cols - base * n;
  let col = 1;
  for (let i = 0; i < n; i++) {
    const w = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    const r = await createSlot(shelfId, {
      row_index: rowIndex,
      col_start: col,
      width_span: w,
      height_span: 1,
      slot_no: i + 1,
    });
    if (!r) return;
    col += w;
  }
  toast(`Filled row ${sh.rows[rowIndex]?.row_label} with ${n} slots`, "success");
}

/** Renumbers slots left to right in every row (asks first: location codes may be printed). */
export function renumberShelf(shelfId: string) {
  const sh = shelfById(getMap(), shelfId);
  if (!sh) return;
  setMap({
    dialog: {
      kind: "confirm",
      title: `Renumber ${sh.name} left to right?`,
      message:
        "Slot numbers in every row will be set to 1, 2, 3… from the left (standing in the aisle facing the shelf). Location codes change, so any printed location labels would need reprinting.",
      confirmLabel: "Renumber",
      onConfirm: async () => {
        const rows = new Map<number, typeof sh.slots>();
        for (const s of sh.slots) rows.set(s.row_index, [...(rows.get(s.row_index) ?? []), s]);
        let changed = 0;
        for (const list of rows.values()) {
          const sorted = list.slice().sort((a, b) => a.col_start - b.col_start);
          for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].slot_no !== i + 1) {
              await patchSlot(shelfId, sorted[i].slot_id, { slot_no: i + 1 }, "Renumber slot");
              changed++;
            }
          }
        }
        toast(
          changed ? `Renumbered ${changed} slot${changed === 1 ? "" : "s"}` : "Already numbered left to right",
          "success",
        );
      },
    },
  });
}

// ---------------------------------------------------------------------------
// parts and locations
// ---------------------------------------------------------------------------

const searchCache = new Map<string, PartSearchResult>();
function invalidateParts() {
  searchCache.clear();
  setMap((s) => ({ partsRev: s.partsRev + 1 }));
}

async function afterLocation(r: LocationWrite) {
  learnParts([r.part]);
  invalidateParts();
  await Promise.all((r.affected_shelf_ids ?? []).map((id) => loadShelf(id)));
}

export async function assignPart(
  part: { part_id: string; part_name: string },
  toSlotId: string,
  opts: { mode?: MoveMode; from_slot_id?: string; par_qty?: number; on_hand_qty?: number } = {},
): Promise<boolean> {
  const mode = opts.mode ?? (opts.from_slot_id ? "move" : "add");
  const body = {
    part_id: part.part_id,
    to_slot_id: toSlotId,
    mode,
    from_slot_id: opts.from_slot_id,
    par_qty: opts.par_qty,
    on_hand_qty: opts.on_hand_qty,
  };
  const label =
    mode === "add" ? `Put ${part.part_name} in a slot` : `${mode[0].toUpperCase()}${mode.slice(1)} ${part.part_name}`;
  try {
    const r = await write(() => api.moveLocation(body), {
      label,
      entity: "location",
      onOk: (x) => {
        learnParts([x.part]);
        invalidateParts();
      },
      pass: ["slot_occupied"],
    });
    if (r) {
      // afterLocation is async (refetches affected shelves); wait for it so callers see fresh data.
      await Promise.all((r.affected_shelf_ids ?? []).map((id) => loadShelf(id)));
      toast(
        `${part.part_name}: ${mode === "add" ? "placed" : mode === "swap" ? "swapped" : mode === "share" ? "now sharing the slot" : "moved"}`,
        "success",
      );
    }
    return !!r;
  } catch (e) {
    const choice = await occupiedDialog(
      e as ApiError,
      opts.from_slot_id ? ["swap", "share", "different", "cancel"] : ["share", "different", "cancel"],
      part.part_name,
    );
    if (choice === "swap" || choice === "share") return assignPart(part, toSlotId, { ...opts, mode: choice });
    if (choice === "different") {
      if (opts.from_slot_id)
        setMap({
          tool: {
            kind: "move-part",
            part_id: part.part_id,
            part_name: part.part_name,
            from_slot_id: opts.from_slot_id,
          },
        });
      toast(
        `Pick another slot for ${part.part_name}${opts.from_slot_id ? " (click it in the front view)" : " (drag it onto another slot)"}.`,
        "info",
      );
    }
    return false;
  }
}

export async function removePart(partId: string, slotId: string, name: string) {
  return write(() => api.deleteLocation({ part_id: partId, slot_id: slotId }), {
    label: `Remove ${name} from slot`,
    entity: "location",
    onOk: (r) => void afterLocation(r),
  });
}

export async function adjustQty(partId: string, slotId: string, delta: number, name: string) {
  return write(() => api.adjustStock({ part_id: partId, slot_id: slotId, delta, reason: "Map" }), {
    label: `${delta > 0 ? "+" : ""}${delta} ${name}`,
    entity: "location",
    onOk: (r) => void afterLocation(r),
  });
}

export async function setOnHand(partId: string, slotId: string, value: number, version: number, name: string) {
  return write(
    () => api.adjustStock({ part_id: partId, slot_id: slotId, set: value, version, reason: "Count (map)" }),
    {
      label: `Count ${name}`,
      entity: "location",
      onOk: (r) => void afterLocation(r),
      conflict: { what: `the count for ${name}`, reload: async () => invalidateParts() },
    },
  );
}

export async function setPar(partId: string, slotId: string, par: number, version: number, name: string) {
  return write(() => api.patchLocation({ part_id: partId, slot_id: slotId, par_qty: par, version }), {
    label: `Par for ${name}`,
    entity: "location",
    onOk: (r) => void afterLocation(r),
    conflict: { what: `the par level for ${name}`, reload: async () => invalidateParts() },
  });
}

export async function patchPart(part: Part, fields: Omit<PartPatch, "version">) {
  return write(() => api.patchPart(part.part_id, { ...fields, version: part.version }), {
    label: `Edit ${part.part_name}`,
    entity: "part",
    onOk: (r) => {
      learnParts([r]);
      invalidateParts();
    },
    conflict: {
      what: part.part_name,
      reload: async () => invalidateParts(),
      overwrite: overwriteFor(async () => {
        const cur = await api.getPart(part.part_id);
        await write(() => api.patchPart(part.part_id, { ...fields, version: cur.version }), {
          label: `Edit ${part.part_name}`,
          entity: "part",
          onOk: () => invalidateParts(),
        });
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// building (admin)
// ---------------------------------------------------------------------------

export async function patchZone(z: Zone, fields: Omit<ZonePatch, "version">, label = `Edit ${z.name}`) {
  const prev = z;
  return write(() => api.patchZone(z.zone_id, { ...fields, version: z.version }), {
    label,
    entity: "zone",
    optimistic: () => {
      setMap((s) => ({ layout: upsertZone(s.layout!, { ...z, ...fields }) }));
      return () => setMap((s) => ({ layout: upsertZone(s.layout!, prev) }));
    },
    onOk: (r) => setMap((s) => ({ layout: upsertZone(s.layout!, r) })),
    conflict: {
      what: z.name,
      reload: reloadBuilding,
      overwrite: overwriteFor(async () => {
        const cur = (await api.listZones()).items.find((x) => x.zone_id === z.zone_id);
        if (cur)
          await write(() => api.patchZone(z.zone_id, { ...fields, version: cur.version }), {
            label,
            entity: "zone",
            onOk: (r) => setMap((s) => ({ layout: upsertZone(s.layout!, r) })),
          });
      }),
    },
  });
}

export async function patchOpening(o: Opening, fields: Omit<OpeningPatch, "version">, label = `Edit opening ${o.tag}`) {
  const prev = o;
  return write(() => api.patchOpening(o.opening_id, { ...fields, version: o.version }), {
    label,
    entity: "opening",
    optimistic: () => {
      setMap((s) => ({ layout: upsertOpening(s.layout!, { ...o, ...fields }) }));
      return () => setMap((s) => ({ layout: upsertOpening(s.layout!, prev) }));
    },
    onOk: (r) => setMap((s) => ({ layout: upsertOpening(s.layout!, r) })),
    conflict: { what: `opening ${o.tag}`, reload: reloadBuilding },
  });
}

// ---------------------------------------------------------------------------
// undo / redo (session), using the API's undo for every recorded event
// ---------------------------------------------------------------------------

async function refreshAfterUndo(r: UndoWrite, entity: string) {
  if (entity === "zone" || entity === "opening") await reloadBuilding();
  await Promise.all((r.affected_shelf_ids ?? []).map((id) => loadShelf(id)));
  if (entity === "location" || entity === "part") invalidateParts();
}

async function undoRedo(from: "undoStack" | "redoStack") {
  const to = from === "undoStack" ? "redoStack" : "undoStack";
  const s = getMap();
  const e = s[from][s[from].length - 1];
  if (!e) return;
  setMap({ [from]: s[from].slice(0, -1) } as never);
  setMap((st) => ({ saving: st.saving + 1 }));
  try {
    const r = await api.undoEvent(e.eventId);
    setMap((st) => ({ [to]: [...st[to], { ...e, eventId: r.event_id! }] }) as never);
    await refreshAfterUndo(r, e.entity);
    toast(`${from === "undoStack" ? "Undid" : "Redid"}: ${e.label}`, "info");
  } catch (err) {
    if (isApiError(err, "undo_stale"))
      toast(`Can't ${from === "undoStack" ? "undo" : "redo"} "${e.label}": it was changed since.`, "warn");
    else if (isApiError(err, "network")) {
      setMap((st) => ({ [from]: [...st[from], e], offline: true }) as never);
      toast("Offline. Try again when the connection is back.", "error");
    } else toast(errorText(err), "error");
  } finally {
    setMap((st) => ({ saving: Math.max(0, st.saving - 1) }));
  }
}

export const undo = () => undoRedo("undoStack");
export const redo = () => undoRedo("redoStack");

// ---------------------------------------------------------------------------
// search-first map
// ---------------------------------------------------------------------------

let searchSeq = 0;
const idleFocus: SearchFocus = { level: "idle", shelfIds: [], slotIds: [], partId: null };

export async function runSearch(q: string, opts: { fly?: boolean } = {}) {
  const fly = opts.fly ?? true;
  const seq = ++searchSeq;
  const query = q.trim();
  if (!query) {
    setMap({ search: { q, status: "idle", items: [], total: 0, focus: idleFocus }, partCardId: null });
    if (fly) {
      setMap({ frontViewOpen: false, selection: null });
      fitAll();
    }
    return;
  }
  setMap((s) => ({ search: { ...s.search, q, status: "loading" } }));
  let items: Part[] = [];
  let total: number;
  try {
    if (isPartId(query as unknown)) {
      try {
        items = [await api.getPart(query)];
      } catch (e) {
        if (!isApiError(e, "not_found")) throw e;
      }
      total = items.length;
    } else {
      const key = query.toLowerCase();
      let r = searchCache.get(key);
      if (!r) {
        r = await api.searchParts({ q: query, limit: 200 });
        searchCache.set(key, r);
      }
      items = r.items;
      total = r.total;
    }
  } catch (e) {
    if (seq !== searchSeq) return;
    setMap((s) => ({
      search: { ...s.search, status: "error", error: errorText(e) },
      offline: isApiError(e, "network") || s.offline,
    }));
    return;
  }
  if (seq !== searchSeq) return;
  learnParts(items);
  const lay = getMap().layout;
  const focus = searchFocus(query, items, new Set(lay?.shelves.map((s) => s.shelf_id)));
  setMap({ search: { q, status: "done", items, total, focus } });
  if (fly) applyFocus(focus);
}

export function applyFocus(f: SearchFocus) {
  const lay = getMap().layout;
  if (!lay) return;
  const shelves = lay.shelves.filter((s) => f.shelfIds.includes(s.shelf_id));
  switch (f.level) {
    case "floor":
      setMap({ frontViewOpen: false, partCardId: null });
      fitBounds(shelvesBounds(shelves, shelfCorners), 1.3, resultsPanelPx());
      break;
    case "shelf":
      select({ kind: "shelf", id: shelves[0].shelf_id }, { fly: true, front: true, leftPx: resultsPanelPx() });
      setMap({ partCardId: f.partId });
      break;
    case "slot": {
      select(
        { kind: "slot", shelfId: shelves[0].shelf_id, id: f.slotIds[0] },
        { fly: true, front: true, leftPx: resultsPanelPx() },
      );
      setMap({ partCardId: f.partId });
      break;
    }
    case "unplaced":
      setMap({ partCardId: f.partId });
      break;
    default:
      break;
  }
}

/** Scanned or pasted prt- ID: jump straight to the part's slots. */
export async function jumpToPart(partId: string) {
  await runSearch(partId);
}

// ---------------------------------------------------------------------------
// deep link: /map/?shelf=<id>&slot=<id>&part=<id>
// ---------------------------------------------------------------------------

export async function applyDeepLink(params: URLSearchParams): Promise<boolean> {
  const shelf = params.get("shelf");
  const slot = params.get("slot");
  const part = params.get("part");
  const lay = getMap().layout;
  if (!lay || (!shelf && !slot && !part)) return false;
  let shelfId = shelf;
  if (slot && !shelfId) shelfId = lay.shelves.find((s) => s.slots.some((x) => x.slot_id === slot))?.shelf_id ?? null;
  if (part) {
    try {
      const p = await api.getPart(part);
      learnParts([p]);
      setMap({
        partCardId: p.part_id,
        search: {
          q: p.part_name,
          status: "done",
          items: [p],
          total: 1,
          focus: searchFocus(p.part_name, [p], new Set(lay.shelves.map((s) => s.shelf_id))),
        },
      });
      if (!shelfId && p.locations.length) {
        const f = searchFocus(p.part_name, [p], new Set(lay.shelves.map((s) => s.shelf_id)));
        applyFocus(f);
        return true;
      }
    } catch {
      toast(`Part ${part} wasn't found.`, "warn");
    }
  }
  if (shelfId && lay.shelves.some((s) => s.shelf_id === shelfId)) {
    if (slot && lay.shelves.find((s) => s.shelf_id === shelfId)!.slots.some((x) => x.slot_id === slot))
      select({ kind: "slot", shelfId, id: slot }, { fly: true, front: true });
    else select({ kind: "shelf", id: shelfId }, { fly: true, front: true });
    if (part) setMap({ partCardId: part });
    return true;
  }
  if (shelf || slot) toast("That shelf or slot isn't on the map.", "warn");
  return !!part;
}

// ---------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------

export function exportSnapshot() {
  const lay = getMap().layout;
  if (!lay) return;
  const snap = {
    format: "suncity-layout-snapshot",
    format_version: 1,
    exported_at: new Date().toISOString(),
    layout: lay,
  };
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `layout-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function parseSnapshot(text: string): Layout {
  const j = JSON.parse(text);
  const lay = (j?.format === "suncity-layout-snapshot" ? j.layout : j) as Layout;
  if (!lay || !Array.isArray(lay.zones) || !Array.isArray(lay.shelves) || !Array.isArray(lay.openings))
    throw new Error("That file isn't a layout snapshot.");
  return lay;
}

/** Admin: replays a snapshot through the API (zones, openings, shelves, slots). Part locations are not replayed. */
export async function importSnapshot(snap: Layout): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      ok++;
    } catch (e) {
      failed.push(`${label}: ${errorText(e)}`);
    }
  };
  const cur = getMap().layout!;
  for (const z of snap.zones) {
    const { zone_id, version: _v, ...fields } = z;
    const existing = cur.zones.find((x) => x.zone_id === zone_id);
    await attempt(`zone ${z.name}`, async () => {
      if (existing) await api.patchZone(zone_id, { ...fields, version: existing.version });
      else await api.createZone(fields);
    });
  }
  for (const o of snap.openings) {
    const { opening_id, version: _v, ...fields } = o;
    const existing = cur.openings.find((x) => x.opening_id === opening_id);
    await attempt(`opening ${o.tag}`, async () => {
      if (existing) await api.patchOpening(opening_id, { ...fields, version: existing.version });
      else await api.createOpening(fields);
    });
  }
  for (const s of snap.shelves) {
    const { shelf_id, version: _v, slots, zone_name: _zn, ...fields } = s;
    const existing = cur.shelves.find((x) => x.shelf_id === shelf_id);
    await attempt(`shelf ${s.name}`, async () => {
      let target: Shelf;
      if (existing) target = await api.patchShelf(shelf_id, { ...fields, version: existing.version });
      else target = await api.createShelf({ ...fields, wall_ref: fields.wall_ref ?? null });
      for (const sl of slots) {
        const ex = target.slots.find((x) => x.slot_id === sl.slot_id);
        if (ex) {
          if (
            ex.row_index !== sl.row_index ||
            ex.col_start !== sl.col_start ||
            ex.width_span !== sl.width_span ||
            ex.height_span !== sl.height_span
          )
            await api.resizeSlot(sl.slot_id, {
              width_span: sl.width_span,
              height_span: sl.height_span,
              col_start: sl.col_start,
              row_index: sl.row_index,
              version: ex.version,
            });
        } else {
          await api.createSlot({
            shelf_id: target.shelf_id,
            row_index: sl.row_index,
            col_start: sl.col_start,
            width_span: sl.width_span,
            height_span: sl.height_span,
            slot_no: sl.slot_no,
            bin_type: sl.bin_type,
            bin_width_in: sl.bin_width_in,
            bin_height_in: sl.bin_height_in,
            bin_depth_in: sl.bin_depth_in,
            bin_color: sl.bin_color,
          });
        }
      }
    });
  }
  await loadLayout(true);
  return { ok, failed };
}

// ---------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------

export function closeDialog() {
  setMap({ dialog: null });
}

export function showDialog(d: DialogState) {
  setMap({ dialog: d });
}

export { cellWidth };
