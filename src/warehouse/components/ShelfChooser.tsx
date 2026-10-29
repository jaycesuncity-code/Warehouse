import { useId, useState } from 'react';
import type { ShelfGroup } from '../../shared/contract';
import { niceZoneName } from '../../shared/units';

interface Props {
  groups: ShelfGroup[];
  currentShelfId?: string | null;
  onChoose: (shelfId: string) => void;
}

/** Shelves grouped by zone, with a quick filter. The shelf you are on is listed first. */
export function ShelfChooser({ groups, currentShelfId, onChoose }: Props) {
  const id = useId();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      shelves: g.shelves
        .filter(
          (s) =>
            !needle || s.name.toLowerCase().includes(needle) || g.zone_name.toLowerCase().includes(needle),
        )
        .sort(
          (a, b) =>
            Number(b.shelf_id === currentShelfId) - Number(a.shelf_id === currentShelfId) ||
            a.name.localeCompare(b.name, undefined, { numeric: true }),
        ),
    }))
    .filter((g) => g.shelves.length)
    .sort(
      (a, b) =>
        Number(b.shelves.some((s) => s.shelf_id === currentShelfId)) -
        Number(a.shelves.some((s) => s.shelf_id === currentShelfId)),
    );

  return (
    <div className="grid gap-3" data-testid="shelf-chooser">
      <div>
        <label htmlFor={id} className="label-xs">
          Find a shelf
        </label>
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder="Type A1, B1, filters…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="shelf-filter"
          className="mt-1 min-h-touch w-full rounded-xl border-2 border-surface-line bg-white px-3 text-lg font-semibold focus:border-maroon"
        />
      </div>
      {/* Shelf-end QR labels will be scanned here later. */}
      <button type="button" disabled className="btn btn-neutral" aria-disabled="true">
        📷 Scan the shelf label (coming later)
      </button>
      {shown.length === 0 ? (
        <p className="card text-center text-lg font-semibold">No shelf matches “{q.trim()}”.</p>
      ) : null}
      {shown.map((g) => (
        <section key={g.zone_id} aria-label={g.zone_name}>
          <h3 className="label-xs mb-1">{niceZoneName(g.zone_name)}</h3>
          <ul className="grid grid-cols-2 gap-2">
            {g.shelves.map((s) => (
              <li key={s.shelf_id}>
                <button
                  type="button"
                  data-testid={`shelf-${s.name}`}
                  onClick={() => onChoose(s.shelf_id)}
                  className={`flex min-h-[72px] w-full flex-col items-start justify-center rounded-xl border-2 px-3 text-left hover:border-maroon ${s.shelf_id === currentShelfId ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                >
                  <span className="text-2xl font-extrabold">Shelf {s.name}</span>
                  <span className="text-sm font-semibold text-ink-soft">
                    {s.shelf_id === currentShelfId ? 'Same shelf · ' : ''}
                    {s.part_count} {s.part_count === 1 ? 'part' : 'parts'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
