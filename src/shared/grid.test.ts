import { describe, expect, it } from 'vitest';
import {
  cellsOf,
  findOverlaps,
  freeCells,
  largestFreeSize,
  maxSpans,
  rectsOverlap,
  resizeRect,
  sortSlots,
  withinGrid,
} from './grid';

const r = (row_index: number, col_start: number, width_span: number, height_span: number) => ({
  row_index,
  col_start,
  width_span,
  height_span,
});

describe('grid helpers', () => {
  it('detects overlaps by shared cells only', () => {
    expect(rectsOverlap(r(0, 1, 3, 1), r(0, 4, 3, 1))).toBe(false); // side by side
    expect(rectsOverlap(r(0, 1, 3, 1), r(0, 3, 3, 1))).toBe(true); // share column 3
    expect(rectsOverlap(r(0, 1, 3, 1), r(1, 1, 3, 1))).toBe(false); // stacked
    expect(rectsOverlap(r(0, 1, 3, 2), r(1, 2, 1, 1))).toBe(true); // tall slot covers the row above
    expect(cellsOf(r(1, 2, 2, 2))).toEqual(['1:2', '1:3', '2:2', '2:3']);
  });
  it('checks the grid bounds', () => {
    expect(withinGrid(r(0, 1, 12, 5), 12, 5)).toBe(true);
    expect(withinGrid(r(0, 2, 12, 1), 12, 5)).toBe(false);
    expect(withinGrid(r(4, 1, 1, 2), 12, 5)).toBe(false);
    expect(withinGrid(r(-1, 1, 1, 1), 12, 5)).toBe(false);
    expect(withinGrid(r(0, 0, 1, 1), 12, 5)).toBe(false);
    expect(withinGrid(r(0, 1, 0, 1), 12, 5)).toBe(false);
  });
  it('resizes around each anchor', () => {
    const s = r(1, 5, 4, 2); // cols 5..8, rows 1..2
    expect(resizeRect(s, 2, 1)).toEqual(r(1, 5, 2, 1)); // bottom-left: left/bottom fixed
    expect(resizeRect(s, 2, 1, 'bottom-right')).toEqual(r(1, 7, 2, 1)); // right edge (col 8) fixed
    expect(resizeRect(s, 2, 1, 'top-left')).toEqual(r(2, 5, 2, 1)); // top row (2) fixed
    expect(resizeRect(s, 2, 1, 'top-right')).toEqual(r(2, 7, 2, 1));
    expect(resizeRect(s, 6, 3, 'bottom-left')).toEqual(r(1, 5, 6, 3)); // grows right and up
  });
  it('computes the largest allowed spans per anchor', () => {
    const s = r(1, 5, 4, 2);
    expect(maxSpans(s, 'bottom-left', 12, 5)).toEqual({ width: 8, height: 4 });
    expect(maxSpans(s, 'top-right', 12, 5)).toEqual({ width: 8, height: 3 });
  });
  it('finds overlapping neighbors and the largest free size', () => {
    const me = { slot_id: 'me', ...r(0, 1, 2, 1) };
    const right = { slot_id: 'right', ...r(0, 4, 2, 1) };
    const above = { slot_id: 'above', ...r(1, 1, 12, 1) };
    expect(findOverlaps(r(0, 1, 4, 1), [me, right, above], 'me').map((x) => x.slot_id)).toEqual(['right']);
    expect(findOverlaps(r(0, 1, 3, 2), [me, right, above], 'me').map((x) => x.slot_id)).toEqual(['above']);
    expect(largestFreeSize(me, [me, right, above], 'bottom-left', 12, 5)).toEqual({ width: 3, height: 1 });
    expect(largestFreeSize(me, [me, right, above], 'bottom-left', 12, 5, { width: 1, height: 1 })).toEqual({
      width: 1,
      height: 1,
    });
  });
  it('lists free cells and sorts slots bottom-up, left to right', () => {
    const free = freeCells([r(0, 1, 2, 1)], 3, 2);
    expect([...free].sort()).toEqual(['0:3', '1:1', '1:2', '1:3']);
    const sorted = sortSlots([r(1, 1, 1, 1), r(0, 3, 1, 1), r(0, 1, 1, 1)]);
    expect(sorted.map((x) => `${x.row_index}:${x.col_start}`)).toEqual(['0:1', '0:3', '1:1']);
  });
});
