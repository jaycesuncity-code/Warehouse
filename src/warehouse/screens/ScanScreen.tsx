import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Part } from '../../shared/contract';
import { AppHeader, Button, useSession, useToast } from '../../shared/ui';
import { BottomTabs } from '../components/BottomTabs';
import { PartLookup } from '../components/PartLookup';
import { Viewfinder } from '../components/Viewfinder';
import { scanFeedback } from '../feedback';
import { navigate, partPath } from '../router';
import { loadRecent, pushRecent, type RecentScan } from '../recent';
import { checkLabel } from '../scanner';

const UNKNOWN_VALID_ID = 'prt-2222aaaa';
const SIM_UNKNOWN = '__unknown__';
const SIM_WEBSITE = '__website__';
const SIM_OLD = '__old__';

interface Notice {
  title: string;
  detail?: string;
}

export function ScanScreen() {
  const { isMock } = useSession();
  const toast = useToast();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>(() => loadRecent());
  const [demoParts, setDemoParts] = useState<Part[]>([]);
  const [simulate, setSimulate] = useState('');
  const wedge = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    wedge.current?.focus();
  }, []);

  useEffect(() => {
    if (!isMock) return;
    api
      .searchParts({ limit: 100 })
      .then((r) => setDemoParts(r.items))
      .catch(() => undefined);
  }, [isMock]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const openLabel = useCallback(
    async (raw: string) => {
      const check = checkLabel(raw);
      if (!check.ok) {
        scanFeedback('bad');
        const shown = check.text.length > 60 ? `${check.text.slice(0, 57)}…` : check.text;
        setNotice({
          title: "That isn't one of our part labels",
          detail: shown ? `It says: ${shown}` : undefined,
        });
        return;
      }
      if (busy.current) return;
      busy.current = true;
      setNotice(null);
      try {
        const part = await api.getPart(check.partId);
        scanFeedback('ok');
        setRecent(
          pushRecent({ part_id: part.part_id, part_code: part.part_code, part_name: part.part_name }),
        );
        navigate(partPath(part.part_id));
      } catch (e) {
        if (isApiError(e) && e.is('not_found')) {
          scanFeedback('bad');
          navigate(`/unknown/${encodeURIComponent(check.partId)}`);
        } else {
          toast.show({
            tone: 'error',
            message: isApiError(e) ? e.message : "Couldn't look that up.",
            durationMs: 6000,
          });
        }
      } finally {
        busy.current = false;
      }
    },
    [toast],
  );

  function runSimulation() {
    if (!simulate) return;
    if (simulate === SIM_UNKNOWN) void openLabel(UNKNOWN_VALID_ID);
    else if (simulate === SIM_WEBSITE) void openLabel('https://suncityph.example/not-a-part');
    else if (simulate === SIM_OLD) void openLabel('OLD-77');
    else void openLabel(simulate);
  }

  return (
    <>
      <AppHeader title="Scan a part" subtitle="Point the camera at a label" />
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="scan-screen">
        {/* Hardware scanners type the label and press Enter; this hidden box always listens. */}
        <input
          ref={wedge}
          data-testid="wedge-input"
          className="sr-only-input"
          aria-label="Handheld scanner input"
          inputMode="none"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = e.currentTarget.value;
              e.currentTarget.value = '';
              if (v.trim()) void openLabel(v);
            }
          }}
          onBlur={() =>
            window.setTimeout(() => {
              const a = document.activeElement;
              if (!a || a === document.body) wedge.current?.focus();
            }, 80)
          }
        />

        <Viewfinder enabled onText={(t) => void openLabel(t)} />

        {notice ? (
          <div
            role="alert"
            data-testid="scan-notice"
            className="card border-2 border-amber-600 bg-amber-50 text-amber-950"
          >
            <p className="text-xl font-extrabold">{notice.title}</p>
            {notice.detail ? <p className="mt-1 break-all text-base">{notice.detail}</p> : null}
            <p className="mt-1 text-base">Look for the Sun City label with a square QR code.</p>
          </div>
        ) : null}

        <section className="card" aria-label="Look it up">
          <PartLookup
            onPick={(p) => {
              setRecent(pushRecent({ part_id: p.part_id, part_code: p.part_code, part_name: p.part_name }));
              navigate(partPath(p.part_id));
            }}
            onLabelText={(t) => void openLabel(t)}
            hint="No label? Type the part code or part of the name."
          />
        </section>

        {recent.length ? (
          <section aria-label="Recent scans">
            <h2 className="label-xs mb-2">Recent</h2>
            <ul className="flex gap-2 overflow-x-auto pb-1" data-testid="recent-scans">
              {recent.map((r) => (
                <li key={r.part_id} className="shrink-0">
                  <a
                    href={`#${partPath(r.part_id)}`}
                    className="flex min-h-touch max-w-[200px] flex-col justify-center rounded-xl border-2 border-surface-line bg-white px-3 py-1 hover:border-maroon"
                  >
                    <span className="truncate font-mono text-base font-extrabold text-maroon">
                      {r.part_code}
                    </span>
                    <span className="truncate text-sm text-ink-soft">{r.part_name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isMock ? (
          <section className="card border-dashed" aria-label="Demo tools" data-testid="demo-scan-tools">
            <h2 className="label-xs mb-2">Demo: no camera or labels handy?</h2>
            <label htmlFor="simulate" className="sr-only">
              Part to scan
            </label>
            <div className="flex gap-2">
              <select
                id="simulate"
                data-testid="simulate-select"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value)}
                className="min-h-touch min-w-0 flex-1 rounded-xl border-2 border-surface-line bg-white px-2 text-base font-semibold"
              >
                <option value="">Pick something to scan…</option>
                <optgroup label="Parts in the demo">
                  {demoParts.map((p) => (
                    <option key={p.part_id} value={p.part_id}>
                      {p.part_code} · {p.part_name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Things that go wrong">
                  <option value={SIM_UNKNOWN}>A label that isn't in the database</option>
                  <option value={SIM_WEBSITE}>A QR that isn't ours (a web address)</option>
                  <option value={SIM_OLD}>An old-style code (OLD-77)</option>
                </optgroup>
              </select>
              <Button
                variant="secondary"
                data-testid="simulate-go"
                disabled={!simulate}
                onClick={runSimulation}
              >
                Simulate a scan
              </Button>
            </div>
            <a
              href="/warehouse/demo-labels.html"
              className="mt-3 inline-flex min-h-touch items-center text-base font-bold text-maroon underline"
            >
              Open demo labels (QR codes to scan off a screen or printout)
            </a>
          </section>
        ) : null}
      </main>
      <BottomTabs active="scan" />
    </>
  );
}
