import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { load, type D1, type Stmt } from '../../functions/lib/database';
import { footprint, insideAnyZone, overlapDepth, zoneForShelf } from '../map/geometry';
import { buildLayout, layoutVersion } from './mock/format';

// Plays the hand-run D1 console SQL (docs/console-sql) batch by batch against a disposable
// SQLite database, the way Jayce pastes it, then reads the layout through the app's D1 loader.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const FORWARD = read('docs/console-sql/2026-11-02-bottom-half-layout.sql');
const ROLLBACK = read('docs/console-sql/2026-11-02-bottom-half-layout-rollback.sql');
const MIGRATIONS = ['0001_parts_catalog.sql', '0002_warehouse.sql', '0003_unverified_building.sql', '0004_packouts_and_retries.sql'];

function batches(sql: string): { title: string; sql: string }[] {
  return sql
    .split(/^-- ===== /m)
    .slice(1)
    .map((chunk) => ({ title: chunk.slice(0, chunk.indexOf('\n')), sql: chunk.slice(chunk.indexOf('\n') + 1) }));
}

function database(withAreaKindMigration: boolean) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of MIGRATIONS) sqlite.exec(read(`migrations/${name}`));
  if (withAreaKindMigration) sqlite.exec(read('migrations/0005_zone_area_kind.sql'));
  return sqlite;
}

/** Minimal D1 adapter over node:sqlite for the app's loader. */
function d1(sqlite: DatabaseSync): D1 {
  const stmt = (sql: string): Stmt & { run(): { results: unknown[] } } => {
    let args: unknown[] = [];
    const self = {
      bind: (...a: unknown[]) => ((args = a), self),
      run: () => ({ results: sqlite.prepare(sql).all(...(args as never[])) }),
      all: async <T,>() => self.run() as { results: T[] },
      first: async <T,>() => (self.run().results[0] ?? null) as T | null,
    };
    return self;
  };
  return {
    prepare: stmt,
    batch: async <T,>(list: Stmt[]) => list.map((s) => (s as ReturnType<typeof stmt>).run()) as { results: T[] }[],
  };
}

const revision = (sqlite: DatabaseSync) =>
  Number((sqlite.prepare('SELECT revision FROM warehouse_meta WHERE id=1').get() as { revision: number }).revision);
const dump = (sqlite: DatabaseSync) =>
  Object.fromEntries(
    ['zones', 'openings', 'shelves', 'shelf_rows', 'slots', 'stock', 'events', 'packouts'].map((t) => [
      t,
      sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(),
    ]),
  );

function runForward(sqlite: DatabaseSync, opts: { expectDuplicateColumn?: boolean } = {}) {
  for (const b of batches(FORWARD)) {
    const before = revision(sqlite);
    if (b.title.startsWith('Batch 1.') && opts.expectDuplicateColumn) {
      expect(() => sqlite.exec(b.sql)).toThrow(/duplicate column name/);
      continue;
    }
    sqlite.exec(b.sql);
    const changesLayout = !b.title.startsWith('Batch 0.') && !b.title.startsWith('Batch 1.');
    expect(revision(sqlite), b.title).toBe(before + (changesLayout ? 1 : 0));
  }
}

describe('2026-11-02 bottom-half console SQL', () => {
  it('keeps every batch to 15 statements or fewer and ends each layout batch with a revision bump', () => {
    for (const b of [...batches(FORWARD), ...batches(ROLLBACK)]) {
      const statements = b.sql.split('\n').filter((line) => line.trim() && !line.startsWith('--'));
      expect(statements.length, b.title).toBeLessThanOrEqual(15);
      expect(b.sql).not.toMatch(/\b(BEGIN|COMMIT)\b/);
      if (/^(Batch [2-7]|R[123])\./.test(b.title)) {
        const last = b.title.startsWith('Batch 7') ? statements[0] : statements.at(-1)!;
        expect(last, b.title).toMatch(/^UPDATE warehouse_meta SET revision = revision \+ 1/);
      }
    }
  });

  it('applies on a production-shaped database, reads back through the app, reruns safely and rolls back exactly', async () => {
    const sqlite = database(false);
    const original = dump(sqlite);
    runForward(sqlite);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const state = await load(d1(sqlite));
    const layout = buildLayout(state);
    expect(layoutVersion(state)).toContain(`#${revision(sqlite)}`);
    const names = layout.shelves.map((s) => s.name).sort();
    expect(names).toHaveLength(46);
    expect(names).toContain('SALT');
    expect(names.filter((n) => n.endsWith('H'))).toEqual(['C6H', 'E4H']);
    expect(names.some((n) => n.includes('-'))).toBe(false);
    const areas = layout.zones.filter((z) => z.area_kind);
    expect(areas.map((z) => [z.name, z.area_kind, z.open_edges])).toEqual([
      ['TOOLS', 'tools', [0, 1, 2, 3]],
      ['PACKOUTS', 'packouts', [0, 1, 2, 3]],
    ]);
    expect(layout.zones.filter((z) => !z.area_kind).every((z) => z.area_kind === null)).toBe(true);

    const salt = layout.shelves.find((s) => s.name === 'SALT')!;
    expect(salt).toMatchObject({ kind: 'floor_area', rows: [{ row_label: 'G', elevation_in: 0 }] });
    expect(salt.slots).toHaveLength(1);
    expect(salt.slots[0]).toMatchObject({ col_start: 1, width_span: salt.cols, part_count: 0 });
    expect(layout.shelves.find((s) => s.name === 'E4H')!.rows.map((r) => [r.row_label, r.elevation_in])).toEqual([
      ['1', 72],
      ['2', 84],
    ]);
    expect(layout.shelves.find((s) => s.name === 'B1')!.rows.map((r) => r.row_label)).toEqual(['G', '1', '2', '3', '4']);
    expect(state.stock).toEqual([]);
    expect(state.events).toEqual([]);

    // Every shelf lies inside the building, sits in the zone that contains it, and only the
    // hanging units overlap the unit below them.
    for (const s of layout.shelves) {
      expect(insideAnyZone(layout.zones, s), s.name).toBe(true);
      const rooms = layout.zones.filter((z) => !z.area_kind);
      expect(zoneForShelf(rooms, s)!.zone_id, s.name).toBe(s.zone_id);
      expect(s.notes).toMatch(/traced from sketch, dimensions unverified/);
    }
    const overlaps: string[] = [];
    for (const a of layout.shelves)
      for (const b of layout.shelves)
        if (a.name < b.name && overlapDepth(footprint(a), footprint(b)) > 0.25) overlaps.push(`${a.name}/${b.name}`);
    expect(overlaps.sort()).toEqual(['E4/E4H']);

    const moved = Object.fromEntries(
      layout.openings.filter((o) => ['121-120', "8'"].includes(o.tag ?? '')).map((o) => [o.tag, [o.x1_in, o.x2_in, o.version]]),
    );
    expect(moved).toEqual({ '121-120': [60.5, 111.5, 2], "8'": [110.5, 279, 2] });

    // Rerunning every batch changes nothing but the revision.
    const once = dump(sqlite);
    runForward(sqlite, { expectDuplicateColumn: true });
    expect(dump(sqlite)).toEqual(once);

    // The rollback removes exactly what was added and restores the openings' coordinates and notes.
    for (const b of batches(ROLLBACK)) sqlite.exec(b.sql);
    const after = dump(sqlite);
    const strip = (rows: unknown[]) => (rows as Record<string, unknown>[]).map(({ area_kind: _a, version: _v, ...r }) => r);
    expect(strip(after.zones)).toEqual(strip(original.zones));
    expect(strip(after.openings)).toEqual(strip(original.openings));
    for (const t of ['shelves', 'shelf_rows', 'slots', 'stock', 'events', 'packouts']) expect(after[t], t).toEqual(original[t]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    sqlite.close();
  });

  it('applies on a fresh database that already has migration 0005 (batch 1 is then a harmless duplicate)', async () => {
    const sqlite = database(true);
    runForward(sqlite, { expectDuplicateColumn: true });
    expect(buildLayout(await load(d1(sqlite))).shelves).toHaveLength(46);
    sqlite.close();
  });

  it('refuses to roll back over bins laid out in the app instead of orphaning them', () => {
    const sqlite = database(false);
    runForward(sqlite);
    sqlite.exec(
      "INSERT INTO slots VALUES ('slt-22222222',(SELECT shelf_id FROM shelves WHERE name='B1'),1,0,1,4,1,'bin',NULL,NULL,NULL,NULL,1,1)",
    );
    const [check] = batches(ROLLBACK);
    expect(sqlite.prepare(check.sql.split('\n').find((l) => l.startsWith('SELECT slot_id'))!).all()).toHaveLength(1);
    expect(() => sqlite.exec(batches(ROLLBACK)[1].sql)).toThrow(/FOREIGN KEY/);
    sqlite.close();
  });
});
