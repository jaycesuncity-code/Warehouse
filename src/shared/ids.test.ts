import { describe, expect, it } from 'vitest';
import { ID_ALPHABET, ID_PATTERNS, ID_PREFIXES, idKind, isPartId, isSlotId } from './ids';
import { DEMO_DATA } from './mock/demo-data';
import { mintId, randomBody } from './mock/mint';

describe('ID regexes', () => {
  it('accepts a well-formed part id and rejects near misses', () => {
    expect(isPartId('prt-k7m2qx9d')).toBe(true);
    expect(isPartId('prt-K7M2QX9D')).toBe(false); // upper case
    expect(isPartId('prt-k7m2qx9')).toBe(false); // 7 chars
    expect(isPartId('prt-k7m2qx9dd')).toBe(false); // 9 chars
    expect(isPartId('prt-k7m2qx90')).toBe(false); // contains 0
    expect(isPartId('prt-k7m2qx91')).toBe(false); // contains 1
    expect(isPartId('prt-k7m2qxil')).toBe(false); // i and l
    expect(isPartId('prt-k7m2qxo9')).toBe(false); // o
    expect(isPartId('slt-k7m2qx9d')).toBe(false); // wrong prefix
    expect(isPartId(' prt-k7m2qx9d')).toBe(false); // whitespace is the caller's job
    expect(isPartId('prt-k7m2qx9d\n')).toBe(false);
    expect(isPartId('hello')).toBe(false);
    expect(isPartId('OLD-77')).toBe(false);
    expect(isPartId(42)).toBe(false);
    expect(isPartId(null)).toBe(false);
  });

  it('has one pattern per prefix and idKind() tells them apart', () => {
    expect([...ID_PREFIXES].sort()).toEqual(['evt', 'opn', 'prt', 'shf', 'slt', 'zon']);
    for (const p of ID_PREFIXES) {
      expect(ID_PATTERNS[p].test(`${p}-23456789`)).toBe(true);
      expect(idKind(`${p}-abcdefgh`)).toBe(p);
    }
    expect(idKind('abc')).toBeNull();
    expect(isSlotId('slt-4hq8wz2k')).toBe(true);
  });

  it('the alphabet is 31 characters without 0 1 i l o', () => {
    expect(ID_ALPHABET).toHaveLength(31);
    for (const bad of '01ilo') expect(ID_ALPHABET).not.toContain(bad);
  });
});

describe('minting', () => {
  it('mints valid ids from the alphabet, roughly uniformly, and avoids taken ids', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const body = randomBody();
      expect(body).toHaveLength(8);
      for (const ch of body) {
        expect(ID_ALPHABET).toContain(ch);
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    // 32000 draws over 31 symbols ~ 1032 each; modulo bias would skew the first symbols by ~12%.
    for (const ch of ID_ALPHABET) {
      expect(counts.get(ch) ?? 0).toBeGreaterThan(850);
      expect(counts.get(ch) ?? 0).toBeLessThan(1220);
    }
    const taken = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = mintId('slt', taken);
      expect(isSlotId(id)).toBe(true);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe('demo dataset ids', () => {
  it('every demo id is valid and unique', () => {
    const all = [
      ...DEMO_DATA.zones.map((z) => ['zon', z.zone_id]),
      ...DEMO_DATA.openings.map((o) => ['opn', o.opening_id]),
      ...DEMO_DATA.shelves.map((s) => ['shf', s.shelf_id]),
      ...DEMO_DATA.slots.map((s) => ['slt', s.slot_id]),
      ...DEMO_DATA.parts.map((p) => ['prt', p.part_id]),
    ] as ['zon' | 'opn' | 'shf' | 'slt' | 'prt', string][];
    for (const [prefix, id] of all) expect(ID_PATTERNS[prefix].test(id), id).toBe(true);
    expect(new Set(all.map((a) => a[1])).size).toBe(all.length);
  });
});
