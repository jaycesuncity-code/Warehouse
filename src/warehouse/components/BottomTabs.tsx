interface Props {
  active: 'scan' | 'search';
}

const TAB = 'flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-base font-extrabold';

/** Scan / Search stay inside the app; Map opens the 3D map page. */
export function BottomTabs({ active }: Props) {
  const on = 'bg-maroon text-white';
  const off = 'bg-white text-maroon hover:bg-maroon-tint';
  return (
    <nav
      aria-label="Warehouse sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t-4 border-gold bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-3">
        <li>
          <a
            href="#/scan"
            data-testid="tab-scan"
            aria-current={active === 'scan' ? 'page' : undefined}
            className={`${TAB} ${active === 'scan' ? on : off}`}
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              📷
            </span>
            Scan
          </a>
        </li>
        <li>
          <a
            href="#/search"
            data-testid="tab-search"
            aria-current={active === 'search' ? 'page' : undefined}
            className={`${TAB} ${active === 'search' ? on : off}`}
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              🔎
            </span>
            Search
          </a>
        </li>
        <li>
          <a href="/map/" data-testid="tab-map" className={`${TAB} ${off}`}>
            <span aria-hidden="true" className="text-2xl leading-none">
              🗺️
            </span>
            Map
          </a>
        </li>
      </ul>
    </nav>
  );
}
