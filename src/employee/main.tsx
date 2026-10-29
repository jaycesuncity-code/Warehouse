import { AppHeader, mountApp } from '../shared/ui';

const PLANNED = [
  ['🔎', 'Look up a part', 'Type a name or code, or scan the label.'],
  ['💲', 'See the price and whether it is in stock', 'Sale price and a simple In stock / Low / Out.'],
  ['📍', 'See where it is', 'Shelf, row and slot, with a picture of the shelf.'],
];

function App() {
  return (
    <>
      <AppHeader title="Employee version" subtitle="Coming soon" backHref="/" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <section className="card text-center" data-testid="employee-coming-soon">
          <p className="text-5xl" aria-hidden="true">
            🛠️
          </p>
          <h2 className="mt-2 text-3xl font-extrabold text-maroon">Coming soon</h2>
          <p className="mt-2 text-lg text-ink-soft">
            The Employee version is a read-only look-up. Here is what it will do:
          </p>
        </section>
        <ul className="grid gap-3">
          {PLANNED.map(([icon, title, text]) => (
            <li key={title} className="card flex items-start gap-4">
              <span className="text-3xl" aria-hidden="true">
                {icon}
              </span>
              <div>
                <p className="text-xl font-extrabold">{title}</p>
                <p className="text-base text-ink-soft">{text}</p>
              </div>
            </li>
          ))}
          <li className="card flex items-start gap-4 border-dashed">
            <span className="text-3xl" aria-hidden="true">
              🔒
            </span>
            <div>
              <p className="text-xl font-extrabold">No stock editing</p>
              <p className="text-base text-ink-soft">
                Counts and places are changed in the Warehouse version only.
              </p>
            </div>
          </li>
        </ul>
        <a href="/" className="btn btn-secondary">
          Back to home
        </a>
      </main>
    </>
  );
}

mountApp(<App />);
