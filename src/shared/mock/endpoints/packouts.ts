import type { Employee, Packout, PackoutRecord } from '../../contract';
import { notFound, validation } from '../errors';
import { activeStockInSlot, findPart, findShelf, findSlot, slotCode, stockFor } from '../format';
import { requireInt, requireString, requireVersion } from '../rules';
import type { MockState } from '../state';
import { isoNow } from '../tx';
import { ok, type Handler } from '../types';

export function buildPackout(state: MockState, kit: PackoutRecord): Packout {
  const slot = findSlot(state, kit.slot_id)!;
  return {
    ...kit,
    issued_contents: kit.issued_contents.map((item) => ({ ...item })),
    location_code: slotCode(state, slot),
    shelf_id: slot.shelf_id,
    employee_name: state.employees.find((employee) => employee.employee_id === kit.employee_id)?.name ?? null,
    contents: activeStockInSlot(state, kit.slot_id).map((stock) => {
      const part = findPart(state, stock.part_id)!;
      return {
        part_id: part.part_id,
        part_name: part.part_name,
        part_code: part.part_code,
        on_hand_qty: stock.on_hand_qty,
        par_qty: stock.par_qty,
        version: stock.version,
      };
    }),
  };
}

function getKit(c: Parameters<Handler>[0]): PackoutRecord {
  const kit = c.state.packouts.find((row) => row.active && row.kit_id === c.params.kit_id);
  if (!kit) throw notFound('That packout');
  requireVersion(c.body?.version, kit, () => buildPackout(c.state, kit), 'This kit');
  return kit;
}

export const listEmployees: Handler = (c) =>
  ok({
    items: c.state.employees
      .filter(
        (employee) =>
          employee.active &&
          (c.role !== 'viewer' || employee.email.toLowerCase() === c.ctx.email.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
  });

function employeeFields(body: Record<string, unknown>): Pick<Employee, 'name' | 'email'> {
  const name = requireString(body.name, 'name');
  const email = requireString(body.email, 'email').toLowerCase();
  if (name.length > 150 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validation({ name: 'Use a name of at most 150 characters.', email: 'Enter a valid work email.' });
  }
  return { name, email };
}

export const createEmployee: Handler = (c) => {
  const fields = employeeFields(c.body ?? {});
  if (c.state.employees.some((row) => row.email.toLowerCase() === fields.email)) {
    throw validation({ email: 'This employee email already exists.' });
  }
  const employee: Employee = { ...fields, employee_id: c.tx.mint('emp'), active: true, version: 1 };
  c.tx.insert('employees', employee);
  const ev = c.tx.finish('create', 'employee', employee.employee_id);
  return ok({ employee, event_id: ev.event_id }, 201);
};

export const patchEmployee: Handler = (c) => {
  const employee = c.state.employees.find((row) => row.employee_id === c.params.employee_id);
  if (!employee) throw notFound('That employee');
  requireVersion(c.body?.version, employee, () => employee, 'This employee');
  const fields = employeeFields({ ...employee, ...c.body });
  if (c.body?.active !== undefined && typeof c.body.active !== 'boolean')
    throw validation({ active: 'Use true or false.' });
  if (
    c.state.employees.some(
      (row) => row.employee_id !== employee.employee_id && row.email.toLowerCase() === fields.email,
    )
  ) {
    throw validation({ email: 'This employee email already exists.' });
  }
  c.tx.update('employees', employee, (row) =>
    Object.assign(row, fields, { active: c.body?.active ?? row.active }),
  );
  const ev = c.tx.finish('edit', 'employee', employee.employee_id);
  return ok({ employee, event_id: ev.event_id });
};

export const listPackouts: Handler = (c) => {
  const mine = c.query.get('mine') === 'true' || c.role === 'viewer';
  const employee = c.state.employees.find((row) => row.email.toLowerCase() === c.ctx.email.toLowerCase());
  return ok({
    items: c.state.packouts
      .filter((kit) => kit.active && (!mine || kit.employee_id === employee?.employee_id))
      .map((kit) => buildPackout(c.state, kit))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
};

export const createPackout: Handler = (c) => {
  const name = requireString(c.body?.name, 'name');
  if (name.length > 150) throw validation({ name: 'Use at most 150 characters.' });
  const slot = findSlot(c.state, String(c.body?.slot_id ?? ''));
  const shelf = slot && findShelf(c.state, slot.shelf_id);
  if (!slot || !shelf || shelf.location_type !== 'packout') {
    throw validation({ slot_id: 'Choose a bin on a shelf marked Packout staging in the map.' });
  }
  if (
    c.state.packouts.some(
      (row) => row.active && (row.slot_id === slot.slot_id || row.name.toLowerCase() === name.toLowerCase()),
    )
  ) {
    throw validation({ name: 'A kit already uses this name or bin.' });
  }
  const kit: PackoutRecord = {
    kit_id: c.tx.mint('kit'),
    name,
    slot_id: slot.slot_id,
    status: 'available',
    employee_id: null,
    issued_at: null,
    issued_contents: [],
    active: true,
    version: 1,
  };
  c.tx.insert('packouts', kit);
  const ev = c.tx.finish('create', 'packout', kit.kit_id);
  return ok({ kit: buildPackout(c.state, kit), event_id: ev.event_id }, 201);
};

/** Move stock into a staged kit; there is no new stock creation or automatic receiving. */
export const replenishPackout: Handler = (c) => {
  const kit = getKit(c);
  if (kit.status !== 'available') throw validation({ kit: 'Return the kit before replenishing it.' });
  const part = findPart(c.state, String(c.body?.part_id ?? ''));
  if (!part) throw notFound('That part');
  const from = stockFor(c.state, part.part_id, String(c.body?.from_slot_id ?? ''));
  if (!from?.active || from.slot_id === kit.slot_id)
    throw validation({ from_slot_id: 'Choose another stocked bin.' });
  if (c.state.packouts.some((row) => row.active && row.status === 'issued' && row.slot_id === from.slot_id)) {
    throw validation({ from_slot_id: 'That source belongs to an issued kit.' });
  }
  requireVersion(c.body?.from_version, from, () => from, 'Source stock');
  const qty = requireInt(c.body?.qty, 'qty', { min: 1, max: from.on_hand_qty });
  const dest = stockFor(c.state, part.part_id, kit.slot_id);
  c.tx.update('stock', from, (row) => {
    row.on_hand_qty -= qty;
  });
  if (dest)
    c.tx.update('stock', dest, (row) => {
      row.on_hand_qty = (row.active ? row.on_hand_qty : 0) + qty;
      row.par_qty = row.active ? row.par_qty : 0;
      row.active = true;
    });
  else
    c.tx.insert('stock', {
      part_id: part.part_id,
      slot_id: kit.slot_id,
      par_qty: 0,
      on_hand_qty: qty,
      counted_at: null,
      counted_by: null,
      version: 1,
      active: true,
    });
  c.tx.update('packouts', kit, () => {});
  const ev = c.tx.finish(
    'replenish',
    'packout',
    kit.kit_id,
    `Transferred ${qty} × ${part.part_code} from ${from.slot_id}`,
  );
  return ok({ kit: buildPackout(c.state, kit), event_id: ev.event_id });
};

export const issuePackout: Handler = (c) => {
  const kit = getKit(c);
  if (kit.status !== 'available') throw validation({ kit: 'This kit is already issued. Return it first.' });
  const employee = c.state.employees.find((row) => row.active && row.employee_id === c.body?.employee_id);
  if (!employee) throw validation({ employee_id: 'Choose an active employee.' });
  const contents = activeStockInSlot(c.state, kit.slot_id).filter((row) => row.on_hand_qty > 0);
  if (!contents.length) throw validation({ kit: 'Add stock to this kit before issuing it.' });
  c.tx.update('packouts', kit, (row) => {
    row.status = 'issued';
    row.employee_id = employee.employee_id;
    row.issued_at = isoNow();
    row.issued_contents = contents.map((stock) => ({ part_id: stock.part_id, qty: stock.on_hand_qty }));
  });
  const ev = c.tx.finish('issue', 'packout', kit.kit_id, `Issued to ${employee.name}`);
  return ok({ kit: buildPackout(c.state, kit), event_id: ev.event_id });
};

export const returnPackout: Handler = (c) => {
  const kit = getKit(c);
  if (kit.status !== 'issued') throw validation({ kit: 'This kit is not currently issued.' });
  const counts: unknown = c.body?.counts;
  if (!Array.isArray(counts) || counts.length !== kit.issued_contents.length) {
    throw validation({ counts: 'Count every issued part, including zero remaining.' });
  }
  const seen = new Set<string>();
  const checked = counts.map((value: unknown) => {
    if (!value || typeof value !== 'object')
      throw validation({ counts: 'Each count needs a part ID and remaining quantity.' });
    const item = value as Record<string, unknown>;
    const partId = String(item.part_id ?? '');
    const issued = kit.issued_contents.find((row) => row.part_id === partId);
    if (!issued || seen.has(partId)) throw validation({ counts: 'Count each issued part exactly once.' });
    seen.add(partId);
    const remaining = requireInt(item.remaining_qty, 'remaining_qty', { min: 0, max: issued.qty });
    const stock = stockFor(c.state, partId, kit.slot_id);
    if (!stock?.active || stock.on_hand_qty !== issued.qty)
      throw validation({ counts: 'Issued stock changed. Refresh and reconcile before continuing.' });
    return { stock, remaining, used: issued.qty - remaining };
  });
  let used = 0;
  for (const count of checked) {
    used += count.used;
    c.tx.update('stock', count.stock, (row) => {
      row.on_hand_qty = count.remaining;
      row.counted_at = isoNow();
      row.counted_by = c.ctx.email;
    });
  }
  c.tx.update('packouts', kit, (row) => {
    row.status = 'available';
    row.employee_id = null;
    row.issued_at = null;
    row.issued_contents = [];
  });
  const ev = c.tx.finish(
    'return',
    'packout',
    kit.kit_id,
    `Returned and counted; ${used} total units consumed. ${typeof c.body?.reason === 'string' ? c.body.reason.slice(0, 1000) : ''}`.trim(),
  );
  return ok({ kit: buildPackout(c.state, kit), event_id: ev.event_id });
};
