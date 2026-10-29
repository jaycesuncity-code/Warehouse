/**
 * Demo labels: a QR code for every demo part, so the scanner can be tried off a monitor or a printout.
 * Plus two "wrong" labels (a valid-looking ID that isn't in the database, and a QR that isn't ours).
 * The real labels come from the label generator page; the QR holds only the Part ID.
 */
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { api } from '../shared/api';
import { AppHeader, Button, ErrorBox, mountApp, Spinner, useAsync } from '../shared/ui';

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function Card({ title, code, id, note }: { title: string; code?: string; id: string; note?: string }) {
  const svg = useMemo(() => qrSvg(id), [id]);
  return (
    <figure
      className="card flex break-inside-avoid flex-col items-center gap-2 text-center print:shadow-none"
      data-testid="demo-label"
      data-label-id={id}
    >
      <div
        className="aspect-square w-full max-w-[200px] [&>svg]:h-full [&>svg]:w-full"
        aria-label={`QR code for ${id}`}
        role="img"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="grid gap-0.5">
        <span className="text-base font-extrabold leading-tight">{title}</span>
        {code ? <span className="font-mono text-xl font-extrabold text-maroon">{code}</span> : null}
        <span className="break-all font-mono text-xs text-ink-soft">{id}</span>
        {note ? <span className="text-sm font-semibold text-amber-900">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

function App() {
  const state = useAsync(() => api.searchParts({ limit: 200 }), []);
  return (
    <>
      <div className="print:hidden">
        <AppHeader title="Demo labels" subtitle="QR codes for the demo parts" backHref="/warehouse/" />
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <p className="min-w-0 flex-1 text-base">
            Scan these with the Warehouse app, off this screen or a printout. The QR holds only the Part ID.
          </p>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
        {state.loading && !state.data ? <Spinner /> : null}
        {state.error ? <ErrorBox message={state.error.message} onRetry={state.reload} /> : null}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3"
          data-testid="demo-label-grid"
        >
          {state.data?.items.map((p) => (
            <Card
              key={p.part_id}
              title={p.part_name}
              code={p.part_code}
              id={p.part_id}
              note={p.locations.length ? undefined : 'Not assigned yet'}
            />
          ))}
          {state.data ? (
            <>
              <Card title="Unknown label" id="prt-2222aaaa" note="Looks right, but is not in the database" />
              <Card
                title="Not one of our labels"
                id="https://suncityph.example/not-a-part"
                note="Scanner should say so"
              />
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}

mountApp(<App />);
