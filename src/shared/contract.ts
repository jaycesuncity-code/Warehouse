/**
 * Shared Contract v2: TypeScript types for every shape, error and endpoint.
 *
 * Source of truth for the scan app (B), the 3D map (C) and the backend (A, mirrors this in functions/).
 * Lengths are inches (REAL, rounded to 1/16). Map coordinates: origin = NW corner of WAREHOUSE 126,
 * X east, Y south. All JSON is snake_case.
 *
 * Anything marked "SYNC" is something the written contract did not define; see the README / final note.
 */

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export type Role = 'viewer' | 'editor' | 'admin';

export type IdPrefix = 'prt' | 'zon' | 'opn' | 'shf' | 'slt' | 'evt' | 'emp' | 'kit';

export type PartId = string; // prt-xxxxxxxx (legacy ids may exist, so display code must not assume the regex)
export type ZoneId = string;
export type OpeningId = string;
export type ShelfId = string;
export type SlotId = string;
export type EventId = string;

export const DEPARTMENTS = [
  'HVAC Service',
  'HVAC Install',
  'HVAC New Construction',
  'Plumbing Service',
  'Plumbing Install',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export type LocationType = 'primary' | 'overstock' | 'packout';

export type ShelfKind = 'shelving' | 'pallet_rack' | 'cabinet' | 'bench' | 'floor_area';
export type BinType = 'bin' | 'box' | 'tote' | 'loose' | 'drawer';
export type OpeningKind = 'door' | 'overhead' | 'opening';
/** A clickable floor area (no walls) drawn inside a room. Null for ordinary rooms. */
export type AreaKind = 'tools' | 'packouts';
export const AREA_KINDS: readonly AreaKind[] = ['tools', 'packouts'];

/** A point in map inches: [x, y]. */
export type Point = [number, number];

// ---------------------------------------------------------------------------------------------
// Entities (contract section 6)
// ---------------------------------------------------------------------------------------------

export interface Me {
  email: string;
  name: string;
  role: Role;
}

export interface Zone {
  zone_id: ZoneId;
  name: string;
  room_no: string | null;
  polygon_in: Point[];
  open_edges: number[];
  wall_height_in: number | null;
  notes: string;
  verified: boolean;
  version: number;
  /** Set for clickable floor areas (Tools, Packouts); these list every edge in open_edges. */
  area_kind: AreaKind | null;
}

export interface Opening {
  opening_id: OpeningId;
  kind: OpeningKind;
  tag: string | null;
  x1_in: number;
  y1_in: number;
  x2_in: number;
  y2_in: number;
  height_in: number;
  zone_id: ZoneId | null;
  notes: string;
  verified: boolean;
  version: number;
}

export interface ShelfRow {
  row_index: number;
  row_label: string; // 'G', '1', '2', ...
  /** Top of this row's deck above the finished floor. */
  elevation_in: number;
  /** Usable height above the deck. */
  clear_height_in: number;
}

export interface SlotPart {
  part_id: PartId;
  part_name: string;
  part_code: string;
  on_hand_qty: number;
  par_qty: number;
}

export interface SlotGeometry {
  slot_id: SlotId;
  slot_no: number;
  location_code: string;
  row_index: number;
  col_start: number;
  width_span: number;
  height_span: number;
  bin_type: BinType | null;
  bin_width_in: number | null;
  bin_height_in: number | null;
  bin_depth_in: number | null;
  bin_color: string | null;
  version: number;
}

/** A slot as returned inside GET /api/shelves/:shelf_id (with its occupants). */
export interface Slot extends SlotGeometry {
  low?: boolean;
  parts: SlotPart[];
}

export interface ShelfGeometry {
  location_type?: LocationType;
  shelf_id: ShelfId;
  name: string;
  zone_id: ZoneId;
  zone_name: string;
  kind: ShelfKind;
  /** Front-left corner as seen standing in the aisle facing the shelf. */
  x_in: number;
  y_in: number;
  /** Clockwise on the map (Y down). 0 = front faces south, 90 = west, 180 = north, 270 = east. */
  rotation_deg: number;
  width_in: number;
  depth_in: number;
  height_in: number;
  cols: number;
  rows: ShelfRow[];
  wall_ref: string | null;
  notes: string;
  version: number;
}

export interface Shelf extends ShelfGeometry {
  slots: Slot[];
}

/** A slot inside GET /api/layout: aggregate numbers instead of full parts. */
export interface LayoutSlot extends SlotGeometry {
  departments: string[];
  part_count: number;
  on_hand_total: number;
  par_total: number;
  low: boolean;
  part_ids: PartId[];
}

export interface LayoutShelf extends ShelfGeometry {
  slots: LayoutSlot[];
}

export interface Layout {
  layout_version: string;
  zones: Zone[];
  openings: Opening[];
  shelves: LayoutShelf[];
}

export interface CoLocatedPart {
  part_id: PartId;
  part_name: string;
}

/** One part in one slot. */
export interface Location {
  location_type?: LocationType;
  issued_kit_id?: string | null;
  slot_id: SlotId;
  location_code: string;
  zone_id: ZoneId;
  zone_name: string;
  shelf_id: ShelfId;
  shelf_name: string;
  row_label: string;
  row_index: number;
  slot_no: number;
  col_start: number;
  width_span: number;
  height_span: number;
  par_qty: number;
  on_hand_qty: number;
  counted_at: string | null;
  counted_by: string | null;
  version: number;
  co_located_parts: CoLocatedPart[];
}

export interface Part {
  part_id: PartId;
  part_code: string;
  part_name: string;
  category: string | null;
  description: string;
  department: string | null;
  unit: string;
  /** SYNC: the server should omit/null cost for `viewer`. The UI hides it for viewers either way. */
  cost: number | null;
  sale_price: number | null;
  reorder_point: number | null;
  width_in: number | null;
  height_in: number | null;
  depth_in: number | null;
  weight_lb: number | null;
  /** SYNC: search also matches aliases; the contract lists the search field but not the column. */
  aliases?: string[];
  active: boolean;
  version: number;
  par_total: number;
  on_hand_total: number;
  available_total?: number;
  issued_total?: number;
  locations: Location[];
}

export interface Employee {
  employee_id: string;
  name: string;
  email: string;
  active: boolean;
  version: number;
}
export interface PackoutRecord {
  kit_id: string;
  name: string;
  slot_id: string;
  status: 'available' | 'issued';
  employee_id: string | null;
  issued_at: string | null;
  issued_contents: { part_id: string; qty: number }[];
  active: boolean;
  version: number;
}
export interface Packout extends PackoutRecord {
  location_code: string;
  shelf_id: string;
  employee_name: string | null;
  contents: (SlotPart & {version: number})[];
}
export interface PackoutMutationResponse extends MutationBase { kit: Packout }

export interface ApiEvent {
  event_id: EventId;
  at: string;
  by: string;
  action: string;
  entity: string;
  entity_id: string;
  /** SYNC: mock events store keyed row snapshots here ("table:id" -> row | null). Opaque to clients. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  undone_by: EventId | null;
}

// ---------------------------------------------------------------------------------------------
// Errors (contract section 8)
// ---------------------------------------------------------------------------------------------

export type ErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'slot_occupied'
  | 'version_conflict'
  | 'slot_out_of_bounds'
  | 'slot_not_empty'
  | 'shelf_not_empty'
  | 'undo_stale';

export interface SlotConflictPart {
  part_id: PartId;
  part_name: string;
  on_hand_qty: number;
}

export interface SlotConflict {
  slot_id: SlotId;
  location_code: string;
  parts: SlotConflictPart[];
}

export interface ApiErrorBody {
  slots?: {slot_id: string; location_code: string; reason: string}[];
  error: ErrorCode;
  message: string;
  /** 400 validation */
  fields?: Record<string, string>;
  /** 409 slot_occupied */
  conflicts?: SlotConflict[];
  /** 409 version_conflict: the row as it is now (Location, Slot, Shelf, Part, Zone or Opening shape) */
  current?: unknown;
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  slot_occupied: 409,
  version_conflict: 409,
  slot_out_of_bounds: 409,
  slot_not_empty: 409,
  shelf_not_empty: 409,
  undo_stale: 409,
};

// ---------------------------------------------------------------------------------------------
// Requests and responses (contract section 7)
//
// SYNC: the contract does not define response bodies. Every mutation here returns `event_id` so the
// UI can offer Undo; the rest of each envelope is defined below. Workstream A should match these.
// ---------------------------------------------------------------------------------------------

export interface MutationBase {
  event_id: EventId;
}

// --- parts ---
export interface PartSearchParams {
  unassigned?: boolean;
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
}
export interface PartSearchResponse {
  items: Part[];
  total: number;
  limit: number;
  offset: number;
}
export interface PartInput {
  part_code: string;
  part_name: string;
  category?: string | null;
  description?: string;
  department?: string | null;
  unit?: string;
  cost?: number | null;
  sale_price?: number | null;
  reorder_point?: number | null;
  width_in?: number | null;
  height_in?: number | null;
  depth_in?: number | null;
  weight_lb?: number | null;
  aliases?: string[];
}
export type CreatePartRequest = PartInput;
export type PatchPartRequest = Partial<PartInput> & { version: number };
export interface PartMutationResponse extends MutationBase {
  part: Part;
}
export interface RegisterPartsRequest {
  rows: PartInput[];
}
export interface RegisterPartsResponse {
  results: {
    index: number;
    status: 'reused' | 'new' | 'conflict';
    part_id: PartId | null;
    message?: string;
  }[];
}

// --- stock ---
export interface AdjustStockRequest {
  part_id: PartId;
  slot_id: SlotId;
  /** Relative change. Always safe (never needs a version). */
  delta?: number;
  /** Absolute count. Requires the location's `version`. Stamps counted_at / counted_by. */
  set?: number;
  reason?: string;
  version?: number;
}
export interface AdjustStockResponse extends MutationBase {
  location: Location;
  par_total: number;
  on_hand_total: number;
}

// --- locations ---
export type MoveMode = 'move' | 'add' | 'swap' | 'share';
export interface MoveLocationRequest {
  part_id: PartId;
  from_slot_id?: SlotId;
  to_slot_id: SlotId;
  mode: MoveMode;
  par_qty?: number;
  on_hand_qty?: number;
}
export interface DeleteLocationRequest {
  part_id: PartId;
  slot_id: SlotId;
}
export interface LocationMutationResponse extends MutationBase {
  affected_shelf_ids: string[];
  part: Part;
  /** For swap: the parts that were displaced into the old slot. */
  displaced_parts?: CoLocatedPart[];
}

// --- shelves ---
export interface ShelfListItem {
  shelf_id: ShelfId;
  name: string;
  kind: ShelfKind;
  slot_count: number;
  part_count: number;
}
export interface ShelfGroup {
  zone_id: ZoneId;
  zone_name: string;
  shelves: ShelfListItem[];
}
export interface ShelfListResponse {
  groups: ShelfGroup[];
}
export interface CreateShelfRequest {
  location_type?: LocationType;
  name: string;
  zone_id: ZoneId;
  kind?: ShelfKind;
  x_in: number;
  y_in: number;
  rotation_deg: number;
  width_in: number;
  depth_in: number;
  height_in: number;
  cols: number;
  rows: ShelfRow[];
  wall_ref?: string | null;
  notes?: string;
}
export type PatchShelfRequest = Partial<CreateShelfRequest> & { version: number; force?: boolean };
export interface ShelfMutationResponse extends MutationBase {
  shelf: Shelf;
}
export interface DeleteShelfRequest {
  force?: boolean;
}

// --- slots ---
export interface CreateSlotRequest {
  slot_no?: number;
  shelf_id: ShelfId;
  row_index: number;
  col_start: number;
  width_span: number;
  height_span: number;
  bin_type?: BinType | null;
  bin_width_in?: number | null;
  bin_height_in?: number | null;
  bin_depth_in?: number | null;
  bin_color?: string | null;
}
export interface PatchSlotRequest {
  version: number;
  slot_no?: number;
  bin_type?: BinType | null;
  bin_width_in?: number | null;
  bin_height_in?: number | null;
  bin_depth_in?: number | null;
  bin_color?: string | null;
}
/** The corner that stays fixed when a slot changes size. Default: bottom-left (grows right and up). */
export type ResizeAnchor = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export interface ResizeSlotRequest {
  width_span: number;
  height_span: number;
  col_start?: number;
  row_index?: number;
  anchor?: ResizeAnchor;
  version: number;
}
export interface SlotMutationResponse extends MutationBase {
  shelf_id: string;
  slot: Slot;
}
export interface OkResponse extends MutationBase {
  ok: true;
}

// --- zones / openings ---
export type ZoneInput = Pick<
  Zone,
  'name' | 'room_no' | 'polygon_in' | 'open_edges' | 'wall_height_in' | 'notes'
> &
  Partial<Pick<Zone, 'verified' | 'area_kind'>>;
export type PatchZoneRequest = Partial<ZoneInput> & { version: number };
export interface ZoneMutationResponse extends MutationBase {
  zone: Zone;
}
export type OpeningInput = Omit<Opening, 'opening_id' | 'version' | 'verified'> &
  Partial<Pick<Opening, 'verified'>>;
export type PatchOpeningRequest = Partial<OpeningInput> & { version: number };
export interface OpeningMutationResponse extends MutationBase {
  opening: Opening;
}

// --- events ---
export interface EventsParams {
  entity?: string;
  entity_id?: string;
  limit?: number;
}
export interface EventsResponse {
  items: ApiEvent[];
}
export interface UndoResponse extends MutationBase {
  affected_shelf_ids: string[];
  undone: ApiEvent;
}

// ---------------------------------------------------------------------------------------------
// Endpoint table (documentation + mock role checks)
// ---------------------------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface EndpointSpec {
  method: HttpMethod;
  /** Express-style path, `:param` for path parameters. */
  path: string;
  /** Minimum role. */
  role: 'any' | 'editor' | 'admin';
}

export const ENDPOINTS = {
  listEmployees: { method: 'GET', path: '/api/employees', role: 'any' },
  createEmployee: { method: 'POST', path: '/api/employees', role: 'editor' },
  patchEmployee: { method: 'PATCH', path: '/api/employees/:employee_id', role: 'editor' },
  listPackouts: { method: 'GET', path: '/api/packouts', role: 'any' },
  createPackout: { method: 'POST', path: '/api/packouts', role: 'editor' },
  issuePackout: { method: 'POST', path: '/api/packouts/:kit_id/issue', role: 'editor' },
  returnPackout: { method: 'POST', path: '/api/packouts/:kit_id/return', role: 'editor' },
  replenishPackout: { method: 'POST', path: '/api/packouts/:kit_id/replenish', role: 'editor' },
  me: { method: 'GET', path: '/api/me', role: 'any' },
  layout: { method: 'GET', path: '/api/layout', role: 'any' },
  getPart: { method: 'GET', path: '/api/parts/:part_id', role: 'any' },
  searchParts: { method: 'GET', path: '/api/parts', role: 'any' },
  createPart: { method: 'POST', path: '/api/parts', role: 'editor' },
  patchPart: { method: 'PATCH', path: '/api/parts/:part_id', role: 'editor' },
  registerParts: { method: 'POST', path: '/api/parts/register', role: 'editor' },
  adjustStock: { method: 'POST', path: '/api/stock/adjust', role: 'editor' },
  moveLocation: { method: 'POST', path: '/api/locations/move', role: 'editor' },
  patchLocation: {method:'PATCH', path:'/api/locations',role:'editor'},
  deleteLocation: { method: 'DELETE', path: '/api/locations', role: 'editor' },
  listShelves: { method: 'GET', path: '/api/shelves', role: 'any' },
  getShelf: { method: 'GET', path: '/api/shelves/:shelf_id', role: 'any' },
  createShelf: { method: 'POST', path: '/api/shelves', role: 'editor' },
  patchShelf: { method: 'PATCH', path: '/api/shelves/:shelf_id', role: 'editor' },
  deleteShelf: { method: 'DELETE', path: '/api/shelves/:shelf_id', role: 'editor' },
  duplicateShelf: { method: 'POST', path: '/api/shelves/:shelf_id/duplicate', role: 'editor' },
  createSlot: { method: 'POST', path: '/api/slots', role: 'editor' },
  patchSlot: { method: 'PATCH', path: '/api/slots/:slot_id', role: 'editor' },
  resizeSlot: { method: 'POST', path: '/api/slots/:slot_id/resize', role: 'editor' },
  deleteSlot: { method: 'DELETE', path: '/api/slots/:slot_id', role: 'editor' },
  listZones: { method: 'GET', path: '/api/zones', role: 'any' },
  createZone: { method: 'POST', path: '/api/zones', role: 'admin' },
  patchZone: { method: 'PATCH', path: '/api/zones/:zone_id', role: 'admin' },
  listOpenings: { method: 'GET', path: '/api/openings', role: 'any' },
  createOpening: { method: 'POST', path: '/api/openings', role: 'admin' },
  patchOpening: { method: 'PATCH', path: '/api/openings/:opening_id', role: 'admin' },
  events: { method: 'GET', path: '/api/events', role: 'any' },
  undoEvent: { method: 'POST', path: '/api/events/:event_id/undo', role: 'editor' },
  exportCsv: { method: 'GET', path: '/api/export.csv', role: 'editor' },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointName = keyof typeof ENDPOINTS;

/** Rank used for role checks: viewer < editor < admin. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function roleAtLeast(role: Role, needed: 'any' | 'editor' | 'admin'): boolean {
  if (needed === 'any') return true;
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

/** Built-in defaults named in the contract. */
export const DEFAULT_WALL_HEIGHT_IN = 192;
export const DEFAULT_DOOR_HEIGHT_IN = 84;
export const DEFAULT_OVERHEAD_HEIGHT_IN = 168;

export type Row = ShelfRow;
export type ShelfBase = ShelfGeometry;
export type ShelfCreate = CreateShelfRequest;
export type ShelfPatch = PatchShelfRequest;
export type SlotCreate = CreateSlotRequest;
export type SlotPatch = PatchSlotRequest;
export type PartPatch = PatchPartRequest;
export type PartSearchResult = PartSearchResponse;
export type OpeningPatch = PatchOpeningRequest;
export type ZonePatch = PatchZoneRequest;
export type EventRecord = ApiEvent;
export type SlotWrite = Slot & MutationBase & { shelf_id: string };
export type LocationWrite = LocationMutationResponse;
export type UndoWrite = UndoResponse;
export interface LocationPatch { part_id: string; slot_id: string; par_qty: number; version: number }

export type SlotBase = SlotGeometry;
export type SlotPartRef = SlotPart;
