import type { Location, ShelfGeometry } from '../shared/contract';
import { niceZoneName, ordinal, shelfFacing } from '../shared/units';

export function rowPhrase(rowLabel: string): string {
  return rowLabel === 'G' ? 'ground row' : `row ${rowLabel} (${rowLabel} up from the ground)`;
}

/**
 * "Warehouse 126, shelf A1 (west wall, facing east), ground row, 4th slot from the left,
 *  standing in the aisle facing the shelf"
 */
export function plainDirections(
  loc: Pick<Location, 'zone_name' | 'shelf_name' | 'row_label' | 'slot_no'>,
  shelf: Pick<ShelfGeometry, 'rotation_deg' | 'wall_ref'>,
): string {
  const facing = shelfFacing(shelf.rotation_deg);
  const bits = [shelf.wall_ref?.trim() || null, facing ? `facing ${facing}` : null].filter(Boolean);
  const shelfPart = `shelf ${loc.shelf_name}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  return [
    niceZoneName(loc.zone_name),
    shelfPart,
    rowPhrase(loc.row_label),
    `${ordinal(loc.slot_no)} slot from the left`,
    'standing in the aisle facing the shelf',
  ].join(', ');
}
