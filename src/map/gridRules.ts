// Pure rule checks shared by the mock endpoints (and usable by clients for previews).
// Kept separate from the data layer so they're easy to test and extend.

import type { Row, SlotBase } from "../shared/contract";

type GridSlot = Pick<SlotBase, "row_index" | "col_start" | "width_span" | "height_span"> & { slot_id?: string };

export function slotCells(s: GridSlot): string[] {
  const cells: string[] = [];
  for (let r = s.row_index; r < s.row_index + s.height_span; r++) {
    for (let c = s.col_start; c < s.col_start + s.width_span; c++) cells.push(`${r},${c}`);
  }
  return cells;
}

export function slotsOverlap(a: GridSlot, b: GridSlot): boolean {
  return (
    a.col_start < b.col_start + b.width_span &&
    b.col_start < a.col_start + a.width_span &&
    a.row_index < b.row_index + b.height_span &&
    b.row_index < a.row_index + a.height_span
  );
}

/** Slots in `others` that would share a cell with `candidate` (ignoring `excludeId`). */
export function overlappingSlots<T extends GridSlot>(others: T[], candidate: GridSlot, excludeId?: string): T[] {
  return others.filter((o) => o.slot_id !== excludeId && slotsOverlap(o, candidate));
}

/** Why a slot doesn't fit the shelf grid, or null if it fits. */
export function slotBoundsProblem(grid: { cols: number; rows: Row[] }, s: GridSlot): string | null {
  if (!Number.isInteger(s.col_start) || !Number.isInteger(s.width_span) || !Number.isInteger(s.height_span) || !Number.isInteger(s.row_index))
    return "Slot position and size must be whole grid cells";
  if (s.width_span < 1 || s.height_span < 1) return "A slot must be at least 1 cell wide and 1 row tall";
  if (s.col_start < 1) return "Slot starts left of the shelf";
  if (s.col_start + s.width_span - 1 > grid.cols)
    return `Needs columns ${s.col_start}–${s.col_start + s.width_span - 1}; the shelf has ${grid.cols}`;
  if (s.row_index < 0) return "Row doesn't exist";
  if (s.row_index + s.height_span - 1 > grid.rows.length - 1)
    return `Needs ${s.height_span} row(s) from row ${s.row_index === 0 ? "G" : s.row_index}; the shelf has ${grid.rows.length}`;
  return null;
}

/** Problems with a set of rows (sorted, unique elevations, positive clear heights). */
export function rowsProblem(rows: Row[], heightIn: number): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "A shelf needs at least one row";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.row_index !== i) return "Rows must be numbered 0 (G), 1, 2… in order";
    if (!(r.elevation_in >= 0)) return `Row ${r.row_label} elevation must be 0 or more`;
    if (!(r.clear_height_in > 0)) return `Row ${r.row_label} needs a clear height above 0`;
    if (i > 0 && r.elevation_in <= rows[i - 1].elevation_in) return "Each row must sit above the one below it";
  }
  const top = rows[rows.length - 1];
  if (top.elevation_in > heightIn) return "Top row is above the shelf height";
  return null;
}

/** Applies a resize anchor: which corner stays put. */
export function anchoredResize(
  s: GridSlot,
  width_span: number,
  height_span: number,
  anchor: "bottom-left" | "bottom-right" | "top-left" | "top-right" = "bottom-left",
): GridSlot {
  const right = s.col_start + s.width_span - 1;
  const top = s.row_index + s.height_span - 1;
  return {
    slot_id: s.slot_id,
    col_start: anchor.endsWith("right") ? right - width_span + 1 : s.col_start,
    row_index: anchor.startsWith("top") ? top - height_span + 1 : s.row_index,
    width_span,
    height_span,
  };
}

export function shortfall(par: number, onHand: number): number {
  return Math.max(par - onHand, 0);
}

export function locationCode(shelfName: string, rowLabel: string, slotNo: number): string {
  return `${shelfName}-${rowLabel}-${slotNo}`;
}

/** Next unused shelf name after `base` (A1 -> A2 -> A3 …; "Rack" -> "Rack 2"). */
export function nextShelfName(base: string, taken: Set<string>): string {
  const m = /^(.*?)(\d+)$/.exec(base);
  const stem = m ? m[1] : `${base} `;
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (taken.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}
