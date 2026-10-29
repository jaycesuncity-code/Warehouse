import qrcode from 'qrcode-generator';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Layout, Part } from '../shared/contract';
import { DEMO_DATA } from '../shared/mock/demo-data';
import { handleMockRequest, setMockStorage } from '../shared/mock';
import { resetState } from '../shared/mock/state';
import { plainDirections } from './directions';
import { bboxOf, buildFloorPlan } from './floorplan';
import { checkLabel, decodeQrFromPixels, normalizeLabel } from './scanner';
import { fillFraction, partFitsBin, shortfall, stockStatus } from './stock';
import { parseHash, href } from './router';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  setMockStorage(memoryStorage());
  resetState();
});

const getLayout = () => handleMockRequest('GET', '/api/layout', { role: 'viewer' }).body as Layout;

/** Render a QR code as RGBA pixels, like a camera frame would hold it. */
function qrPixels(text: string, scale = 6, quiet = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  return { data, size };
}

describe('label scanning', () => {
  it('decodes a rendered QR back to the exact prt- ID for every demo part', () => {
    for (const p of DEMO_DATA.parts) {
      const { data, size } = qrPixels(p.part_id);
      expect(decodeQrFromPixels(data, size, size)).toBe(p.part_id);
    }
  });

  it('accepts only text shaped like a part ID', () => {
    const id = DEMO_DATA.parts[0].part_id;
    expect(checkLabel(id)).toEqual({ ok: true, partId: id });
    expect(checkLabel(`  ${id.toUpperCase()}\n`)).toEqual({ ok: true, partId: id });
    for (const bad of [
      '',
      'CU-34-90',
      'https://example.com',
      'prt-',
      'prt-k7m2qx9',
      'prt-k7m2qx9dd',
      'prt-k7m2qx9o',
      'shf-k7m2qx9d',
      'OLD-77',
    ]) {
      expect(checkLabel(bad).ok, bad).toBe(false);
    }
    expect(normalizeLabel(' PRT-ABC ')).toBe('prt-abc');
  });
});

describe('stock status', () => {
  it('Out / Full / Low / OK', () => {
    expect(stockStatus(0, 10, 3)).toBe('out');
    expect(stockStatus(10, 10, 3)).toBe('full');
    expect(stockStatus(12, 10, 3)).toBe('full');
    expect(stockStatus(3, 10, 3)).toBe('low');
    expect(stockStatus(4, 10, 3)).toBe('ok');
    expect(stockStatus(2, 10, null)).toBe('low');
    expect(stockStatus(6, 10, null)).toBe('ok');
  });
  it('shortfall and fill never go negative', () => {
    expect(shortfall(10, 12)).toBe(0);
    expect(shortfall(10, 4)).toBe(6);
    expect(fillFraction(12, 10)).toBe(1);
    expect(fillFraction(5, 10)).toBe(0.5);
    expect(fillFraction(0, 0)).toBe(0);
  });
  it('fit check compares sorted sides and returns null when unknown', () => {
    const bin = { bin_width_in: 4, bin_height_in: 4, bin_depth_in: 4 };
    expect(partFitsBin({ width_in: 5, height_in: 2, depth_in: 2 }, bin)).toBe(false);
    expect(partFitsBin({ width_in: 4, height_in: 2, depth_in: 1 }, bin)).toBe(true);
    expect(partFitsBin({ width_in: null, height_in: 2, depth_in: 1 }, bin)).toBeNull();
    expect(
      partFitsBin(
        { width_in: 1, height_in: 1, depth_in: 1 },
        { bin_width_in: null, bin_height_in: null, bin_depth_in: null },
      ),
    ).toBeNull();
  });
});

describe('plain directions', () => {
  it('reads like a person would say it', () => {
    const layout = getLayout();
    const a1 = layout.shelves.find((s) => s.name === 'A1')!;
    const text = plainDirections(
      { zone_name: 'WAREHOUSE 126', shelf_name: 'A1', row_label: 'G', slot_no: 4 },
      a1,
    );
    expect(text).toBe(
      'Warehouse 126, shelf A1 (west wall, facing east), ground row, 4th slot from the left, standing in the aisle facing the shelf',
    );
    const b1 = layout.shelves.find((s) => s.name === 'B1')!;
    expect(
      plainDirections(
        { zone_name: 'STORAGE - PARTS & TOOLS 121', shelf_name: 'B1', row_label: '2', slot_no: 1 },
        b1,
      ),
    ).toContain(
      'Storage - Parts & Tools 121, shelf B1 (south wall, facing north), row 2 (2 up from the ground), 1st slot',
    );
  });
});

describe('mini floor plan model', () => {
  it('draws WAREHOUSE 126 as 483 x 1203 in with A1 against its west wall, front facing east', () => {
    const layout = getLayout();
    const a1 = layout.shelves.find((s) => s.name === 'A1')!;
    const model = buildFloorPlan(layout, a1.shelf_id, a1.slots[0].slot_id);
    const wh = model.zones.find((z) => z.name === 'WAREHOUSE 126')!;
    expect(wh.focus).toBe(true);
    const [x0, y0, x1, y1] = wh.bbox;
    expect([x1 - x0, y1 - y0]).toEqual([483, 1203]);
    expect([x0, y0]).toEqual([0, 0]);

    const shelf = model.shelves.find((s) => s.name === 'A1')!;
    const [minX, minY, maxX, maxY] = bboxOf(shelf.points);
    expect(minX).toBe(0); // touching the west wall (x = 0)
    expect(maxX - minX).toBe(24); // 24 in deep
    expect(maxY - minY).toBe(96); // 96 in wide, running north-south
    // front edge: on the east face of the shelf, running from the south end to the north end
    expect(shelf.front[0]).toEqual([24, 960]);
    expect(shelf.front[1]).toEqual([24, 864]);
    // the front is on the high-x side, so the shelf faces east
    expect(shelf.front[0][0]).toBe(maxX);
    // the marker sits inside the shelf's footprint
    expect(model.marker![0]).toBeGreaterThan(minX);
    expect(model.marker![0]).toBeLessThan(maxX);
    expect(model.marker![1]).toBeGreaterThan(minY);
    expect(model.marker![1]).toBeLessThan(maxY);
    // framed on the warehouse
    expect(model.viewBox.w).toBeGreaterThan(483);
    expect(model.focusZoneName).toBe('WAREHOUSE 126');
  });

  it('frames the shelf zone for the other demo shelves', () => {
    const layout = getLayout();
    for (const s of layout.shelves) {
      const m = buildFloorPlan(layout, s.shelf_id);
      expect(m.focusZoneName).toBe(s.zone_name);
      const sh = m.shelves.find((x) => x.shelf_id === s.shelf_id)!;
      const [a, b, c, d] = sh.points;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(s.width_in);
      expect(Math.hypot(b[0] - c[0], b[1] - c[1])).toBeCloseTo(s.depth_in);
      expect(d).toBeTruthy();
    }
  });
});

describe('router helpers', () => {
  it('round-trips paths and queries', () => {
    const h = href('/part/prt-abc/move', { slot: 'slt-xyz', empty: null });
    expect(h).toBe('#/part/prt-abc/move?slot=slt-xyz');
    const r = parseHash(h);
    expect(r.segments).toEqual(['part', 'prt-abc', 'move']);
    expect(r.query.get('slot')).toBe('slt-xyz');
    expect(parseHash('').segments).toEqual([]);
  });
});

describe('demo part sanity (used by the demo labels page)', () => {
  it('every demo part answers GET /api/parts/:id', () => {
    for (const p of DEMO_DATA.parts) {
      const res = handleMockRequest('GET', `/api/parts/${p.part_id}`, { role: 'editor' });
      expect(res.status).toBe(200);
      expect((res.body as Part).part_code).toBe(p.part_code);
    }
  });
});
