import type { Part, SlotGeometry } from '../shared/contract';
import type { StockStatusKey } from '../shared/ui';

/**
 * Out / Low / OK / Full for a quantity against its par level and the part's reorder point.
 *  - Out: nothing on hand.
 *  - Full: at or over par.
 *  - Low: at or under the reorder point (or, with no reorder point, at or under a quarter of par).
 */
export function stockStatus(onHand: number, par: number, reorderPoint: number | null): StockStatusKey {
  if (onHand <= 0) return 'out';
  if (par > 0 && onHand >= par) return 'full';
  if (reorderPoint != null) return onHand <= reorderPoint ? 'low' : 'ok';
  if (par > 0 && onHand <= par * 0.25) return 'low';
  return 'ok';
}

export const shortfall = (par: number, onHand: number): number => Math.max(par - onHand, 0);

export const partStatus = (p: Pick<Part, 'on_hand_total' | 'par_total' | 'reorder_point'>): StockStatusKey =>
  stockStatus(p.on_hand_total, p.par_total, p.reorder_point);

/** Fill fraction for the bar, 0..1 (over par shows as full). */
export const fillFraction = (onHand: number, par: number): number =>
  par <= 0 ? (onHand > 0 ? 1 : 0) : Math.min(Math.max(onHand / par, 0), 1);

type Dims = { width_in: number | null; height_in: number | null; depth_in: number | null };

/**
 * Does the part fit its bin? Compares the biggest side to the biggest side, and so on (parts can lie any way).
 * Returns null when either side has no complete dimensions.
 */
export function partFitsBin(
  part: Dims,
  slot: Pick<SlotGeometry, 'bin_width_in' | 'bin_height_in' | 'bin_depth_in'>,
): boolean | null {
  const p = [part.width_in, part.height_in, part.depth_in];
  const b = [slot.bin_width_in, slot.bin_height_in, slot.bin_depth_in];
  if (p.some((x) => x == null) || b.some((x) => x == null)) return null;
  const ps = (p as number[]).sort((a, c) => c - a);
  const bs = (b as number[]).sort((a, c) => c - a);
  return ps.every((v, i) => v <= bs[i] + 0.01);
}
