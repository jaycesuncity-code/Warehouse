import { useState } from 'react';
import { AppHeader } from '../../shared/ui';
import { BottomTabs } from '../components/BottomTabs';
import { PartLookup } from '../components/PartLookup';
import { loadRecent, pushRecent } from '../recent';
import { navigate, partPath } from '../router';

export function SearchScreen() {
  const [recent] = useState(() => loadRecent());
  return (
    <>
      <AppHeader title="Search parts" subtitle="By name, code or category" />
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="search-screen">
        <PartLookup
          autoFocus
          onPick={(p) => {
            pushRecent({ part_id: p.part_id, part_code: p.part_code, part_name: p.part_name });
            navigate(partPath(p.part_id));
          }}
          onLabelText={(t) => navigate(partPath(t))}
          hint="Try “elbow”, “filter”, or a code like CU-34-90."
        />
        {recent.length ? (
          <section aria-label="Recent scans">
            <h2 className="label-xs mb-2">Recently opened</h2>
            <ul className="grid gap-2">
              {recent.map((r) => (
                <li key={r.part_id}>
                  <a
                    href={`#${partPath(r.part_id)}`}
                    className="card flex min-h-touch items-center gap-3 hover:border-maroon"
                  >
                    <span className="font-mono text-base font-extrabold text-maroon">{r.part_code}</span>
                    <span className="truncate text-base">{r.part_name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <BottomTabs active="search" />
    </>
  );
}
