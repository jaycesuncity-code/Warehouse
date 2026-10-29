/**
 * Shelf grid helpers shared by the mock "server rules" and the UI (resize preview, free-slot checks).
 * A slot occupies cells: columns col_start .. col_start+width_span-1, rows row_index .. row_index+height_span-1.
 * Two active slots on one shelf never share a cell (contract section 4).
 */
import type { ResizeAnchor, SlotGeometry } from './contract';

export interface GridRect {
  row_index: number;
  col_start: number;
  width_span: number;
  height_span: number;
}

export const rectOf = (s: GridRect): GridRect => ({
  row_index: s.row_index,
  col_start: s.col_start,
  width_span: s.width_span,
  height_span: s.height_span,
});

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  const colsOverlap = a.col_start < b.col_start + b.width_span && b.col_start < a.col_start + a.width_span;
  const rowsOverlap = a.row_index < b.row_index + b.height_span && b.row_index < a.row_index + a.height_span;
  return colsOverlap && rowsOverlap;
}

export function cellsOf(r: GridRect): string[] {
  const out: string[] = [];
  for (let row = r.row_index; row < r.row_index + r.height_span; row++) {
    for (let col = r.col_start; col < r.col_start + r.width_span; col++) out.push(`${row}:${col}`);
  }
  return out;
}

/** Other slots whose cells collide with `rect`. */
export function findOverlaps<T extends GridRect & { slot_id: string }>(
  rect: GridRect,
  slots: T[],
  excludeSlotId?: string,
): T[] {
  return slots.filter((s) => s.slot_id !== excludeSlotId && rectsOverlap(rect, s));
}

export function withinGrid(rect: GridRect, cols: number, rowCount: number): boolean {
  return (
    rect.width_span >= 1 &&
    rect.height_span >= 1 &&
    rect.col_start >= 1 &&
    rect.row_index >= 0 &&
    rect.col_start + rect.width_span - 1 <= cols &&
    rect.row_index + rect.height_span <= rowCount
  );
}

/**
 * New position when a slot changes size. The anchor is the corner that stays put:
 * bottom-left (default) grows right and up; bottom-right grows left and up; and so on.
 */
export function resizeRect(
  slot: GridRect,
  width_span: number,
  height_span: number,
  anchor: ResizeAnchor = 'bottom-left',
): GridRect {
  const right = slot.col_start + slot.width_span - 1;
  const top = slot.row_index + slot.height_span - 1;
  const fromRight = anchor === 'bottom-right' || anchor === 'top-right';
  const fromTop = anchor === 'top-left' || anchor === 'top-right';
  return {
    col_start: fromRight ? right - width_span + 1 : slot.col_start,
    row_index: fromTop ? top - height_span + 1 : slot.row_index,
    width_span,
    height_span,
  };
}

/** Largest width/height the shelf grid allows for this anchor (ignores neighbors). */
export function maxSpans(
  slot: GridRect,
  anchor: ResizeAnchor,
  cols: number,
  rowCount: number,
): { width: number; height: number } {
  const right = slot.col_start + slot.width_span - 1;
  const top = slot.row_index + slot.height_span - 1;
  const fromRight = anchor === 'bottom-right' || anchor === 'top-right';
  const fromTop = anchor === 'top-left' || anchor === 'top-right';
  return {
    width: fromRight ? right : cols - slot.col_start + 1,
    height: fromTop ? top + 1 : rowCount - slot.row_index,
  };
}

/**
 * Largest size (by area, ties favor width) that fits the grid and collides with nothing, for a given anchor.
 * Used by "Pick a different size".
 */
export function largestFreeSize(
  slot: GridRect & { slot_id: string },
  others: (GridRect & { slot_id: string })[],
  anchor: ResizeAnchor,
  cols: number,
  rowCount: number,
  want?: { width: number; height: number },
): { width: number; height: number } {
  const max = maxSpans(slot, anchor, cols, rowCount);
  let best = { width: slot.width_span, height: slot.height_span };
  let bestScore = -1;
  for (let w = 1; w <= max.width; w++) {
    for (let h = 1; h <= max.height; h++) {
      const r = resizeRect(slot, w, h, anchor);
      if (findOverlaps(r, others, slot.slot_id).length) continue;
      const dist = want ? -(Math.abs(w - want.width) + Math.abs(h - want.height)) * 1000 : 0;
      const score = dist + w * h;
      if (score > bestScore) {
        bestScore = score;
        best = { width: w, height: h };
      }
    }
  }
  return best;
}

export const locationCode = (shelfName: string, rowLabel: string, slotNo: number): string =>
  `${shelfName}-${rowLabel}-${slotNo}`;

/** Slots sorted bottom row first, then left to right (the order humans number them). */
export function sortSlots<T extends Pick<SlotGeometry, 'row_index' | 'col_start'>>(slots: T[]): T[] {
  return [...slots].sort((a, b) => a.row_index - b.row_index || a.col_start - b.col_start);
}

/** Cells (row:col) of the shelf grid covered by no active slot. */
export function freeCells(slots: GridRect[], cols: number, rowCount: number): Set<string> {
  const used = new Set<string>();
  for (const s of slots) for (const c of cellsOf(s)) used.add(c);
  const free = new Set<string>();
  for (let r = 0; r < rowCount; r++)
    for (let c = 1; c <= cols; c++) if (!used.has(`${r}:${c}`)) free.add(`${r}:${c}`);
  return free;
}
