/**
 * Swap this part's spot with another part's spot in one step.
 * Pick the other part by tapping it on the shelf, by typing/searching, or by scanning its label.
 */
import { useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Location, Part, Shelf, Slot } from '../../shared/contract';
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
import { niceZoneName } from '../../shared/units';
import { BottomTabs } from '../components/BottomTabs';
import { PartLookup } from '../components/PartLookup';
import { ShelfChooser } from '../components/ShelfChooser';
import { ShelfFront } from '../components/ShelfFront';
import { Viewfinder } from '../components/Viewfinder';
import { scanFeedback } from '../feedback';
import { checkLabel } from '../scanner';
import { partFitsBin } from '../stock';
import { slotSizeText } from './MoveFlow';

interface Target {
  shelf: Shelf;
  slot: Slot;
}

export function SwapFlow({
  partId,
  fromSlotId,
  onDone,
  onCancel,
}: {
  partId: string;
  fromSlotId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { canEdit, epoch, invalidate } = useSession();
  const toast = useToast();
  const partState = useAsync(() => api.getPart(partId), [partId, epoch]);
  const part = partState.data;
  const fromLoc: Location | null =
    part?.locations.find((l) => l.slot_id === fromSlotId) ?? part?.locations[0] ?? null;

  const [shelfId, setShelfId] = useState<string | null>(null);
  const [changeShelf, setChangeShelf] = useState(false);
  const activeShelfId = shelfId ?? fromLoc?.shelf_id ?? null;
  const shelfState = useAsync(
    () => (activeShelfId ? api.getShelf(activeShelfId) : Promise.resolve(null)),
    [activeShelfId, epoch],
  );
  const fromShelfState = useAsync(
    () => (fromLoc ? api.getShelf(fromLoc.shelf_id) : Promise.resolve(null)),
    [fromLoc?.shelf_id, epoch],
  );
  const groupsState = useAsync(() => api.listShelves(), [epoch]);

  const [target, setTarget] = useState<Target | null>(null);
  const [other, setOther] = useState<Part | null>(null);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <AppHeader
      title="Swap places"
      subtitle={part ? `${part.part_code} · ${part.part_name}` : undefined}
      onBack={onCancel}
    />
  );

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
  if (!part || !fromLoc) {
    return (
      <>
        {header}
        <main className="mx-auto grid max-w-3xl gap-3 px-4 pb-28 pt-4">
          {partState.error ? (
            <ErrorBox message={partState.error.message} onRetry={partState.reload} />
          ) : (
            <p className="card text-lg font-semibold">This part has no place to swap from yet.</p>
          )}
          <Button variant="neutral" onClick={onCancel}>
            Go back
          </Button>
        </main>
      </>
    );
  }

  const shelf = shelfState.data;
  const fromShelf = fromShelfState.data;
  const fromSlot = fromShelf?.slots.find((s) => s.slot_id === fromLoc.slot_id);

  async function chooseOtherPart(p: Part) {
    if (p.part_id === partId) {
      setNote("That's the same part. Pick a different one.");
      return;
    }
    try {
      const full = await api.getPart(p.part_id);
      if (!full.locations.length) {
        setNote(`${full.part_name} has no place on a shelf, so there is nothing to swap with.`);
        setOther(null);
        return;
      }
      setNote(null);
      setOther(full);
      setScanning(false);
    } catch (e) {
      setNote(isApiError(e) ? e.message : "Couldn't look that part up.");
    }
  }

  async function chooseOtherLocation(l: Location) {
    try {
      const s = await api.getShelf(l.shelf_id);
      const slot = s.slots.find((x) => x.slot_id === l.slot_id);
      if (slot) setTarget({ shelf: s, slot });
    } catch (e) {
      setNote(isApiError(e) ? e.message : "Couldn't open that shelf.");
    }
  }

  async function onScanned(text: string) {
    const c = checkLabel(text);
    if (!c.ok) {
      scanFeedback('bad');
      setNote("That isn't one of our part labels.");
      return;
    }
    try {
      const p = await api.getPart(c.partId);
      scanFeedback('ok');
      await chooseOtherPart(p);
    } catch (e) {
      scanFeedback('bad');
      setNote(
        isApiError(e) && e.is('not_found')
          ? 'That label is not in the database.'
          : "Couldn't look that label up.",
      );
    }
  }

  async function doSwap() {
    if (!target || !part || !fromLoc) return;
    setBusy(true);
    try {
      const res = await api.moveLocation({
        part_id: part.part_id,
        from_slot_id: fromLoc.slot_id,
        to_slot_id: target.slot.slot_id,
        mode: 'swap',
      });
      const names = target.slot.parts.map((p) => p.part_name).join(' and ');
      toast.show({
        tone: 'ok',
        message: `Swapped: ${part.part_name} ⇄ ${names}.`,
        undoEventIds: [res.event_id],
        durationMs: 10_000,
        onUndone: invalidate,
      });
      setTarget(null);
      onDone();
    } catch (e) {
      toast.show({ tone: 'error', message: isApiError(e) ? e.message : "Couldn't swap.", durationMs: 6000 });
      shelfState.reload();
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const occupants = target?.slot.parts ?? [];
  const sameSize =
    target && fromSlot
      ? target.slot.width_span === fromSlot.width_span && target.slot.height_span === fromSlot.height_span
      : true;

  return (
    <>
      {header}
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="swap-flow">
        <p className="card text-lg">
          Swapping <strong>{part.part_name}</strong> at{' '}
          <span className="font-mono font-bold text-maroon">{fromLoc.location_code}</span> with another part's
          spot.
        </p>
        {note ? (
          <p
            role="alert"
            className="card border-2 border-amber-600 bg-amber-50 text-base font-bold"
            data-testid="swap-note"
          >
            {note}
          </p>
        ) : null}

        {changeShelf && groupsState.data ? (
          <section>
            <h2 className="mb-2 text-xl font-extrabold">Which shelf?</h2>
            <ShelfChooser
              groups={groupsState.data.groups}
              currentShelfId={activeShelfId}
              onChoose={(id) => {
                setShelfId(id);
                setChangeShelf(false);
              }}
            />
          </section>
        ) : (
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-extrabold">Tap the other part</h2>
                {shelf ? (
                  <p className="text-sm font-semibold text-ink-soft">
                    Shelf {shelf.name} · {niceZoneName(shelf.zone_name)}
                  </p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                onClick={() => setChangeShelf(true)}
                data-testid="swap-change-shelf"
              >
                Change shelf
              </Button>
            </div>
            {shelfState.loading && !shelf ? <Spinner /> : null}
            {shelf ? (
              <div className="rounded-2xl border border-surface-line bg-white p-2">
                <ShelfFront
                  shelf={shelf}
                  pxPerIn={7}
                  highlightSlotIds={[fromLoc.slot_id]}
                  onSlotClick={(slot) => setTarget({ shelf, slot })}
                  selectable={(s) =>
                    s.slot_id !== fromLoc.slot_id && s.parts.some((p) => p.part_id !== partId)
                  }
                  dimUnselectable
                />
              </div>
            ) : null}
            <p className="text-sm text-ink-soft">
              Only spots with a part in them can be picked. The maroon spot is yours.
            </p>
          </section>
        )}

        <section className="card grid gap-3" aria-label="Find the other part">
          <h2 className="text-xl font-extrabold">Or find the other part</h2>
          <PartLookup
            pickMode
            onPick={(p) => void chooseOtherPart(p)}
            onLabelText={(t) => void onScanned(t)}
            label="Type its code or name, or scan with a handheld"
          />
          <Button
            variant="secondary"
            onClick={() => setScanning((v) => !v)}
            aria-pressed={scanning}
            data-testid="swap-scan-toggle"
          >
            {scanning ? 'Close the camera' : '📷 Scan its label with the camera'}
          </Button>
          {scanning ? <Viewfinder enabled onText={(t) => void onScanned(t)} /> : null}
          {other ? (
            <div className="grid gap-2" data-testid="other-locations">
              <p className="text-base font-bold">
                {other.part_name} is in{' '}
                {other.locations.length === 1 ? 'one place' : `${other.locations.length} places`}. Swap with:
              </p>
              {other.locations.map((l) => (
                <Button
                  key={l.slot_id}
                  variant="neutral"
                  disabled={l.slot_id === fromLoc.slot_id}
                  onClick={() => void chooseOtherLocation(l)}
                  data-testid={`other-${l.location_code}`}
                >
                  <span className="font-mono">{l.location_code}</span> · {l.on_hand_qty} on hand
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      </main>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Swap places?" testId="swap-confirm">
        {target ? (
          <>
            <ul className="grid gap-2 text-lg">
              <li className="rounded-xl bg-surface p-3">
                <strong>{part.part_name}</strong> goes to{' '}
                <span className="font-mono font-bold text-maroon">{target.slot.location_code}</span>
                <span className="block text-sm text-ink-soft">
                  That spot is {slotSizeText(target.shelf, target.slot)}.
                </span>
              </li>
              <li className="rounded-xl bg-surface p-3">
                {occupants.length ? (
                  <strong>{occupants.map((p) => p.part_name).join(' and ')}</strong>
                ) : (
                  'Nothing'
                )}{' '}
                goes to <span className="font-mono font-bold text-maroon">{fromLoc.location_code}</span>
                {fromShelf && fromSlot ? (
                  <span className="block text-sm text-ink-soft">
                    That spot is {slotSizeText(fromShelf, fromSlot)}.
                  </span>
                ) : null}
              </li>
            </ul>
            <p className="text-base text-ink-soft" data-testid="swap-explain">
              Counts stay with each part. The spots themselves don't change size
              {sameSize
                ? '.'
                : ', and these two are different sizes, so one part ends up in a bigger or smaller bin.'}
            </p>
            {partFitsBin(part, target.slot) === false ? (
              <p
                role="note"
                className="rounded-xl border-2 border-amber-600 bg-amber-50 p-2 text-base font-semibold"
              >
                ⚠ {part.part_name} is bigger than the bin at {target.slot.location_code}.
              </p>
            ) : null}
            <Button block disabled={busy} onClick={() => void doSwap()} data-testid="confirm-swap">
              Swap places
            </Button>
            <Button block variant="neutral" onClick={() => setTarget(null)}>
              Cancel
            </Button>
          </>
        ) : null}
      </Modal>
      <BottomTabs active="scan" />
    </>
  );
}
