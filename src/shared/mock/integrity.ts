import { validation } from './errors';
import type { MockState } from './state';

/** Domain invariants run before audit events are finalized, in live D1 and the demo. */
export function assertInventoryIntegrity(state: MockState): void {
  for (const stock of state.stock.filter((row) => row.active)) {
    if (
      !Number.isSafeInteger(stock.on_hand_qty) ||
      stock.on_hand_qty < 0 ||
      !Number.isSafeInteger(stock.par_qty) ||
      stock.par_qty < 0
    ) {
      throw validation({ quantity: 'Inventory quantities must be nonnegative safe whole numbers.' });
    }
    const slot = state.slots.find((row) => row.active && row.slot_id === stock.slot_id);
    if (
      !slot ||
      !state.parts.some((row) => row.active && row.part_id === stock.part_id) ||
      !state.shelves.some((row) => row.active && row.shelf_id === slot.shelf_id)
    ) {
      throw validation({ location: 'Active inventory must have an active part, bin and shelf.' });
    }
  }
  const occupied = new Set<string>();
  for (const kit of state.packouts.filter((row) => row.active)) {
    const slot = state.slots.find((row) => row.active && row.slot_id === kit.slot_id);
    const shelf = slot && state.shelves.find((row) => row.active && row.shelf_id === slot.shelf_id);
    if (!shelf || shelf.location_type !== 'packout' || occupied.has(kit.slot_id)) {
      throw validation({
        packout:
          'Each kit needs its own active bin in a Packout staging shelf. Retire the kit before removing its bin.',
      });
    }
    occupied.add(kit.slot_id);
    if (kit.status !== 'issued') continue;
    if (!state.employees.some((row) => row.active && row.employee_id === kit.employee_id)) {
      throw validation({
        employee: 'An issued kit must belong to an active employee. Return their kits first.',
      });
    }
    const current = state.stock.filter(
      (row) => row.active && row.slot_id === kit.slot_id && row.on_hand_qty > 0,
    );
    const issued = kit.issued_contents.filter((row) => row.qty > 0);
    if (
      current.length !== issued.length ||
      issued.some(
        (item) => !current.some((row) => row.part_id === item.part_id && row.on_hand_qty === item.qty),
      )
    ) {
      throw validation({
        packout: 'This kit is issued to an employee. Use Return & reconcile before changing its contents.',
      });
    }
  }
}
