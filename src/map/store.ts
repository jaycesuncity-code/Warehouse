// Map state (Zustand). Components subscribe with selectors; actions live in actions.ts.

import { create } from "zustand";
import type { Layout, LayoutShelf, Me, Part, Shelf, ShelfBase, SlotConflict } from "../shared/contract";
import type { ColorBy } from "./colors";
import type { SnapGrid, WarningConfig } from "./geometry";
import { DEFAULT_WARNINGS } from "./geometry";
import { DEFAULT_SIZE, type PresetKey, type ShelfSize } from "./presets";
import type { SearchFocus } from "./search";

export type ViewMode = "orbit" | "walk" | "plan";

export type Selection =
  | { kind: "shelf"; id: string }
  | { kind: "slot"; shelfId: string; id: string }
  | { kind: "zone"; id: string }
  | { kind: "opening"; id: string }
  | null;

export interface CameraGoal {
  /** Map inches; h = height above floor. */
  center: { x: number; y: number; h: number };
  /** Half-size of the thing to frame (inches). */
  radius: number;
  /** Orbit view: look at it from this map direction (e.g. a shelf's front). */
  from?: { x: number; y: number };
  /** Plan view: keep this many screen pixels on the left free (search results panel). */
  leftPx?: number;
  seq: number;
}

export interface FailedEdit {
  id: number;
  label: string;
  message: string;
  retry: () => Promise<unknown>;
}

export interface UndoEntry {
  label: string;
  eventId: string;
  entity: string;
}

export type DialogState =
  | { kind: "version"; what: string; reload: () => Promise<void>; overwrite?: () => Promise<void> }
  | {
      kind: "occupied";
      conflicts: SlotConflict[];
      movingName?: string;
      allow: ("swap" | "share" | "different" | "cancel")[];
      resolve: (c: "swap" | "share" | "different" | "cancel") => void;
    }
  | {
      kind: "out_of_bounds";
      title: string;
      slots: { slot_id: string; location_code: string; reason: string }[];
      onFix?: () => Promise<void>;
    }
  | {
      kind: "shelf_not_empty";
      shelfName: string;
      message: string;
      conflicts: SlotConflict[];
      canForce: boolean;
      onForce: () => Promise<void>;
      onOpen: () => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | null;

export type Tool =
  | null
  | { kind: "add-shelf"; preset: PresetKey }
  | { kind: "move-part"; part_id: string; part_name: string; from_slot_id: string };

export type SearchStatus = "idle" | "loading" | "done" | "error";

export interface SearchState {
  q: string;
  status: SearchStatus;
  items: Part[];
  total: number;
  focus: SearchFocus;
  error?: string;
}

export interface ViewOptions {
  cutaway: boolean;
  xray: boolean;
  isolateZone: string | null;
  hideEmpty: boolean;
}

export type MobilePanel = null | "tree" | "inspector" | "parts" | "results";

export interface MapState {
  me: Me | null;
  layout: Layout | null;
  etag: string | null;
  loadError: string | null;

  view: ViewMode;
  editMode: boolean;
  snap: SnapGrid;
  snapEdges: boolean;
  colorBy: ColorBy;
  unverifiedOnly: boolean;
  viewOpts: ViewOptions;
  surveyInput: boolean;
  warnCfg: WarningConfig;

  selection: Selection;
  frontViewOpen: boolean;
  partCardId: string | null;
  leftTab: "layout" | "parts";
  mobilePanel: MobilePanel;

  drafts: Record<string, Partial<ShelfBase>>;
  dragId: string | null;
  tool: Tool;
  lastSize: ShelfSize;
  lastRotation: number;

  search: SearchState;
  cameraGoal: CameraGoal | null;
  cursor: { x: number; y: number } | null;

  saving: number;
  lastSavedAt: number | null;
  offline: boolean;
  failed: FailedEdit[];
  dialog: DialogState;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  shelfDetail: Record<string, Shelf>;
  deptCache: Record<string, string>;
  /** Bumped whenever parts/locations change, so open part cards refetch. */
  partsRev: number;
  reducedMotion: boolean;
  toast: { seq: number; text: string; kind: "info" | "success" | "error" | "warn"; undo?: () => void } | null;
}

const emptyFocus: SearchFocus = { level: "idle", shelfIds: [], slotIds: [], partId: null };

const prefersReducedMotion = () => {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
};

export const useMap = create<MapState>()(() => ({
  me: null,
  layout: null,
  etag: null,
  loadError: null,

  view: "plan",
  editMode: false,
  snap: 1,
  snapEdges: true,
  colorBy: "fill",
  unverifiedOnly: false,
  viewOpts: { cutaway: false, xray: false, isolateZone: null, hideEmpty: false },
  surveyInput: false,
  warnCfg: DEFAULT_WARNINGS,

  selection: null,
  frontViewOpen: false,
  partCardId: null,
  leftTab: "layout",
  mobilePanel: null,

  drafts: {},
  dragId: null,
  tool: null,
  lastSize: DEFAULT_SIZE,
  lastRotation: 0,

  search: { q: "", status: "idle", items: [], total: 0, focus: emptyFocus },
  cameraGoal: null,
  cursor: null,

  saving: 0,
  lastSavedAt: null,
  offline: false,
  failed: [],
  dialog: null,
  undoStack: [],
  redoStack: [],

  shelfDetail: {},
  deptCache: {},
  partsRev: 0,
  reducedMotion: prefersReducedMotion(),
  toast: null,
}));

export const getMap = () => useMap.getState();
export const setMap = (p: Partial<MapState> | ((s: MapState) => Partial<MapState>)) => useMap.setState(p);

// ---------------- derived helpers ----------------

export const canEdit = (s: Pick<MapState, "me">) => s.me?.role === "editor" || s.me?.role === "admin";
export const isAdmin = (s: Pick<MapState, "me">) => s.me?.role === "admin";
export const editing = (s: Pick<MapState, "me" | "editMode">) => s.editMode && canEdit(s);

export function shelfById(s: Pick<MapState, "layout">, id: string | null | undefined): LayoutShelf | undefined {
  if (!id) return undefined;
  return s.layout?.shelves.find((x) => x.shelf_id === id);
}

/** Shelf with any live drag/preview draft applied. */
export function effectiveShelf(s: Pick<MapState, "layout" | "drafts">, id: string): LayoutShelf | undefined {
  const sh = shelfById(s, id);
  if (!sh) return undefined;
  const d = s.drafts[id];
  return d ? { ...sh, ...d } : sh;
}

export function selectedShelfId(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === "shelf") return sel.id;
  if (sel.kind === "slot") return sel.shelfId;
  return null;
}

let toastSeq = 0;
export function toast(text: string, kind: "info" | "success" | "error" | "warn" = "info", undo?: () => void) {
  setMap({ toast: { seq: ++toastSeq, text, kind, undo } });
}

let goalSeq = 0;
export function flyTo(goal: Omit<CameraGoal, "seq">) {
  setMap({ cameraGoal: { ...goal, seq: ++goalSeq } });
}
