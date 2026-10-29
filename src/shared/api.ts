/**
 * One API client with the same methods in "mock" and "live" mode (see config.ts).
 * Every method mirrors one endpoint in contract section 7, returns typed data, and throws ApiError on 4xx/5xx
 * (including the 409 slot_occupied and version_conflict payloads).
 */
import { API_BASE, MODE } from './config';
import type {
  LocationPatch,
  AdjustStockRequest,
  AdjustStockResponse,
  ApiErrorBody,
  CreatePartRequest,
  CreateShelfRequest,
  CreateSlotRequest,
  DeleteLocationRequest,
  DeleteShelfRequest,
  ErrorCode,
  EventsParams,
  EventsResponse,
  HttpMethod,
  Layout,
  LocationMutationResponse,
  MoveLocationRequest,
  Me,
  OkResponse,
  Opening,
  OpeningInput,
  OpeningMutationResponse,
  Part,
  PartMutationResponse,
  PartSearchParams,
  PartSearchResponse,
  PatchOpeningRequest,
  PatchPartRequest,
  PatchShelfRequest,
  PatchSlotRequest,
  PatchZoneRequest,
  RegisterPartsRequest,
  RegisterPartsResponse,
  ResizeSlotRequest,
  Shelf,
  ShelfListResponse,
  ShelfMutationResponse,
  SlotConflict,
  SlotMutationResponse,
  UndoResponse,
  Zone,
  ZoneInput,
  ZoneMutationResponse,
} from './contract';
import { mockTransport, type Transport } from './mock';

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  /** Contract error code, or 'network' / 'server_error' when there was no proper error body. */
  readonly error: ErrorCode | 'network' | 'server_error';
  readonly payload: ApiErrorBody;

  constructor(
    status: number,
    payload: ApiErrorBody | { error: 'network' | 'server_error'; message: string },
  ) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.error = payload.error;
    this.payload = payload as ApiErrorBody;
  }

  get code() { return this.error; }
  get body() { return this.payload; }
  is(code: ErrorCode): boolean {
    return this.error === code;
  }
  /** 409 slot_occupied: who is in the way. */
  get conflicts(): SlotConflict[] {
    return this.payload.conflicts ?? [];
  }
  /** 400 validation: field -> reason. */
  get fields(): Record<string, string> {
    return this.payload.fields ?? {};
  }
  /** 409 version_conflict: the row as it is now. */
  current<T = unknown>(): T | undefined {
    return this.payload.current as T | undefined;
  }
}

export const isApiError = (e: unknown, code?: ApiError["error"]): e is ApiError => e instanceof ApiError && (code === undefined || e.error === code);

// ---------------------------------------------------------------------------------------------
// Live transport (Cloudflare Pages Functions)
// ---------------------------------------------------------------------------------------------

export const liveTransport: Transport = {
  async request(method, pathAndQuery, opts = {}) {
    let res: Response;
    try {
      res = await fetch(pathAndQuery, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new ApiError(0, { error: 'network', message: "Can't reach the server. Check your connection." });
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase() === 'etag' ? 'ETag' : k] = v));
    const type = res.headers.get('content-type') ?? '';
    let body: unknown = null;
    if (res.status !== 304)
      body = type.includes('json') ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, body, headers };
  },
};

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export type LayoutResult =
  { notModified: false; layout: Layout; etag: string } | { notModified: true; layout: null; etag: string };

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function createApi(transport: Transport, base: string = API_BASE) {
  async function call<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await transport.request(method, `${base}${path}`, { body, headers });
    if (res.status >= 400) {
      const b = res.body as Partial<ApiErrorBody> | null;
      if (b && typeof b === 'object' && typeof b.error === 'string')
        throw new ApiError(res.status, b as ApiErrorBody);
      throw new ApiError(res.status, {
        error: 'server_error',
        message: `The server answered ${res.status}.`,
      });
    }
    return res.body as T;
  }
  const enc = encodeURIComponent;

  return {
    // identity
    me: () => call<Me>('GET', '/me'),

    // layout (ETag aware)
    async getLayout(ifNoneMatch?: string | null): Promise<LayoutResult> {
      const res = await transport.request('GET', `${base}/layout`, {
        headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
      });
      if (res.status === 304) return { notModified: true, layout: null, etag: ifNoneMatch ?? '' };
      if (res.status >= 400) {
        const b = res.body as ApiErrorBody;
        throw new ApiError(
          res.status,
          b?.error ? b : { error: 'server_error', message: `The server answered ${res.status}.` },
        );
      }
      const layout = res.body as Layout;
      return { notModified: false, layout, etag: res.headers.ETag ?? `"${layout.layout_version}"` };
    },

    // parts
    getPart: (partId: string) => call<Part>('GET', `/parts/${enc(partId)}`),
    searchParts: (p: PartSearchParams = {}) => call<PartSearchResponse>('GET', `/parts${qs(p)}`),
    createPart: (b: CreatePartRequest) => call<PartMutationResponse>('POST', '/parts', b),
    patchPart: (partId: string, b: PatchPartRequest) =>
      call<PartMutationResponse>('PATCH', `/parts/${enc(partId)}`, b),
    registerParts: (b: RegisterPartsRequest) => call<RegisterPartsResponse>('POST', '/parts/register', b),

    patchLocation: (b: LocationPatch) => call<LocationMutationResponse>('PATCH', '/locations', b),
    // stock + locations
    adjustStock: (b: AdjustStockRequest) => call<AdjustStockResponse>('POST', '/stock/adjust', b),
    moveLocation: (b: MoveLocationRequest) => call<LocationMutationResponse>('POST', '/locations/move', b),
    deleteLocation: (b: DeleteLocationRequest) => call<LocationMutationResponse>('DELETE', '/locations', b),

    // shelves
    listShelves: () => call<ShelfListResponse>('GET', '/shelves'),
    getShelf: (shelfId: string) => call<Shelf>('GET', `/shelves/${enc(shelfId)}`),
    createShelf: (b: CreateShelfRequest) => call<ShelfMutationResponse>('POST', '/shelves', b),
    patchShelf: (shelfId: string, b: PatchShelfRequest) =>
      call<ShelfMutationResponse>('PATCH', `/shelves/${enc(shelfId)}`, b),
    deleteShelf: (shelfId: string, b: DeleteShelfRequest = {}) =>
      call<OkResponse>('DELETE', `/shelves/${enc(shelfId)}`, b),
    duplicateShelf: (shelfId: string) =>
      call<ShelfMutationResponse>('POST', `/shelves/${enc(shelfId)}/duplicate`, {}),

    // slots
    createSlot: (b: CreateSlotRequest) => call<SlotMutationResponse>('POST', '/slots', b),
    patchSlot: (slotId: string, b: PatchSlotRequest) =>
      call<SlotMutationResponse>('PATCH', `/slots/${enc(slotId)}`, b),
    resizeSlot: (slotId: string, b: ResizeSlotRequest) =>
      call<SlotMutationResponse>('POST', `/slots/${enc(slotId)}/resize`, b),
    deleteSlot: (slotId: string) => call<OkResponse>('DELETE', `/slots/${enc(slotId)}`, {}),

    // building geometry
    listZones: () => call<{ items: Zone[] }>('GET', '/zones'),
    createZone: (b: ZoneInput) => call<ZoneMutationResponse>('POST', '/zones', b),
    patchZone: (zoneId: string, b: PatchZoneRequest) =>
      call<ZoneMutationResponse>('PATCH', `/zones/${enc(zoneId)}`, b),
    listOpenings: () => call<{ items: Opening[] }>('GET', '/openings'),
    createOpening: (b: OpeningInput) => call<OpeningMutationResponse>('POST', '/openings', b),
    patchOpening: (openingId: string, b: PatchOpeningRequest) =>
      call<OpeningMutationResponse>('PATCH', `/openings/${enc(openingId)}`, b),

    // history
    listEvents: (p: EventsParams = {}) => call<EventsResponse>('GET', `/events${qs(p)}`),
    undoEvent: (eventId: string) => call<UndoResponse>('POST', `/events/${enc(eventId)}/undo`, {}),

    // export
    exportCsv: () => call<string>('GET', '/export.csv'),
  };
}

export type ApiClient = ReturnType<typeof createApi>;

/** The app-wide client. MODE (config.ts) picks the mock or the real /api. */
export const api: ApiClient = createApi(MODE === 'mock' ? mockTransport : liveTransport);
