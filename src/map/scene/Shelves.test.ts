import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LayoutShelf } from '../../shared/contract';
import { evenRows } from '../units';
import { shelfBoxMatrix } from './common';
import { buildShelfInstances, postBaseIn } from './Shelves';

const opts = {
  colorBy: 'fill' as const,
  hideEmpty: false,
  unverifiedOnly: false,
  zoneOf: () => ({ color: '#ffffff', verified: false }),
};

function shelf(over: Partial<LayoutShelf>): LayoutShelf {
  return {
    shelf_id: 'shf-22222222',
    name: 'E4',
    zone_id: 'zon-22222222',
    zone_name: 'Test room',
    kind: 'shelving',
    location_type: 'primary',
    x_in: 100,
    y_in: 200,
    rotation_deg: 0,
    width_in: 48,
    depth_in: 24,
    height_in: 84,
    cols: 12,
    rows: evenRows(5, 84),
    wall_ref: null,
    notes: '',
    version: 1,
    slots: [],
    ...over,
  } as LayoutShelf;
}

/** Bottom and top heights of an instance box. */
function span(m: THREE.Matrix4): [number, number] {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return [p.y - s.y / 2, p.y + s.y / 2];
}

const hanging = [
  { row_index: 0, row_label: '1', elevation_in: 72, clear_height_in: 11 },
  { row_index: 1, row_label: '2', elevation_in: 84, clear_height_in: 12 },
];

describe('shelf frame', () => {
  it('starts posts at the floor while the lowest deck is at or below 24 in', () => {
    expect(postBaseIn(evenRows(5, 84))).toBe(0);
    expect(postBaseIn([{ elevation_in: 24 }])).toBe(0);
    expect(postBaseIn([])).toBe(0);
  });

  it('draws ordinary shelves exactly as before (posts and pick box from the floor)', () => {
    const sh = shelf({});
    const built = buildShelfInstances([sh], opts);
    const expected = [0.75, sh.width_in - 0.75].flatMap((u) =>
      [0.75, sh.depth_in - 0.75].map((v) =>
        shelfBoxMatrix(new THREE.Matrix4(), sh, u - 0.75, u + 0.75, v - 0.75, v + 0.75, 0, sh.height_in),
      ),
    );
    expect(built.posts.map((m) => m.elements)).toEqual(expected.map((m) => m.elements));
    expect(built.hits[0].elements).toEqual(
      shelfBoxMatrix(new THREE.Matrix4(), sh, 0, sh.width_in, 0, sh.depth_in, 0, sh.height_in).elements,
    );
    expect(built.decks).toHaveLength(5);
  });

  it('stops a hanging shelf frame at the underside of its lowest deck', () => {
    const sh = shelf({ name: 'E4H', height_in: 96, rows: hanging });
    expect(postBaseIn(sh.rows)).toBe(71);
    const built = buildShelfInstances([sh], opts);
    expect(built.posts).toHaveLength(4);
    for (const m of built.posts) {
      const [bottom, top] = span(m);
      expect(bottom).toBeCloseTo(71, 6);
      expect(top).toBeCloseTo(96, 6);
    }
    const [hitBottom, hitTop] = span(built.hits[0]);
    expect(hitBottom).toBeCloseTo(71, 6);
    expect(hitTop).toBeCloseTo(96, 6);
    expect(built.decks).toHaveLength(2);
    // The same instance counts as any other shelf: hanging storage adds no extra draw calls.
    expect(built.lips).toHaveLength(1);
  });

  it('leaves floor areas on the floor', () => {
    const sh = shelf({
      name: 'SALT',
      kind: 'floor_area',
      height_in: 48,
      rows: [{ row_index: 0, row_label: 'G', elevation_in: 0, clear_height_in: 48 }],
    });
    const built = buildShelfInstances([sh], opts);
    expect(built.posts).toHaveLength(0);
    expect(span(built.hits[0])[0]).toBeCloseTo(0, 6);
  });
});
