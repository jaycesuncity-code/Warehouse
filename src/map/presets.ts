// Shelf presets for "Add shelf" (handoff: 4' shelving, 8' shelving, pallet rack bay, cabinet,
// bench, floor area). All sizes are editable after placing.

import type { Row, ShelfKind } from "../shared/contract";
import { evenRows } from "../shared/units";

export interface ShelfSize {
  kind: ShelfKind;
  width_in: number;
  depth_in: number;
  height_in: number;
  rowCount: number;
  cols: number;
}

export type PresetKey = "last" | "shelving4" | "shelving8" | "pallet" | "cabinet" | "bench" | "floor";

export const PRESETS: Record<Exclude<PresetKey, "last">, ShelfSize & { label: string }> = {
  shelving4: {
    label: "4' shelving",
    kind: "shelving",
    width_in: 48,
    depth_in: 24,
    height_in: 84,
    rowCount: 5,
    cols: 12,
  },
  shelving8: {
    label: "8' shelving",
    kind: "shelving",
    width_in: 96,
    depth_in: 24,
    height_in: 84,
    rowCount: 5,
    cols: 12,
  },
  pallet: {
    label: "Pallet rack bay",
    kind: "pallet_rack",
    width_in: 96,
    depth_in: 42,
    height_in: 120,
    rowCount: 3,
    cols: 2,
  },
  cabinet: { label: "Cabinet", kind: "cabinet", width_in: 36, depth_in: 24, height_in: 78, rowCount: 4, cols: 2 },
  bench: { label: "Bench", kind: "bench", width_in: 72, depth_in: 30, height_in: 36, rowCount: 2, cols: 6 },
  floor: { label: "Floor area", kind: "floor_area", width_in: 48, depth_in: 48, height_in: 48, rowCount: 1, cols: 4 },
};

/** Default "last-used size" (handoff: 48" W x 24" D x 84" H, 5 rows, 12 cols). */
export const DEFAULT_SIZE: ShelfSize = {
  kind: "shelving",
  width_in: 48,
  depth_in: 24,
  height_in: 84,
  rowCount: 5,
  cols: 12,
};

export function rowsFor(size: ShelfSize): Row[] {
  if (size.kind === "floor_area")
    return [{ row_index: 0, row_label: "G", elevation_in: 0, clear_height_in: size.height_in }];
  return evenRows(size.rowCount, size.height_in);
}
