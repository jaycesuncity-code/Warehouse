import type { MockState } from '../../src/shared/mock/state';
import type { ApiEvent, EndpointName, PartSearchResponse, Role } from '../../src/shared/contract';
import {
  partSearchOptions,
  rankPartCandidates,
  type PartSearchCandidate,
} from '../../src/shared/mock/endpoints/parts';
import { buildPart } from '../../src/shared/mock/format';
export interface Stmt {
  bind(...args: unknown[]): Stmt;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface D1 {
  prepare(query: string): Stmt;
  batch<T = Record<string, unknown>>(statements: Stmt[]): Promise<{ results: T[] }[]>;
}
export type Env = {
  'warehouse-db'?: D1;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  WAREHOUSE_EDITORS?: string;
  WAREHOUSE_ADMINS?: string;
};
export type Ctx = { request: Request; env: Env };
export interface IdempotencyRecord {
  key: string;
  actor: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  response_headers?: Record<string, string>;
}
export interface LoadScope {
  endpoint: EndpointName;
  params?: Record<string, string>;
  query?: URLSearchParams;
  body?: unknown;
}
/** A multi-stage read must retry if another transaction changed its candidate set. */
export class SnapshotConflict extends Error {
  constructor() {
    super('Warehouse changed while resolving search results.');
  }
}
type RecordRow = Record<string, unknown>;
const tables = [
  'zones',
  'openings',
  'shelves',
  'slots',
  'parts',
  'stock',
  'employees',
  'packouts',
  'events',
] as const;
type Table = (typeof tables)[number];
const primaryKeys: Record<Table, string[]> = {
  zones: ['zone_id'],
  openings: ['opening_id'],
  shelves: ['shelf_id'],
  slots: ['slot_id'],
  parts: ['part_id'],
  stock: ['part_id', 'slot_id'],
  employees: ['employee_id'],
  packouts: ['kit_id'],
  events: ['event_id'],
};
const jsonColumns = new Set(['polygon_in', 'open_edges', 'aliases', 'before', 'after', 'issued_contents']);
const boolColumns = new Set(['active', 'verified']);
const quoted = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
function decode(row: RecordRow): RecordRow {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => k !== 'created_at' && k !== 'updated_at' && !k.startsWith('_'))
      .map(([k, v]) => [k, jsonColumns.has(k) ? JSON.parse(String(v)) : boolColumns.has(k) ? !!v : v]),
  );
}
interface Selection {
  sql: string;
  args: unknown[];
}
type Selections = Record<Table | 'shelf_rows', Selection>;
const select = (sql: string, ...args: unknown[]): Selection => ({ sql, args });
const emptySelection = (table: string) => select(`SELECT * FROM ${table} WHERE 0`);
/** All queries in a request batch observe one relational snapshot and its revision. */
async function snapshot(db: D1, selections: Selections): Promise<MockState> {
  const names = [...tables, 'shelf_rows'] as const;
  const results = await db.batch([
    ...names.map((name) => db.prepare(selections[name].sql).bind(...selections[name].args)),
    db.prepare('SELECT revision,updated_at FROM warehouse_meta WHERE id=1'),
  ]);
  const data = Object.fromEntries(
    tables.map((table, index) => [table, results[index].results.map(decode)]),
  ) as Record<Table, RecordRow[]>;
  const groups = new Map<string, RecordRow[]>();
  for (const { shelf_id, ...row } of results[tables.length].results) {
    const id = String(shelf_id);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  for (const shelf of data.shelves) shelf.rows = groups.get(String(shelf.shelf_id)) ?? [];
  const meta = results[names.length].results[0];
  if (!meta || !Number.isSafeInteger(meta.revision) || Number(meta.revision) < 1)
    throw new Error('Missing or invalid warehouse revision');
  return {
    ...data,
    schema: 1,
    seq: Number(meta.revision),
    updated_at: String(meta.updated_at),
  } as unknown as MockState;
}
function allSelections(includeEvents: boolean): Selections {
  return {
    ...Object.fromEntries(
      tables.map((table) => [
        table,
        table === 'events' && !includeEvents ? emptySelection(table) : select(`SELECT * FROM ${table}`),
      ]),
    ),
    shelf_rows: select('SELECT * FROM shelf_rows ORDER BY row_index'),
  } as Selections;
}
/** Complete selected-part locations and co-located kit contents, without unrelated history. */
function partSelections(matchedParts: Selection, extraSlots: string[] = []): Selections {
  const cte = `WITH chosen_parts AS (${matchedParts.sql}),
 chosen_slots AS (SELECT slot_id FROM stock WHERE part_id IN (SELECT part_id FROM chosen_parts) UNION SELECT value FROM json_each(?)),
 chosen_shelves AS (SELECT DISTINCT shelf_id FROM slots WHERE slot_id IN (SELECT slot_id FROM chosen_slots)),
 related_parts AS (SELECT part_id FROM chosen_parts UNION SELECT part_id FROM stock WHERE slot_id IN (SELECT slot_id FROM chosen_slots))`;
  const args = [...matchedParts.args, JSON.stringify(extraSlots)];
  const scoped = (sql: string) =>
    select(`${cte} ${sql}${sql.includes('ORDER BY') ? '' : ' ORDER BY rowid'}`, ...args);
  return {
    zones: scoped(
      'SELECT * FROM zones WHERE zone_id IN (SELECT zone_id FROM shelves WHERE shelf_id IN (SELECT shelf_id FROM chosen_shelves))',
    ),
    openings: emptySelection('openings'),
    shelves: scoped('SELECT * FROM shelves WHERE shelf_id IN (SELECT shelf_id FROM chosen_shelves)'),
    shelf_rows: scoped(
      'SELECT * FROM shelf_rows WHERE shelf_id IN (SELECT shelf_id FROM chosen_shelves) ORDER BY row_index',
    ),
    slots: scoped('SELECT * FROM slots WHERE slot_id IN (SELECT slot_id FROM chosen_slots)'),
    parts: scoped('SELECT * FROM parts WHERE part_id IN (SELECT part_id FROM related_parts)'),
    stock: scoped('SELECT * FROM stock WHERE slot_id IN (SELECT slot_id FROM chosen_slots)'),
    employees: scoped(
      'SELECT * FROM employees WHERE employee_id IN (SELECT employee_id FROM packouts WHERE slot_id IN (SELECT slot_id FROM chosen_slots))',
    ),
    packouts: scoped('SELECT * FROM packouts WHERE slot_id IN (SELECT slot_id FROM chosen_slots)'),
    events: emptySelection('events'),
  };
}
function searchSelection(query: URLSearchParams, columns = 'p.part_id'): Selection {
  const { tokens, category, unassigned } = partSearchOptions(query);
  // SQLite lower() is ASCII-only: include non-ASCII candidates for exact shared JS scoring.
  // json_each decodes aliases so quotes/escapes preserve their existing search behavior.
  const hay = `coalesce(p.part_name,'') || ' | ' || coalesce(p.part_code,'') || ' | ' || coalesce(p.category,'') || ' | ' || coalesce(p.description,'') || ' | ' || coalesce((SELECT group_concat(value,' ') FROM json_each(p.aliases)),'')`;
  return select(
    `SELECT ${columns} FROM parts p WHERE p.active=1
 AND (?='' OR lower(coalesce(p.category,''))=? OR coalesce(p.category,'') GLOB '*[^ -~]*')
 AND (?=0 OR NOT EXISTS(SELECT 1 FROM stock st WHERE st.part_id=p.part_id AND st.active=1))
 AND ((${hay}) GLOB '*[^ -~]*' OR NOT EXISTS(SELECT 1 FROM json_each(?) token WHERE instr(lower(${hay}),token.value)=0)) ORDER BY p.rowid`,
    category,
    category,
    unassigned ? 1 : 0,
    JSON.stringify(tokens),
  );
}
/** Paginate scored candidates before loading locations, co-located stock, and kit custody. */
export async function searchPartsFromDatabase(
  db: D1,
  query: URLSearchParams,
  role: Role,
): Promise<PartSearchResponse> {
  const options = partSearchOptions(query);
  const columns = options.tokens.length
    ? 'p.part_id,p.part_code,p.part_name,p.category,p.description,p.aliases,p.active'
    : "p.part_id,p.part_name,p.category,p.active,'' AS part_code,'' AS description,'[]' AS aliases";
  const selection = searchSelection(query, columns);
  const results = await db.batch([
    db.prepare(selection.sql).bind(...selection.args),
    db.prepare('SELECT revision FROM warehouse_meta WHERE id=1'),
  ]);
  const candidates = results[0].results.map((row) => decode(row) as unknown as PartSearchCandidate);
  const ranked = rankPartCandidates(candidates, options);
  const page = ranked.slice(options.offset, options.offset + options.limit);
  const ids = page.map((part) => part.part_id);
  const state = await snapshot(
    db,
    partSelections(select('SELECT value AS part_id FROM json_each(?)', JSON.stringify(ids))),
  );
  if (state.seq !== results[1].results[0]?.revision) throw new SnapshotConflict();
  const parts = new Map(state.parts.map((part) => [part.part_id, part]));
  return {
    items: ids.map((id) => buildPart(state, parts.get(id)!, role)),
    total: ranked.length,
    limit: options.limit,
    offset: options.offset,
  };
}
/** Default is a full diagnostic snapshot; HTTP requests select only their needed state. */
export async function load(db: D1, scope?: LoadScope): Promise<MockState> {
  if (!scope) return snapshot(db, allSelections(true));
  if (scope.endpoint === 'getPart')
    return snapshot(
      db,
      partSelections(select('SELECT part_id FROM parts WHERE part_id=?', scope.params?.part_id ?? '')),
    );
  if (scope.endpoint === 'adjustStock' || scope.endpoint === 'patchLocation') {
    const body = scope.body && typeof scope.body === 'object' ? (scope.body as RecordRow) : {};
    return snapshot(
      db,
      partSelections(select('SELECT part_id FROM parts WHERE part_id=?', String(body.part_id ?? '')), [
        String(body.slot_id ?? ''),
      ]),
    );
  }
  if (scope.endpoint === 'searchParts') {
    const selection = searchSelection(scope.query ?? new URLSearchParams());
    const candidates = await db.batch([
      db.prepare(selection.sql).bind(...selection.args),
      db.prepare('SELECT revision FROM warehouse_meta WHERE id=1'),
    ]);
    const ids = candidates[0].results.map((row) => String(row.part_id));
    const state = await snapshot(
      db,
      partSelections(select('SELECT value AS part_id FROM json_each(?)', JSON.stringify(ids))),
    );
    if (state.seq !== candidates[1].results[0]?.revision) throw new SnapshotConflict();
    return state;
  }
  const selections = allSelections(false);
  if (scope.endpoint === 'events') {
    for (const table of [...tables, 'shelf_rows'] as const) selections[table] = emptySelection(table);
    const q = scope.query ?? new URLSearchParams();
    const entity = q.get('entity') ?? '';
    const id = q.get('entity_id') ?? '';
    const limit = Math.min(Math.max(parseInt(q.get('limit') ?? '50', 10) || 50, 1), 200);
    selections.events = select(
      `SELECT * FROM (SELECT rowid AS _order,* FROM events WHERE (?='' OR entity=?) AND (?='' OR entity_id=? OR substr(entity_id,1,length(?)+1)=?||'|' OR substr(entity_id,-length(?)-1)='|'||?) ORDER BY rowid DESC LIMIT ?) ORDER BY _order`,
      entity,
      entity,
      id,
      id,
      id,
      id,
      id,
      id,
      limit,
    );
  } else if (scope.endpoint === 'undoEvent')
    selections.events = select('SELECT * FROM events WHERE event_id=?', scope.params?.event_id ?? '');
  else if (
    scope.endpoint === 'listZones' ||
    scope.endpoint === 'listOpenings' ||
    scope.endpoint === 'listEmployees'
  ) {
    const only =
      scope.endpoint === 'listZones' ? 'zones' : scope.endpoint === 'listOpenings' ? 'openings' : 'employees';
    for (const table of [...tables, 'shelf_rows'] as const)
      if (table !== only) selections[table] = emptySelection(table);
  }
  return snapshot(db, selections);
}
function key(table: Table, row: RecordRow): string {
  return primaryKeys[table].map((column) => String(row[column])).join('|');
}
function encoded(column: string, value: unknown): unknown {
  return jsonColumns.has(column)
    ? JSON.stringify(value)
    : boolColumns.has(column)
      ? Number(value)
      : (value ?? null);
}
function writeRow(db: D1, table: Table, row: RecordRow, existed: boolean): Stmt {
  const columns = Object.keys(row);
  if (!existed) {
    // Newly minted IDs must never upsert over an unseen existing record on a collision.
    return db
      .prepare(
        `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      .bind(...columns.map((column) => encoded(column, row[column])));
  }
  const keys = primaryKeys[table];
  const updated = columns.filter((column) => !keys.includes(column) && column !== 'created_at');
  return db
    .prepare(
      `UPDATE ${quoted(table)} SET ${updated.map((column) => `${quoted(column)}=?`).join(',')} WHERE ${keys.map((column) => `${quoted(column)}=?`).join(' AND ')}`,
    )
    .bind(...updated.map((column) => encoded(column, row[column])), ...keys.map((column) => row[column]));
}
/** Revision CAS, changed rows, audit history and receipt commit or roll back together. */
export async function persist(
  db: D1,
  before: MockState,
  after: MockState,
  receipt?: IdempotencyRecord,
): Promise<void> {
  const changes: Stmt[] = [];
  const timestamp = new Date().toISOString();
  for (const table of tables) {
    const old = new Map((before[table] as unknown as RecordRow[]).map((row) => [key(table, row), row]));
    for (const raw of after[table] as unknown as RecordRow[]) {
      const existing = old.get(key(table, raw));
      if (JSON.stringify(existing) === JSON.stringify(raw)) continue;
      const row = { ...raw };
      if (table === 'shelves') delete row.rows;
      if (table === 'parts') {
        if (!existing) row.created_at = timestamp;
        row.updated_at = timestamp;
      }
      changes.push(writeRow(db, table, row, !!existing));
      if (table === 'shelves' && JSON.stringify(existing?.rows) !== JSON.stringify(raw.rows)) {
        changes.push(db.prepare('DELETE FROM shelf_rows WHERE shelf_id=?').bind(row.shelf_id));
        for (const rr of raw.rows as RecordRow[])
          changes.push(
            db
              .prepare(
                'INSERT INTO shelf_rows(shelf_id,row_index,row_label,elevation_in,clear_height_in) VALUES(?,?,?,?,?)',
              )
              .bind(row.shelf_id, rr.row_index, rr.row_label, rr.elevation_in, rr.clear_height_in),
          );
      }
    }
  }
  if (receipt)
    changes.push(
      db
        .prepare(
          'INSERT INTO idempotency_requests(actor,key,request_hash,response_status,response_body,response_headers,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          receipt.actor,
          receipt.key,
          receipt.request_hash,
          receipt.response_status,
          JSON.stringify(receipt.response_body),
          JSON.stringify(receipt.response_headers ?? {}),
          timestamp,
        ),
    );
  if (!changes.length) return;
  // A stale or missing metadata row raises an actual constraint error; a zero-row
  // UPDATE alone would otherwise allow the rest of the batch to commit.
  const guard = db
    .prepare(
      `INSERT INTO warehouse_meta(id,revision,updated_at) VALUES(1,(SELECT revision+1 FROM warehouse_meta WHERE id=1 AND revision=?),?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at`,
    )
    .bind(before.seq, timestamp);
  await db.batch([guard, ...changes]);
}
export async function readIdempotency(
  db: D1,
  retryKey: string,
  actor: string,
): Promise<IdempotencyRecord | null> {
  const row = await db
    .prepare(
      'SELECT actor,key,request_hash,response_status,response_body,response_headers FROM idempotency_requests WHERE actor=? AND key=?',
    )
    .bind(actor, retryKey)
    .first<RecordRow>();
  if (!row) return null;
  return {
    actor: String(row.actor),
    key: String(row.key),
    request_hash: String(row.request_hash),
    response_status: Number(row.response_status),
    response_body: JSON.parse(String(row.response_body)),
    response_headers: JSON.parse(String(row.response_headers)) as Record<string, string>,
  };
}
export function publicEvents(events: ApiEvent[], viewer: boolean): ApiEvent[] {
  return viewer ? events.map((event) => ({ ...event, before: {}, after: {} })) : events;
}
