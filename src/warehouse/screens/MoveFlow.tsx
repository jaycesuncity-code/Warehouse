/**
 * Move a part (or put it somewhere for the first time).
 *   1. choose the shelf  2. tap the target slot on the shelf front  3. one confirm.
 * If something is already in the target (409 slot_occupied) the follow-up options appear as big buttons:
 * swap places / put both here / move that part somewhere else first / choose a different spot / cancel.
 */
import { useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { MoveMode, Shelf, Slot, SlotConflict } from '../../shared/contract';
import {
  AppHeader,
  Button,
  ErrorBox,
  Modal,
  Spinner,
  useAsync,
  useSession,
  useToast,
  ViewOnlyNote,
} from '../../shared/ui';
import { formatDims, formatFtIn, niceZoneName, slotRect } from '../../shared/units';
import { BottomTabs } from '../components/BottomTabs';
import { ShelfChooser } from '../components/ShelfChooser';
import { ShelfFront } from '../components/ShelfFront';
import { Stepper } from '../components/Stepper';
import { partFitsBin } from '../stock';

type Choice = 'leave' | 'keep';

interface Attempt {
  mode: MoveMode;
  toSlot: Slot;
  fromSlotId?: string;
  par?: number;
  onHand?: number;
}

export interface MoveFlowProps {
  partId: string;
  /** The slot the part is leaving. Omit for a part with no place yet. */
  fromSlotId?: string | null;
  initialChoice?: Choice;
  depth?: number;
  onDone: () => void;
  onCancel: () => void;
}

export const slotSizeText = (shelf: Shelf, slot: Slot): string => {
  const r = slotRect(shelf, slot);
  return `${slot.width_span} wide × ${slot.height_span} tall (${formatFtIn(r.width)} × ${formatFtIn(r.height)})`;
};

export function MoveFlow({
  partId,
  fromSlotId = null,
  initialChoice = 'leave',
  depth = 0,
  onDone,
  onCancel,
}: MoveFlowProps) {
  const { canEdit, epoch, invalidate } = useSession();
  const toast = useToast();
  const partState = useAsync(() => api.getPart(partId), [partId, epoch]);
  const groupsState = useAsync(() => api.listShelves(), [epoch]);
  const part = partState.data;
  const fromLoc = part?.locations.find((l) => l.slot_id === fromSlotId) ?? null;

  const [shelfId, setShelfId] = useState<string | null>(null);
  const shelfState = useAsync(
    () => (shelfId ? api.getShelf(shelfId) : Promise.resolve(null)),
    [shelfId, epoch],
  );
  const fromShelfState = useAsync(
    () => (fromLoc ? api.getShelf(fromLoc.shelf_id) : Promise.resolve(null)),
    [fromLoc?.shelf_id, epoch],
  );
  const shelf = shelfState.data;
  const fromShelf = fromShelfState.data;

  const [picked, setPicked] = useState<Slot | null>(null);
  const [choice, setChoice] = useState<Choice>(initialChoice);
  const [par, setPar] = useState(0);
  const [onHand, setOnHand] = useState(0);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ conflicts: SlotConflict[]; attempt: Attempt } | null>(null);
  const [nested, setNested] = useState<{ partId: string; fromSlotId: string } | null>(null);

  function pickSlot(slot: Slot) {
    setPicked(slot);
    setPar(fromLoc?.par_qty ?? 0);
    setOnHand(choice === 'keep' ? 0 : (fromLoc?.on_hand_qty ?? 0));
  }

  async function run(a: Attempt) {
    if (!part) return;
    setBusy(true);
    try {
      const res = await api.moveLocation({
        part_id: part.part_id,
        ...(a.fromSlotId ? { from_slot_id: a.fromSlotId } : {}),
        to_slot_id: a.toSlot.slot_id,
        mode: a.mode,
        ...(a.par !== undefined ? { par_qty: a.par } : {}),
        ...(a.onHand !== undefined ? { on_hand_qty: a.onHand } : {}),
      });
      const msg =
        a.mode === 'swap'
          ? `Swapped: ${part.part_name} is now at ${a.toSlot.location_code}${res.displaced_parts?.length ? `, ${res.displaced_parts.map((p) => p.part_name).join(' and ')} moved to ${fromLoc?.location_code ?? 'the old spot'}` : ''}.`
          : a.mode === 'share'
            ? `${part.part_name} now shares ${a.toSlot.location_code}.`
            : a.mode === 'add'
              ? `${part.part_name} is also stored at ${a.toSlot.location_code}.`
              : `Moved ${part.part_name} to ${a.toSlot.location_code}.`;
      toast.show({
        tone: 'ok',
        message: msg,
        undoEventIds: [res.event_id],
        durationMs: 10_000,
        onUndone: invalidate,
      });
      setPicked(null);
      setConflict(null);
      onDone();
    } catch (e) {
      if (isApiError(e) && e.is('slot_occupied')) {
        setPicked(null);
        setConflict({ conflicts: e.conflicts, attempt: a });
        shelfState.reload();
      } else {
        toast.show({
          tone: 'error',
          message: isApiError(e) ? e.message : "Couldn't move it.",
          durationMs: 6000,
        });
        shelfState.reload();
        setPicked(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!picked) return;
    if (!fromLoc) {
      void run({ mode: 'add', toSlot: picked, par, onHand });
    } else if (choice === 'leave') {
      void run({ mode: 'move', toSlot: picked, fromSlotId: fromLoc.slot_id });
    } else {
      void run({ mode: 'add', toSlot: picked, par, onHand });
    }
  }

  // ---- nested: move the occupant out of the way first, then retry ----
  if (nested) {
    return (
      <MoveFlow
        partId={nested.partId}
        fromSlotId={nested.fromSlotId}
        depth={depth + 1}
        onCancel={() => setNested(null)}
        onDone={() => {
          setNested(null);
          if (conflict) void run(conflict.attempt);
        }}
      />
    );
  }

  const header =
    depth === 0 ? (
      <AppHeader
        title={fromLoc ? 'Move it' : 'Put it somewhere'}
        onBack={onCancel}
        subtitle={part ? `${part.part_code} · ${part.part_name}` : undefined}
      />
    ) : null;

  if (!canEdit) {
    return (
      <>
        {header}
        <main className="mx-auto grid max-w-3xl gap-3 px-4 pb-28 pt-4">
          <ViewOnlyNote />
          <Button variant="neutral" onClick={onCancel}>
            Go back
          </Button>
        </main>
      </>
    );
  }
  if (partState.loading && !part)
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  if (!part) {
    return (
      <>
        {header}
        <main className="mx-auto max-w-3xl p-4">
          <ErrorBox
            message={partState.error?.message ?? 'Could not load the part.'}
            onRetry={partState.reload}
          >
            <Button variant="neutral" onClick={onCancel}>
              Back
            </Button>
          </ErrorBox>
        </main>
      </>
    );
  }

  const myShelfId = fromLoc?.shelf_id ?? null;
  const occupiedHere = (s: Slot) => s.parts.filter((p) => p.part_id !== part.part_id);
  const alreadyIn = new Set(part.locations.map((l) => l.slot_id));
  const pickedOccupants = picked ? occupiedHere(picked) : [];
  const fits = picked && shelf ? partFitsBin(part, picked) : null;

  const body = (
    <div className="grid gap-4" data-testid="move-flow" data-depth={depth}>
      {depth > 0 ? (
        <p
          className="card border-2 border-amber-600 bg-amber-50 text-lg font-bold"
          data-testid="nested-banner"
        >
          Step 1: move <span className="underline">{part.part_name}</span> somewhere else. Then we'll finish
          the first move.
        </p>
      ) : null}
      {depth > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold">Where should it go?</h2>
          <Button variant="neutral" onClick={onCancel}>
            Back
          </Button>
        </div>
      ) : null}

      {!shelfId ? (
        <section>
          <h2 className="mb-2 text-xl font-extrabold">Which shelf?</h2>
          {groupsState.loading && !groupsState.data ? <Spinner /> : null}
          {groupsState.error ? (
            <ErrorBox message={groupsState.error.message} onRetry={groupsState.reload} />
          ) : null}
          {groupsState.data ? (
            <ShelfChooser groups={groupsState.data.groups} currentShelfId={myShelfId} onChoose={setShelfId} />
          ) : null}
        </section>
      ) : (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-extrabold">Tap the spot</h2>
              {shelf ? (
                <p className="text-sm font-semibold text-ink-soft">
                  Shelf {shelf.name} · {niceZoneName(shelf.zone_name)}
                </p>
              ) : null}
            </div>
            <Button variant="secondary" onClick={() => setShelfId(null)} data-testid="change-shelf">
              Change shelf
            </Button>
          </div>
          <p className="text-base text-ink-soft">
            Dashed = free. Solid = something is there. Standing in the aisle, facing the shelf. Row{' '}
            <strong>G</strong> is on the ground.
          </p>
          {shelfState.loading && !shelf ? <Spinner /> : null}
          {shelfState.error ? (
            <ErrorBox message={shelfState.error.message} onRetry={shelfState.reload} />
          ) : null}
          {shelf ? (
            <div className="rounded-2xl border border-surface-line bg-white p-2">
              <ShelfFront
                shelf={shelf}
                pxPerIn={7}
                highlightSlotIds={fromLoc && fromLoc.shelf_id === shelf.shelf_id ? [fromLoc.slot_id] : []}
                selectedSlotId={picked?.slot_id}
                onSlotClick={pickSlot}
                selectable={(s) => !alreadyIn.has(s.slot_id)}
                dimUnselectable
              />
            </div>
          ) : null}
          {fromLoc ? (
            <p className="text-sm text-ink-soft">
              The maroon spot ({fromLoc.location_code}) is where it is now.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );

  return (
    <>
      {header}
      {depth === 0 ? <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">{body}</main> : body}

      {/* Confirm */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={
          fromLoc ? `Move to ${picked?.location_code ?? ''}?` : `Put it at ${picked?.location_code ?? ''}?`
        }
        testId="move-confirm"
      >
        {picked && shelf ? (
          <>
            <p className="text-lg">
              <strong>{part.part_name}</strong>
              <br />
              {fromLoc ? (
                <>
                  <span className="font-mono font-bold">{fromLoc.location_code}</span> →{' '}
                  <span className="font-mono font-bold text-maroon">{picked.location_code}</span>
                </>
              ) : (
                <>
                  Not assigned yet →{' '}
                  <span className="font-mono font-bold text-maroon">{picked.location_code}</span>
                </>
              )}
              <br />
              <span className="text-base text-ink-soft">Spot is {slotSizeText(shelf, picked)}</span>
            </p>
            {pickedOccupants.length ? (
              <p
                role="note"
                className="rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-base font-bold"
                data-testid="occupied-note"
              >
                Heads up: {pickedOccupants.map((p) => p.part_name).join(' and ')}{' '}
                {pickedOccupants.length === 1 ? 'is' : 'are'} already here. You'll get choices next.
              </p>
            ) : null}
            {fits === false ? (
              <p
                role="note"
                className="rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-base font-semibold"
              >
                ⚠ This part ({formatDims(part.width_in, part.height_in, part.depth_in)}) is bigger than the
                bin there ({formatDims(picked.bin_width_in, picked.bin_height_in, picked.bin_depth_in)}).
              </p>
            ) : null}

            {fromLoc ? (
              <div role="radiogroup" aria-label="What to do with the old spot" className="grid gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={choice === 'leave'}
                  data-testid="choice-leave"
                  onClick={() => {
                    setChoice('leave');
                    setOnHand(fromLoc.on_hand_qty);
                  }}
                  className={`min-h-touch rounded-xl border-2 px-3 py-2 text-left text-lg font-bold ${choice === 'leave' ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                >
                  Move (leave the old spot)
                  <span className="block text-sm font-medium text-ink-soft">
                    Par {fromLoc.par_qty} and {fromLoc.on_hand_qty} on hand go with it.
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={choice === 'keep'}
                  data-testid="choice-keep"
                  onClick={() => {
                    setChoice('keep');
                    setOnHand(0);
                  }}
                  className={`min-h-touch rounded-xl border-2 px-3 py-2 text-left text-lg font-bold ${choice === 'keep' ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                >
                  Also keep it in the old spot
                  <span className="block text-sm font-medium text-ink-soft">
                    Adds a second place. Set its numbers below.
                  </span>
                </button>
              </div>
            ) : (
              <p className="text-base text-ink-soft">
                Set how many fit when full (par) and how many are there now.
              </p>
            )}

            {!fromLoc || choice === 'keep' ? (
              <div className="grid gap-3 rounded-xl bg-surface p-3">
                <div>
                  <p className="label-xs mb-1">Par (full)</p>
                  <Stepper label="Par" value={par} onChange={setPar} max={100000} testId="par-stepper" />
                </div>
                <div>
                  <p className="label-xs mb-1">On hand now</p>
                  <Stepper
                    label="On hand"
                    value={onHand}
                    onChange={setOnHand}
                    max={100000}
                    testId="onhand-stepper"
                  />
                </div>
              </div>
            ) : null}

            <Button block disabled={busy} onClick={confirm} data-testid="confirm-move">
              {fromLoc ? (choice === 'leave' ? 'Confirm move' : 'Confirm: keep both places') : 'Put it here'}
            </Button>
            <Button block variant="neutral" onClick={() => setPicked(null)}>
              Choose a different spot
            </Button>
          </>
        ) : null}
      </Modal>

      {/* Something is already there */}
      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        tone="warn"
        title="Something's already here"
        testId="occupied-dialog"
      >
        {conflict
          ? (() => {
              const a = conflict.attempt;
              const occupants = conflict.conflicts.flatMap((c) =>
                c.parts.map((p) => ({ ...p, slot_id: c.slot_id, code: c.location_code })),
              );
              const target = shelf?.slots.find((s) => s.slot_id === a.toSlot.slot_id) ?? a.toSlot;
              const canSwap = a.mode === 'move' && !!a.fromSlotId;
              const fromSlot = fromShelf?.slots.find((s) => s.slot_id === a.fromSlotId);
              return (
                <>
                  <ul className="grid gap-2" data-testid="occupants">
                    {occupants.map((o) => (
                      <li
                        key={`${o.slot_id}-${o.part_id}`}
                        className="rounded-xl bg-amber-50 p-3 text-lg font-bold"
                      >
                        Something's already here: {o.part_name} (on hand {o.on_hand_qty})
                        <span className="block font-mono text-sm font-semibold text-ink-soft">{o.code}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-2">
                    {canSwap ? (
                      <div>
                        <Button
                          block
                          data-testid="opt-swap"
                          disabled={busy}
                          onClick={() => void run({ ...a, mode: 'swap' })}
                        >
                          Swap places
                        </Button>
                        <p className="mt-1 text-sm text-ink-soft">
                          {part.part_name} goes to {target.location_code};{' '}
                          {occupants.map((o) => o.part_name).join(' and ')} goes to{' '}
                          {fromLoc?.location_code ?? 'your old spot'}.
                          {fromShelf && fromSlot && shelf ? (
                            <>
                              {' '}
                              Their spot is {slotSizeText(shelf, target)}; yours is{' '}
                              {slotSizeText(fromShelf, fromSlot)}. The spots keep their own size; only the
                              parts trade places.
                            </>
                          ) : null}
                        </p>
                      </div>
                    ) : null}
                    <div>
                      <Button
                        block
                        variant="secondary"
                        data-testid="opt-share"
                        disabled={busy}
                        onClick={() => void run({ ...a, mode: 'share' })}
                      >
                        Put both here
                      </Button>
                      <p className="mt-1 text-sm text-ink-soft">
                        They share the same bin. Nothing else moves.
                      </p>
                    </div>
                    {occupants.map((o) => (
                      <Button
                        key={`mv-${o.slot_id}-${o.part_id}`}
                        block
                        variant="secondary"
                        data-testid="opt-move-other"
                        disabled={busy}
                        onClick={() => setNested({ partId: o.part_id, fromSlotId: o.slot_id })}
                      >
                        Move {o.part_name} somewhere else first
                      </Button>
                    ))}
                    <Button
                      block
                      variant="neutral"
                      data-testid="opt-different"
                      onClick={() => setConflict(null)}
                    >
                      Choose a different spot
                    </Button>
                    <Button
                      block
                      variant="neutral"
                      data-testid="opt-cancel"
                      onClick={() => {
                        setConflict(null);
                        onCancel();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              );
            })()
          : null}
      </Modal>
      {depth === 0 ? <BottomTabs active="scan" /> : null}
    </>
  );
}
