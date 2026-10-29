/**
 * Quick quantity adjust for one location (one part in one slot).
 *  - Huge minus / plus, +5 / +10 / -5 / -10 chips, tap the number to type an exact value.
 *  - Taps are batched for half a second into ONE change, so one Undo toast reverses what you just did.
 *  - "Set count": the shelf was counted. Sends the exact number with the location's version and stamps counted-at.
 *  - Never below 0. Saved / Saving state is always visible.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Location, Part } from '../../shared/contract';
import { Button, ConflictDialog, useSession, useToast, ViewOnlyNote, whenText } from '../../shared/ui';
import { NumberSheet } from './NumberSheet';

const REASONS = ['Used on job', 'Received', 'Damaged', 'Returned', 'Count correction'] as const;
const BATCH_MS = 500;

interface Props {
  part: Part;
  location: Location;
  canEdit: boolean;
  /** Apply a change to the loaded part (from a mutation response). */
  onPartChange: (update: (p: Part) => Part) => void;
  /** Full refetch (after a conflict or error). */
  reload: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function QtyAdjust({ part, location, canEdit, onPartChange, reload }: Props) {
  const toast = useToast();
  const { isAdmin } = useSession();
  const server = location.on_hand_qty;

  const serverRef = useRef(server);
  serverRef.current = server;
  const versionRef = useRef(location.version);
  if (location.version > versionRef.current) versionRef.current = location.version;

  const pendingRef = useRef(0);
  const inflightRef = useRef(0);
  const [pending, setPending] = useState(0);
  const [inflight, setInflight] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const reasonRef = useRef<string | null>(null);
  reasonRef.current = reason;
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const savedTimer = useRef<number | undefined>(undefined);

  const [typing, setTyping] = useState(false);
  const [counting, setCounting] = useState(false);
  const [conflict, setConflict] = useState<{
    current: Location;
    wanted: number;
    reason: string | null;
  } | null>(null);

  const shown = Math.max(server + inflight + pending, 0);

  const patchLocation = useCallback(
    (res: { location: Location; par_total: number; on_hand_total: number }) => {
      versionRef.current = res.location.version;
      onPartChange((p) => ({
        ...p,
        par_total: res.par_total,
        on_hand_total: res.on_hand_total,
        locations: p.locations.map((l) =>
          l.slot_id === res.location.slot_id ? { ...l, ...res.location } : l,
        ),
      }));
    },
    [onPartChange],
  );

  const markSaved = useCallback(() => {
    setSaveState('saved');
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaveState('idle'), 3000);
  }, []);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const delta = pendingRef.current;
    if (!delta) return;
    pendingRef.current = 0;
    setPending(0);
    inflightRef.current += delta;
    setInflight(inflightRef.current);
    setSaveState('saving');
    const why = reasonRef.current;
    if (why) setReason(null);
    chain.current = chain.current.then(async () => {
      try {
        const res = await api.adjustStock({
          part_id: part.part_id,
          slot_id: location.slot_id,
          delta,
          ...(why ? { reason: why } : {}),
        });
        inflightRef.current -= delta;
        setInflight(inflightRef.current);
        patchLocation(res);
        markSaved();
        const after = res.location.on_hand_qty;
        toast.show({
          key: 'qty',
          tone: 'ok',
          message: `${location.location_code}: ${after - delta} → ${after}`,
          undoEventIds: [res.event_id],
          onUndone: reload,
        });
      } catch (e) {
        inflightRef.current -= delta;
        setInflight(inflightRef.current);
        setSaveState('error');
        toast.show({
          tone: 'error',
          message: isApiError(e) ? e.message : "Couldn't save that change.",
          durationMs: 6000,
        });
        reload();
      }
    });
  }, [part.part_id, location.slot_id, location.location_code, patchLocation, markSaved, toast, reload]);

  // Don't lose taps if the screen closes within the batching window.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  function bump(d: number) {
    if (!canEdit) return;
    const current = serverRef.current + inflightRef.current + pendingRef.current;
    const actual = Math.max(current + d, 0) - current;
    if (actual === 0) return;
    pendingRef.current += actual;
    setPending(pendingRef.current);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, BATCH_MS);
  }

  async function setCount(n: number, version: number, why: string | null) {
    flush();
    await chain.current;
    setSaveState('saving');
    try {
      const res = await api.adjustStock({
        part_id: part.part_id,
        slot_id: location.slot_id,
        set: n,
        version,
        ...(why ? { reason: why } : {}),
      });
      patchLocation(res);
      markSaved();
      setReason(null);
      const before = serverRef.current;
      toast.show({
        key: 'qty',
        tone: 'ok',
        message: `Counted ${location.location_code}: ${before} → ${n}`,
        undoEventIds: [res.event_id],
        onUndone: reload,
      });
    } catch (e) {
      if (isApiError(e) && e.is('version_conflict')) {
        const current = e.current<Location>();
        if (current) {
          setSaveState('idle');
          setConflict({ current, wanted: n, reason: why });
          return;
        }
      }
      setSaveState('error');
      toast.show({
        tone: 'error',
        message: isApiError(e) ? e.message : "Couldn't save the count.",
        durationMs: 6000,
      });
    }
  }

  const chip = 'btn btn-neutral min-w-[72px] flex-1 !px-2 text-xl';
  const dis = !canEdit;

  return (
    <section className="card grid gap-3" aria-labelledby="qty-heading" data-testid="qty-adjust">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="qty-heading" className="text-xl font-extrabold">
          Change the count
        </h2>
        <p
          role="status"
          aria-live="polite"
          data-testid="save-state"
          className={`text-base font-bold ${saveState === 'error' ? 'text-red-700' : saveState === 'saved' ? 'text-emerald-800' : 'text-ink-soft'}`}
        >
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? '✓ Saved'
              : saveState === 'error'
                ? 'Not saved'
                : ''}
        </p>
      </div>
      {!canEdit ? <ViewOnlyNote /> : null}

      <div className="flex items-stretch gap-3">
        <button
          type="button"
          data-testid="qty-minus"
          aria-label="Take one away"
          disabled={dis || shown <= 0}
          onClick={() => bump(-1)}
          className="btn btn-neutral min-h-[96px] w-[30%] !px-0 text-6xl leading-none"
        >
          −
        </button>
        <button
          type="button"
          data-testid="qty-number"
          aria-label={`On hand ${shown}. Tap to type an exact number`}
          disabled={dis}
          onClick={() => setTyping(true)}
          className="min-h-[96px] flex-1 rounded-2xl border-2 border-dashed border-maroon bg-maroon-tint text-center"
        >
          <span className="block text-6xl font-extrabold leading-none text-maroon" data-testid="qty-value">
            {shown}
          </span>
          <span className="mt-1 block text-sm font-bold text-ink-soft">on hand · tap to type</span>
        </button>
        <button
          type="button"
          data-testid="qty-plus"
          aria-label="Add one"
          disabled={dis}
          onClick={() => bump(1)}
          className="btn btn-primary min-h-[96px] w-[30%] !px-0 text-6xl leading-none"
        >
          +
        </button>
      </div>

      <div className="flex gap-2">
        {[-10, -5, 5, 10].map((d) => (
          <button
            key={d}
            type="button"
            className={chip}
            data-testid={`qty-chip-${d}`}
            disabled={dis || (d < 0 && shown <= 0)}
            onClick={() => bump(d)}
          >
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" data-testid="set-count" disabled={dis} onClick={() => setCounting(true)}>
          Set count
        </Button>
        <p className="text-sm text-ink-soft" data-testid="counted-at">
          Last counted: {whenText(location.counted_at)}
        </p>
      </div>

      <details className="rounded-xl border border-surface-line">
        <summary className="flex min-h-touch cursor-pointer items-center px-3 text-base font-bold text-ink-soft">
          {reason ? `Reason: ${reason}` : 'Add a reason (optional)'}
        </summary>
        <div className="flex flex-wrap gap-2 p-3 pt-0" role="group" aria-label="Reason for the next change">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              disabled={dis}
              onClick={() => setReason(reason === r ? null : r)}
              className={`min-h-touch rounded-full border-2 px-4 text-base font-bold ${reason === r ? 'border-maroon bg-maroon text-white' : 'border-surface-line bg-white'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </details>

      <NumberSheet
        open={typing}
        title="Type the exact number"
        help="This sets the number on hand without marking it as counted."
        initial={shown}
        confirmLabel="Save number"
        testId="type-sheet"
        onClose={() => setTyping(false)}
        onConfirm={(n) => {
          setTyping(false);
          bump(n - shown);
        }}
      />
      <NumberSheet
        open={counting}
        title="Set count"
        help="Count what is on the shelf now. This records the count and the time."
        initial={shown}
        confirmLabel="Save count"
        testId="count-sheet"
        onClose={() => setCounting(false)}
        onConfirm={(n) => {
          setCounting(false);
          void setCount(n, versionRef.current, reasonRef.current);
        }}
      />
      <ConflictDialog
        open={!!conflict}
        message={
          conflict ? `Someone else just changed this count. It's now ${conflict.current.on_hand_qty}.` : ''
        }
        canOverwrite={isAdmin}
        onClose={() => setConflict(null)}
        onReload={() => {
          if (conflict) {
            const c = conflict.current;
            versionRef.current = c.version;
            onPartChange((p) => ({
              ...p,
              locations: p.locations.map((l) => (l.slot_id === c.slot_id ? { ...l, ...c } : l)),
            }));
          }
          setConflict(null);
          reload();
        }}
        onOverwrite={() => {
          if (!conflict) return;
          const { current, wanted, reason: why } = conflict;
          setConflict(null);
          void setCount(wanted, current.version, why);
        }}
      />
    </section>
  );
}
