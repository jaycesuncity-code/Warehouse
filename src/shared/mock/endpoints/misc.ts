import { getMockMe } from '../session';
import { activeStockForPart, buildLayout, buildLocation, layoutVersion } from '../format';
import { ok, type Handler } from '../types';

export const getMe: Handler = (c) => ok(getMockMe(c.role));

export const getLayout: Handler = (c) => {
  const etag = `"${layoutVersion(c.state)}"`;
  return ok(buildLayout(c.state), 200, { ETag: etag });
};

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/export.csv: one row per part per slot, full location path. Parts with no location get one blank-location row. */
export const exportCsv: Handler = (c) => {
  const header = [
    'part_id',
    'part_code',
    'part_name',
    'category',
    'department',
    'unit',
    'cost',
    'sale_price',
    'reorder_point',
    'zone',
    'shelf',
    'row',
    'slot_no',
    'location_code',
    'slot_id',
    'par_qty',
    'on_hand_qty',
    'counted_at',
  ];
  const lines = [header.join(',')];
  for (const p of c.state.parts.filter((x) => x.active)) {
    const base = [
      p.part_id,
      p.part_code,
      p.part_name,
      p.category,
      p.department,
      p.unit,
      p.cost,
      p.sale_price,
      p.reorder_point,
    ];
    const rows = activeStockForPart(c.state, p.part_id).map((r) => buildLocation(c.state, r));
    if (!rows.length) lines.push([...base, '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
    for (const l of rows) {
      lines.push(
        [
          ...base,
          l.zone_name,
          l.shelf_name,
          l.row_label,
          l.slot_no,
          l.location_code,
          l.slot_id,
          l.par_qty,
          l.on_hand_qty,
          l.counted_at,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return ok(lines.join('\n') + '\n', 200, { 'Content-Type': 'text/csv; charset=utf-8' });
};
