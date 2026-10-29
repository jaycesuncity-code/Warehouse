import { useCallback, useEffect, useState } from 'react';
import { api, isApiError } from '../shared/api';
import type { ApiEvent, Employee, Layout, Packout, Part } from '../shared/contract';
import { AppHeader, mountApp, useSession } from '../shared/ui';
import { PartLookup } from '../warehouse/components/PartLookup';

const field = 'mt-1 min-h-[44px] w-full rounded-lg border-2 border-surface-line bg-white px-3 py-2 text-base';

function App() {
  const { canEdit, epoch } = useSession();
  const [kits, setKits] = useState<Packout[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undoId, setUndoId] = useState<string | null>(null);
  const [redoId, setRedoId] = useState<string | null>(null);
  const [history, setHistory] = useState<ApiEvent[]>([]);
  const [setup, setSetup] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlot, setNewSlot] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [issueTo, setIssueTo] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [part, setPart] = useState<Part | null>(null);
  const [source, setSource] = useState('');
  const [qty, setQty] = useState('1');
  const kit = kits.find((row) => row.kit_id === selected) ?? null;
  const refresh = useCallback(async () => {
    const [packouts, staff, map] = await Promise.all([
      api.listPackouts(),
      api.listEmployees(),
      api.getLayout(),
    ]);
    setKits(packouts.items);
    setEmployees(staff.items);
    if (!map.notModified) setLayout(map.layout);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh()
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, epoch]);
  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    let active = true;
    api
      .listEvents({ entity: 'packout', entity_id: selected, limit: 30 })
      .then((r) => {
        if (active) setHistory(r.items);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, kits]);
  useEffect(() => {
    setCounts({});
    setPart(null);
    setSource('');
    setIssueTo('');
    setReason('');
  }, [selected]);

  async function mutate(work: () => Promise<{ event_id: string; kit?: Packout }>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setUndoId(result.event_id);
      setRedoId(null);
      if (result.kit) setSelected(result.kit.kit_id);
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      const detail =
        isApiError(e) && Object.values(e.fields).length ? ` ${Object.values(e.fields).join(' ')}` : '';
      const message = (e instanceof Error ? e.message : 'The operation failed.') + detail;
      setError(message);
      if (isApiError(e, 'version_conflict')) {
        try {
          await refresh();
          if (part) {
            const updated = await api.getPart(part.part_id);
            setPart(updated);
            if (
              !updated.locations.some(
                (location) =>
                  location.slot_id === source && !location.issued_kit_id && location.on_hand_qty > 0,
              )
            )
              setSource('');
          }
          setError(message + ' Latest quantities loaded. Review them and retry.');
        } catch {
          setPart(null);
          setSource('');
          setError(
            message + ' Could not refresh warehouse data. Refresh this page and choose the part again.',
          );
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function reverse(redo: boolean) {
    const id = redo ? redoId : undoId;
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.undoEvent(id);
      if (redo) {
        setUndoId(r.event_id);
        setRedoId(null);
      } else {
        setRedoId(r.event_id);
        setUndoId(null);
      }
      await refresh();
      setNotice(redo ? 'Change restored.' : 'Change undone.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reverse this change.');
    } finally {
      setBusy(false);
    }
  }
  const availableBins =
    layout?.shelves
      .filter((shelf) => shelf.location_type === 'packout')
      .flatMap((shelf) =>
        shelf.slots
          .filter((slot) => !kits.some((k) => k.slot_id === slot.slot_id))
          .map((slot) => ({ id: slot.slot_id, label: slot.location_code })),
      ) ?? [];
  const sourceLocations =
    part?.locations.filter(
      (location) => location.slot_id !== kit?.slot_id && !location.issued_kit_id && location.on_hand_qty > 0,
    ) ?? [];

  return (
    <>
      <AppHeader title="Packouts & kits" subtitle="Stage, issue, return and replenish" backHref="/" />
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6">
        <nav className="flex flex-wrap items-center gap-2" aria-label="Packout navigation">
          <button
            className={`btn ${!setup ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSetup(false)}
          >
            Kits
          </button>
          {canEdit && (
            <button
              className={`btn ${setup ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSetup(true)}
            >
              Add kits & employees
            </button>
          )}
          <a className="btn btn-neutral" href="/map/">
            Map & staging
          </a>
          <a className="btn btn-neutral" href="/warehouse/">
            Scan parts
          </a>
        </nav>
        {error && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
            {error}
            <button
              className="btn btn-secondary ml-2"
              disabled={busy}
              onClick={() => {
                setError('');
                setLoading(true);
                void refresh()
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Refresh
            </button>
          </div>
        )}
        {(notice || undoId || redoId) && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 p-3"
          >
            <span>{notice}</span>
            <span className="flex gap-2">
              {undoId && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => void reverse(false)}>
                  Undo
                </button>
              )}
              {redoId && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => void reverse(true)}>
                  Redo
                </button>
              )}
            </span>
          </div>
        )}
        {loading ? (
          <p role="status" className="card">
            Loading warehouse kits…
          </p>
        ) : setup && canEdit ? (
          <div className="grid items-start gap-4 md:grid-cols-2">
            <form
              className="card grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  () => api.createPackout({ name: newName.trim(), slot_id: newSlot }),
                  'Kit created. Add stock before issuing it.',
                ).then((ok) => {
                  if (ok) {
                    setNewName('');
                    setNewSlot('');
                    setSetup(false);
                  }
                });
              }}
            >
              <h2 className="text-xl font-extrabold">Create a kit</h2>
              <p className="text-sm text-ink-soft">
                Choose a bin in your Packout staging area. Loose staging stock and kit contents share the
                warehouse inventory.
              </p>
              <label className="font-semibold">
                Kit name
                <input
                  required
                  maxLength={150}
                  className={field}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="BOX 12 · Plumbing fittings"
                />
              </label>
              <label className="font-semibold">
                Staging bin
                <select
                  required
                  className={field}
                  value={newSlot}
                  onChange={(e) => setNewSlot(e.target.value)}
                >
                  <option value="">Choose a bin</option>
                  {availableBins.map((bin) => (
                    <option key={bin.id} value={bin.id}>
                      {bin.label}
                    </option>
                  ))}
                </select>
              </label>
              {!availableBins.length && (
                <p className="text-sm">
                  No available kit bins. In the{' '}
                  <a href="/map/" className="font-bold text-maroon underline">
                    map
                  </a>
                  , mark a shelf as Packout staging and add bins using your measured dimensions.
                </p>
              )}
              <button className="btn btn-primary" disabled={busy || !availableBins.length}>
                Create kit
              </button>
            </form>
            <div className="grid gap-4">
              <form
                className="card grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(
                    () => api.createEmployee({ name: employeeName.trim(), email: employeeEmail.trim() }),
                    'Employee added.',
                  ).then((ok) => {
                    if (ok) {
                      setEmployeeName('');
                      setEmployeeEmail('');
                    }
                  });
                }}
              >
                <h2 className="text-xl font-extrabold">Add an employee</h2>
                <p className="text-sm text-ink-soft">
                  Use the work email they use to sign in. Their issued kits will appear on the Employee page.
                </p>
                <label className="font-semibold">
                  Employee name
                  <input
                    required
                    maxLength={150}
                    className={field}
                    value={employeeName}
                    onChange={(e) => setEmployeeName(e.target.value)}
                  />
                </label>
                <label className="font-semibold">
                  Work email
                  <input
                    required
                    type="email"
                    maxLength={254}
                    className={field}
                    value={employeeEmail}
                    onChange={(e) => setEmployeeEmail(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary" disabled={busy}>
                  Add employee
                </button>
              </form>
              <section className="card">
                <h2 className="mb-3 text-xl font-extrabold">Active employees</h2>
                {employees.length ? (
                  <ul className="divide-y divide-surface-line">
                    {employees.map((employee) => (
                      <li
                        key={employee.employee_id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div>
                          <strong>{employee.name}</strong>
                          <p className="break-all text-sm text-ink-soft">{employee.email}</p>
                        </div>
                        <button
                          className="btn btn-neutral"
                          disabled={busy || kits.some((k) => k.employee_id === employee.employee_id)}
                          onClick={() => {
                            if (window.confirm(`Deactivate ${employee.name}? Their history is retained.`))
                              void mutate(
                                () =>
                                  api.patchEmployee(employee.employee_id, {
                                    version: employee.version,
                                    active: false,
                                  }),
                                'Employee deactivated.',
                              );
                          }}
                        >
                          Deactivate
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-soft">No employees added yet.</p>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
            <section className="card grid gap-3">
              <h2 className="text-xl font-extrabold">
                {canEdit ? 'All kits' : 'My kits'} <span className="text-ink-soft">({kits.length})</span>
              </h2>
              {!kits.length && (
                <p className="text-ink-soft">
                  {canEdit
                    ? 'Start by adding a kit and an employee.'
                    : 'No kits are currently assigned to you.'}
                </p>
              )}
              {kits.map((item) => (
                <button
                  key={item.kit_id}
                  disabled={busy}
                  className={`min-h-[80px] rounded-xl border-2 p-3 text-left ${selected === item.kit_id ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                  onClick={() => setSelected(item.kit_id)}
                >
                  <strong className="block text-lg">{item.name}</strong>
                  <span className="text-sm">
                    {item.status === 'issued'
                      ? `Issued · ${item.employee_name}`
                      : 'Available · ' + item.location_code}
                  </span>
                </button>
              ))}
            </section>
            {!kit ? (
              <section className="card py-10 text-center">
                <h2 className="text-xl font-extrabold">Select a kit</h2>
                <p className="mt-2 text-ink-soft">
                  Review its contents, issue it to an employee, or reconcile a return.
                </p>
              </section>
            ) : (
              <div className="grid gap-4">
                <section className="card grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-extrabold">{kit.name}</h2>
                      <a
                        className="text-sm font-semibold text-maroon underline"
                        href={`/map/?shelf=${encodeURIComponent(kit.shelf_id)}&slot=${encodeURIComponent(kit.slot_id)}`}
                      >
                        Staging location {kit.location_code}
                      </a>
                    </div>
                    <span
                      className={`rounded-lg px-3 py-2 font-bold ${kit.status === 'issued' ? 'bg-amber-100 text-amber-950' : 'bg-green-100 text-green-950'}`}
                    >
                      {kit.status === 'issued' ? `With ${kit.employee_name}` : 'Available'}
                    </span>
                  </div>
                  {kit.status === 'issued' && (
                    <p className="text-sm">
                      Issued {new Date(kit.issued_at!).toLocaleString()}. Contents stay in the inventory total
                      and are unavailable for warehouse use until returned.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b-2 border-surface-line">
                          <th className="py-2 pr-3">Part</th>
                          <th className="py-2 text-right">
                            {kit.status === 'issued' ? 'Issued' : 'On hand'}
                          </th>
                          {kit.status === 'issued' && canEdit && (
                            <th className="py-2 pl-3 text-right">Remaining</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {kit.contents
                          .filter(
                            (item) =>
                              kit.status !== 'issued' ||
                              kit.issued_contents.some((row) => row.part_id === item.part_id),
                          )
                          .map((item) => (
                            <tr key={item.part_id} className="border-b border-surface-line">
                              <td className="py-3 pr-3">
                                <strong>{item.part_name}</strong>
                                <p className="text-sm text-ink-soft">{item.part_code}</p>
                              </td>
                              <td className="py-3 text-right font-bold">{item.on_hand_qty}</td>
                              {kit.status === 'issued' && canEdit && (
                                <td className="py-3 pl-3">
                                  <input
                                    aria-label={`Remaining ${item.part_code}`}
                                    type="number"
                                    min={0}
                                    max={item.on_hand_qty}
                                    step={1}
                                    className={`${field} !ml-auto !w-24 text-right`}
                                    value={counts[item.part_id] ?? ''}
                                    onChange={(e) =>
                                      setCounts((v) => ({ ...v, [item.part_id]: e.target.value }))
                                    }
                                  />
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!kit.contents.length && (
                    <p className="text-ink-soft">
                      This kit is empty. Transfer parts from a stocked location below.
                    </p>
                  )}
                  {kit.status === 'issued' && canEdit && (
                    <form
                      className="grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          kit.issued_contents.some(
                            (item) => counts[item.part_id] === undefined || counts[item.part_id] === '',
                          )
                        ) {
                          setError('Enter a remaining count for every issued part, including zero.');
                          return;
                        }
                        const values = kit.issued_contents.map((item) => ({
                          part_id: item.part_id,
                          remaining_qty: Number(counts[item.part_id]),
                        }));
                        if (
                          values.some(
                            (item) =>
                              !Number.isSafeInteger(item.remaining_qty) ||
                              item.remaining_qty < 0 ||
                              item.remaining_qty >
                                kit.issued_contents.find((x) => x.part_id === item.part_id)!.qty,
                          )
                        ) {
                          setError(
                            'Remaining counts must be whole numbers between zero and the quantity issued.',
                          );
                          return;
                        }
                        const used = kit.issued_contents.reduce(
                          (total, item) => total + item.qty - Number(counts[item.part_id]),
                          0,
                        );
                        if (window.confirm(`Return ${kit.name} and record ${used} units consumed?`))
                          void mutate(
                            () =>
                              api.returnPackout(kit.kit_id, { version: kit.version, counts: values, reason }),
                            'Kit returned and consumption recorded.',
                          ).then((ok) => {
                            if (ok) {
                              setCounts({});
                              setReason('');
                            }
                          });
                      }}
                    >
                      <label className="font-semibold">
                        Return notes (optional)
                        <input
                          className={field}
                          maxLength={1000}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <p className="text-sm text-ink-soft">
                        Enter actual remaining counts, including zero. Missing parts are recorded as consumed.
                        Receive unexpected extra parts separately after return.
                      </p>
                      <button className="btn btn-primary" disabled={busy}>
                        Return & reconcile
                      </button>
                    </form>
                  )}
                </section>
                {kit.status === 'available' && canEdit && (
                  <>
                    <form
                      className="card grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          window.confirm(
                            `Issue ${kit.name} to ${employees.find((x) => x.employee_id === issueTo)?.name}?`,
                          )
                        )
                          void mutate(
                            () =>
                              api.issuePackout(kit.kit_id, { version: kit.version, employee_id: issueTo }),
                            'Kit issued. Warehouse totals have not increased.',
                          );
                      }}
                    >
                      <h3 className="text-xl font-extrabold">Issue to an employee</h3>
                      <label className="font-semibold">
                        Employee
                        <select
                          required
                          className={field}
                          value={issueTo}
                          onChange={(e) => setIssueTo(e.target.value)}
                        >
                          <option value="">Choose employee</option>
                          {employees.map((employee) => (
                            <option key={employee.employee_id} value={employee.employee_id}>
                              {employee.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="btn btn-primary"
                        disabled={busy || !kit.contents.some((item) => item.on_hand_qty > 0)}
                      >
                        Issue kit
                      </button>
                    </form>
                    <section className="card grid gap-3">
                      <h3 className="text-xl font-extrabold">Replenish from warehouse stock</h3>
                      <PartLookup
                        label="Find a part to transfer"
                        onPick={(p) => {
                          setPart(p);
                          setSource('');
                        }}
                      />
                      {part && (
                        <form
                          className="grid gap-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const from = sourceLocations.find((location) => location.slot_id === source);
                            if (!from) return;
                            void mutate(
                              () =>
                                api.replenishPackout(kit.kit_id, {
                                  version: kit.version,
                                  part_id: part.part_id,
                                  from_slot_id: source,
                                  from_version: from.version,
                                  qty: Number(qty),
                                }),
                              'Stock transferred into kit. Total inventory is unchanged.',
                            ).then((ok) => {
                              if (ok) {
                                setPart(null);
                                setSource('');
                                setQty('1');
                              }
                            });
                          }}
                        >
                          <strong>{part.part_name}</strong>
                          <label className="font-semibold">
                            Take from
                            <select
                              required
                              className={field}
                              value={source}
                              onChange={(e) => setSource(e.target.value)}
                            >
                              <option value="">Choose stocked location</option>
                              {sourceLocations.map((location) => (
                                <option key={location.slot_id} value={location.slot_id}>
                                  {location.location_code} · {location.on_hand_qty} available
                                </option>
                              ))}
                            </select>
                          </label>
                          {!sourceLocations.length && <p>No available stock in another location.</p>}
                          <label className="font-semibold">
                            Quantity to transfer
                            <input
                              required
                              className={field}
                              type="number"
                              min={1}
                              max={
                                sourceLocations.find((location) => location.slot_id === source)?.on_hand_qty
                              }
                              step={1}
                              value={qty}
                              onChange={(e) => setQty(e.target.value)}
                            />
                          </label>
                          <button className="btn btn-primary" disabled={busy || !source}>
                            Transfer to kit
                          </button>
                        </form>
                      )}
                    </section>
                  </>
                )}
                <section className="card">
                  <h3 className="mb-3 text-xl font-extrabold">Kit history</h3>
                  {history.length ? (
                    <ol className="divide-y divide-surface-line">
                      {history.map((event) => (
                        <li key={event.event_id} className="py-3">
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong className="capitalize">
                              {event.action}
                              {event.undone_by ? ' · undone' : ''}
                            </strong>
                            <time className="text-sm">{new Date(event.at).toLocaleString()}</time>
                          </div>
                          <p className="break-words text-sm">{event.reason}</p>
                          <p className="text-sm text-ink-soft">{event.by}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-ink-soft">No kit history yet.</p>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
mountApp(<App />);
