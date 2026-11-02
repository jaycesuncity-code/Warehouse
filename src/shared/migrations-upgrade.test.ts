import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

describe('forward migrations preserve populated warehouse records', () => {
  it('retains catalog identities, inventory, dimensions, audit links, and verification state', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys=ON');
      db.exec(migration('0001_parts_catalog.sql'));
      db.exec(`
        INSERT INTO parts VALUES
          ('prt-22222222','000-A','Existing fitting',1,7,'2023-01-02T03:04:05Z','2024-01-02T03:04:05Z'),
          ('legacy-part-0042','RETIRED-B','Retired identity',0,3,'2022-01-02T03:04:05Z','2024-01-02T03:04:05Z');
        INSERT INTO part_audit VALUES
          ('legacy-audit-1','prt-22222222','registered','legacy@example.test','2023-01-02T03:04:05Z');
      `);
      const originalCatalog = db.prepare('SELECT * FROM parts ORDER BY part_id').all();
      const originalCatalogAudit = db.prepare('SELECT * FROM part_audit').all();

      db.exec(migration('0002_warehouse.sql'));
      db.exec(`
        INSERT INTO zones VALUES ('zon-22222222','Existing measured room','EXISTING','[[0,0],[200,0],[200,200],[0,200]]','[]',120,'Existing field verification',1,5,1);
        INSERT INTO shelves VALUES ('shf-22222222','Legacy rack','zon-22222222','shelving',12,24,0,96,24,72,4,NULL,'Preserve this rack',8,1);
        INSERT INTO shelf_rows VALUES ('shf-22222222',0,'G',4,60);
        INSERT INTO slots VALUES ('slt-22222222','shf-22222222',1,0,1,1,1,'bin',20,10,20,'gray',4,1);
        INSERT INTO stock VALUES ('prt-22222222','slt-22222222',20,17,'2024-03-04T05:06:07Z','counter@example.test',9,1);
        INSERT INTO events VALUES ('evt-22222222','2024-03-04T05:06:07Z','counter@example.test','count','location','prt-22222222|slt-22222222','{}','{}','Legacy stock count',NULL);
        UPDATE parts SET category='Fittings',aliases='["original alias"]',cost=3.25,sale_price=5.5 WHERE part_id='prt-22222222';
        UPDATE warehouse_meta SET revision=42,updated_at='2024-03-04T05:06:07Z';
      `);
      const preservedTables = [
        'parts',
        'part_audit',
        'shelves',
        'shelf_rows',
        'slots',
        'stock',
        'events',
        'warehouse_meta',
      ];
      const before = new Map(
        preservedTables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]),
      );

      db.exec(migration('0003_unverified_building.sql'));
      db.exec(migration('0004_packouts_and_retries.sql'));
      const zonesBeforeAreaKind = db.prepare('SELECT * FROM zones ORDER BY zone_id').all();
      const openingsBeforeAreaKind = db.prepare('SELECT * FROM openings ORDER BY opening_id').all();
      db.exec(migration('0005_zone_area_kind.sql'));

      for (const name of preservedTables) {
        const after = db.prepare(`SELECT * FROM ${name}`).all();
        if (name === 'shelves') {
          expect(after).toEqual(before.get(name)!.map((row) => ({ ...row, location_type: 'primary' })));
        } else {
          expect(after, `${name} changed during the additive upgrade`).toEqual(before.get(name));
        }
      }
      expect(
        db
          .prepare(
            'SELECT part_id,part_code,part_name,active,version,created_at,updated_at FROM parts ORDER BY part_id',
          )
          .all(),
      ).toEqual(originalCatalog);
      expect(db.prepare('SELECT * FROM part_audit').all()).toEqual(originalCatalogAudit);
      expect(
        db.prepare("SELECT verified,version,notes FROM zones WHERE zone_id='zon-22222222'").get(),
      ).toEqual({ verified: 1, version: 5, notes: 'Existing field verification' });
      expect(
        db.prepare("SELECT count(*) AS n FROM zones WHERE zone_id!='zon-22222222' AND verified=0").get(),
      ).toEqual({ n: 9 });
      expect(db.prepare('SELECT count(*) AS n FROM openings WHERE verified=0').get()).toEqual({ n: 18 });
      for (const name of ['employees', 'packouts', 'idempotency_requests']) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${name}`).get()).toEqual({ n: 0 });
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

      // 0005 adds a nullable area_kind: every existing room keeps its values and stays an ordinary room.
      expect(db.prepare('SELECT * FROM zones ORDER BY zone_id').all()).toEqual(
        zonesBeforeAreaKind.map((row) => ({ ...row, area_kind: null })),
      );
      expect(db.prepare('SELECT * FROM openings ORDER BY opening_id').all()).toEqual(openingsBeforeAreaKind);
      db.prepare(
        "INSERT INTO zones VALUES ('zon-33333333','TOOLS',NULL,'[[0,0],[10,0],[10,10],[0,10]]','[0,1,2,3]',NULL,'',0,1,1,'tools')",
      ).run();
      db.prepare("UPDATE zones SET area_kind='packouts' WHERE zone_id='zon-33333333'").run();
      db.prepare("UPDATE zones SET area_kind=NULL WHERE zone_id='zon-33333333'").run();
      expect(() => db.prepare("UPDATE zones SET area_kind='office' WHERE zone_id='zon-33333333'").run()).toThrow(
        /CHECK/,
      );

      // The added custody schema must retain its foreign keys and unique active-bin constraint.
      expect(() =>
        db
          .prepare(
            "INSERT INTO packouts(kit_id,name,slot_id) VALUES('kit-22222222','Unknown bin','missing-slot')",
          )
          .run(),
      ).toThrow(/FOREIGN KEY/);
      db.prepare("UPDATE shelves SET location_type='packout' WHERE shelf_id='shf-22222222'").run();
      db.prepare(
        "INSERT INTO packouts(kit_id,name,slot_id) VALUES('kit-22222222','Existing bin','slt-22222222')",
      ).run();
      expect(() =>
        db
          .prepare(
            "INSERT INTO packouts(kit_id,name,slot_id) VALUES('kit-33333333','Same bin','slt-22222222')",
          )
          .run(),
      ).toThrow(/UNIQUE/);
      expect(() =>
        db
          .prepare(
            "UPDATE packouts SET status='issued',employee_id='missing-employee',issued_at='2026-01-01T00:00:00Z'",
          )
          .run(),
      ).toThrow(/FOREIGN KEY/);
      expect(() => db.prepare("UPDATE shelves SET location_type='unsupported'").run()).toThrow(/CHECK/);
      expect(db.prepare('SELECT on_hand_qty,par_qty,version FROM stock').get()).toEqual({
        on_hand_qty: 17,
        par_qty: 20,
        version: 9,
      });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
