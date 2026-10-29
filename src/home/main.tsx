import { AppHeader, mountApp } from '../shared/ui';

function BigLink({
  href,
  title,
  text,
  testId,
  primary,
}: {
  href: string;
  title: string;
  text: string;
  testId: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      data-testid={testId}
      className={`flex min-h-[132px] flex-col justify-center rounded-3xl border-4 px-6 py-5 shadow-md transition-transform active:scale-[0.99] ${
        primary
          ? 'border-gold bg-maroon text-white hover:bg-maroon-light'
          : 'border-maroon bg-white text-maroon hover:bg-maroon-tint'
      }`}
    >
      <span className="text-3xl font-extrabold leading-tight">{title}</span>
      <span className={`mt-1 text-lg font-semibold ${primary ? 'text-white/85' : 'text-ink-soft'}`}>
        {text}
      </span>
    </a>
  );
}

function App() {
  return (
    <>
      <AppHeader title="Sun City Parts" subtitle="Plumbing & Heating · Las Cruces, NM" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h2 className="text-2xl font-extrabold">Who is using the app?</h2>
        <BigLink
          href="/warehouse/"
          testId="btn-warehouse"
          primary
          title="Warehouse version"
          text="Scan a label, check stock, change counts, move parts."
        />
        <BigLink
          href="/employee/"
          testId="btn-employee"
          title="Employee version"
          text="Look up a part, its price and where it is."
        />
        <nav aria-label="Warehouse tools" className="grid gap-2 sm:grid-cols-3">
          <a href="/map/" className="btn btn-secondary">Warehouse map</a>
          <a href="/labels/" className="btn btn-secondary">Add Parts to List</a>
          <a href="/packouts/" className="btn btn-secondary">Packouts &amp; kits</a>
        </nav>
        <p className="mt-2 text-center text-sm text-ink-soft">
          Internal use only · Sun City Plumbing &amp; Heating, Inc.
        </p>
      </main>
    </>
  );
}

mountApp(<App />);
