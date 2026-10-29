/**
 * PLACEHOLDER. Workstream C replaces this page with the 3D warehouse map and layout editor.
 * It may reuse everything in src/shared (api, mock, units, contract, ui).
 * Deep link from the Warehouse app: /map/?shelf=<shelf_id>&slot=<slot_id>
 */
import { AppHeader, mountApp } from '../shared/ui';

function App() {
  const q = new URLSearchParams(window.location.search);
  const shelf = q.get('shelf');
  const slot = q.get('slot');
  return (
    <>
      <AppHeader title="Warehouse map" backHref="/warehouse/" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <section className="card text-center" data-testid="map-coming-soon">
          <p className="text-5xl" aria-hidden="true">
            🗺️
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-maroon">3D warehouse map: coming soon</h2>
          {shelf ? (
            <p className="mt-2 text-sm text-ink-soft" data-testid="map-target">
              Asked to show shelf <code>{shelf}</code>
              {slot ? (
                <>
                  , slot <code>{slot}</code>
                </>
              ) : null}
              .
            </p>
          ) : null}
        </section>
        <a href="/warehouse/" className="btn btn-primary">
          Back to the Warehouse app
        </a>
      </main>
    </>
  );
}

mountApp(<App />);
