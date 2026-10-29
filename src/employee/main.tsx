import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import type { Packout, Part } from '../shared/contract';
import { ScannerDialog } from '../shared/scanner/ScannerDialog';
import { AppHeader, mountApp, useSession } from '../shared/ui';
import { PartLookup } from '../warehouse/components/PartLookup';

function App() {
  const { epoch } = useSession();
  const [part, setPart] = useState<Part | null>(null);
  const [kits, setKits] = useState<Packout[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listPackouts(true)
      .then((result) => {
        if (active) {
          setKits(result.items);
          setError('');
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [epoch, retry]);
  const lookup = useCallback((id: string) => {
    setScan(false);
    setError('');
    void api
      .getPart(id)
      .then(setPart)
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <>
      <AppHeader title="Employee inventory" subtitle="Find parts and see your issued kits" backHref="/" />
      <main className="mx-auto grid w-full max-w-3xl gap-5 px-4 py-6" data-testid="employee-inventory">
        <section className="card grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-extrabold">Find a part</h2>
            <button className="btn btn-primary" onClick={() => setScan(true)}>
              Scan label
            </button>
          </div>
          <PartLookup
            onPick={setPart}
            onLabelText={lookup}
            hint="Search a name or code, scan a label, or paste a Part ID."
          />
        </section>
        {error && (
          <div role="alert" className="card border-red-300 text-red-800">
            {error}{' '}
            <button className="btn btn-secondary mt-2" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {part && (
          <section className="card grid gap-3" aria-label="Part details">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-2xl font-extrabold">{part.part_name}</h2>
                <p className="text-ink-soft">{part.part_code}</p>
              </div>
              <button
                className="btn btn-neutral"
                aria-label="Close part details"
                onClick={() => setPart(null)}
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface px-4 py-3">
                <p className="text-sm">Available in warehouse</p>
                <p className="text-3xl font-extrabold text-maroon">
                  {part.available_total ?? part.on_hand_total}
                </p>
                <p className="text-sm">
                  {(part.available_total ?? part.on_hand_total) === 0
                    ? 'Out of stock'
                    : part.reorder_point !== null &&
                        (part.available_total ?? part.on_hand_total) <= part.reorder_point
                      ? 'Low stock'
                      : 'In stock'}
                </p>
              </div>
              <div className="rounded-xl bg-surface px-4 py-3">
                <p className="text-sm">Sale price · {part.unit}</p>
                <p className="text-2xl font-extrabold">
                  {part.sale_price === null
                    ? 'Not set'
                    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                        part.sale_price,
                      )}
                </p>
              </div>
            </div>
            {!!part.issued_total && <p>{part.issued_total} additional units are currently in issued kits.</p>}
            <h3 className="text-lg font-bold">Where to find it</h3>
            {!part.locations.length && (
              <p className="text-ink-soft">No warehouse location is assigned yet. Ask the warehouse team.</p>
            )}
            {part.locations.map((location) => (
              <a
                key={location.slot_id}
                className="flex min-h-[64px] items-center justify-between gap-2 rounded-xl border border-surface-line p-3 hover:bg-maroon-tint"
                href={`/map/?shelf=${encodeURIComponent(location.shelf_id)}&slot=${encodeURIComponent(location.slot_id)}&part=${encodeURIComponent(part.part_id)}`}
              >
                <span>
                  <strong>{location.location_code}</strong>
                  <br />
                  <span className="text-sm">
                    {location.zone_name} · {location.location_type ?? 'primary'}
                    {location.issued_kit_id ? ' · Issued kit' : ''}
                  </span>
                </span>
                <strong>{location.on_hand_qty} →</strong>
              </a>
            ))}
          </section>
        )}
        <section className="card grid gap-3" aria-label="My issued kits">
          <h2 className="text-2xl font-extrabold">My issued kits</h2>
          {loading ? (
            <p role="status">Loading your kits…</p>
          ) : !kits.length ? (
            <p className="text-ink-soft">
              You have no kits checked out. The warehouse team assigns kits using your work email.
            </p>
          ) : (
            kits.map((kit) => (
              <article key={kit.kit_id} className="rounded-xl border border-surface-line p-4">
                <h3 className="text-lg font-extrabold">{kit.name}</h3>
                <p className="mb-2 text-sm text-ink-soft">
                  Return to {kit.location_code} · Issued{' '}
                  {kit.issued_at ? new Date(kit.issued_at).toLocaleDateString() : ''}
                </p>
                <ul className="divide-y divide-surface-line">
                  {kit.contents.map((item) => (
                    <li className="flex justify-between gap-3 py-2" key={item.part_id}>
                      <span>{item.part_name}</span>
                      <strong>{item.on_hand_qty}</strong>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm">
                  Quantities show what was issued. The warehouse team counts remaining parts when you return
                  the kit.
                </p>
              </article>
            ))
          )}
        </section>
        <nav aria-label="Employee navigation" className="flex flex-wrap gap-2">
          <a href="/map/" className="btn btn-secondary">
            Warehouse map
          </a>
          <a href="/" className="btn btn-neutral">
            Home
          </a>
        </nav>
      </main>
      <ScannerDialog open={scan} onClose={() => setScan(false)} onPartId={lookup} />
    </>
  );
}
mountApp(<App />);
