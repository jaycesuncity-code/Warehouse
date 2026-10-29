import { AppHeader, LinkButton } from '../../shared/ui';
import { BottomTabs } from '../components/BottomTabs';

export function UnknownScreen({ partId }: { partId: string }) {
  return (
    <>
      <AppHeader title="Unknown label" backHref="#/scan" />
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="unknown-screen">
        <section className="card border-2 border-amber-600 bg-amber-50">
          <p className="text-4xl" aria-hidden="true">
            ❓
          </p>
          <h2 className="mt-1 text-2xl font-extrabold">We don't know this label</h2>
          <p className="mt-2 text-lg">
            The code{' '}
            <code
              className="break-all rounded bg-white px-1.5 py-0.5 font-mono font-bold"
              data-testid="unknown-id"
            >
              {partId}
            </code>{' '}
            looks right, but no part in the database has it.
          </p>
          <p className="mt-2 text-lg">
            New parts are made on the <strong>label generator</strong> page, not here. If this label is new,
            ask the person who prints labels to register it first.
          </p>
        </section>
        <LinkButton href="#/scan" data-testid="scan-again">
          Scan another label
        </LinkButton>
        <LinkButton href="#/search" variant="secondary">
          Search by name or code
        </LinkButton>
      </main>
      <BottomTabs active="scan" />
    </>
  );
}
