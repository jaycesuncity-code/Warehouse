import { useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Layout, Location, Part, Shelf } from '../../shared/contract';
import {
  AppHeader,
  Button,
  ErrorBox,
  LinkButton,
  Modal,
  Spinner,
  StatusChip,
  useAsync,
  useSession,
  useToast,
  ViewOnlyNote,
} from '../../shared/ui';
import { formatDims, niceZoneName } from '../../shared/units';
import { BottomTabs } from '../components/BottomTabs';
import { FloorPlan } from '../components/FloorPlan';
import { ShelfFront } from '../components/ShelfFront';
import { plainDirections } from '../directions';
import { href, navigate, partPath } from '../router';
import { partFitsBin, stockStatus } from '../stock';
import { UnknownScreen } from './UnknownScreen';

interface WhereData {
  part: Part;
  layout: Layout;
  shelves: Record<string, Shelf>;
}

async function loadWhere(partId: string): Promise<WhereData> {
  const part = await api.getPart(partId);
  const shelfIds = [...new Set(part.locations.map((l) => l.shelf_id))];
  const [layoutRes, shelves] = await Promise.all([
    api.getLayout(),
    Promise.all(shelfIds.map((id) => api.getShelf(id))),
  ]);
  if (layoutRes.notModified) throw new Error('Layout was not sent.');
  return { part, layout: layoutRes.layout, shelves: Object.fromEntries(shelves.map((s) => [s.shelf_id, s])) };
}

export function WhereScreen({ partId }: { partId: string }) {
  const { canEdit, epoch, invalidate } = useSession();
  const toast = useToast();
  const state = useAsync(() => loadWhere(partId), [partId, epoch]);
  const [removing, setRemoving] = useState<Location | null>(null);
  const [busy, setBusy] = useState(false);
  const back = `#${partPath(partId)}`;

  if (state.error && isApiError(state.error) && state.error.is('not_found'))
    return <UnknownScreen partId={partId} />;
  const header = <AppHeader title="Where is it?" backHref={back} />;
  if (state.loading && !state.data) {
    return (
      <>
        {header}
        <Spinner />
        <BottomTabs active="scan" />
      </>
    );
  }
  if (!state.data) {
    return (
      <>
        {header}
        <main className="mx-auto max-w-3xl p-4">
          <ErrorBox message={state.error?.message ?? 'Could not load this part.'} onRetry={state.reload} />
        </main>
        <BottomTabs active="scan" />
      </>
    );
  }

  const { part, layout, shelves } = state.data;

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await api.deleteLocation({ part_id: part.part_id, slot_id: removing.slot_id });
      toast.show({
        tone: 'ok',
        message: `Removed from ${removing.location_code}. The part itself is still in the system.`,
        undoEventIds: [res.event_id],
        onUndone: invalidate,
      });
      setRemoving(null);
      state.reload();
    } catch (e) {
      toast.show({
        tone: 'error',
        message: isApiError(e) ? e.message : "Couldn't remove it.",
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  }

  const act = (path: string, slotId: string) => href(`${partPath(part.part_id)}/${path}`, { slot: slotId });

  return (
    <>
      {header}
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="where-screen">
        <p className="px-1 text-lg font-bold">
          <span data-testid="where-part-name">{part.part_name}</span>{' '}
          <span className="font-mono text-maroon">{part.part_code}</span>
        </p>
        {!canEdit ? <ViewOnlyNote /> : null}

        {part.locations.length === 0 ? (
          <section className="card border-2 border-amber-600 bg-amber-50" data-testid="not-assigned">
            <p className="text-2xl font-extrabold">Not assigned yet</p>
            <p className="mt-1 text-base">This part has not been given a place on a shelf.</p>
            {canEdit ? (
              <LinkButton
                className="mt-3 !min-h-[72px] !text-2xl"
                block
                href={href(`${partPath(part.part_id)}/move`)}
                data-testid="put-somewhere"
              >
                Put it somewhere
              </LinkButton>
            ) : (
              <Button className="mt-3" block disabled data-testid="put-somewhere">
                Put it somewhere
              </Button>
            )}
          </section>
        ) : null}

        {part.locations.map((loc) => {
          const shelf = shelves[loc.shelf_id];
          const slot = shelf?.slots.find((s) => s.slot_id === loc.slot_id);
          const fits = slot ? partFitsBin(part, slot) : null;
          return (
            <section
              key={loc.slot_id}
              className="card grid gap-3"
              aria-label={`Location ${loc.location_code}`}
              data-testid="where-card"
              data-location={loc.location_code}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="label-xs">Location code</p>
                  <p
                    className="font-mono text-4xl font-extrabold leading-tight text-maroon"
                    data-testid="where-code"
                  >
                    {loc.location_code}
                  </p>
                  <p className="text-lg font-bold" data-testid="where-zone-shelf">
                    {niceZoneName(loc.zone_name)} · Shelf {loc.shelf_name}
                  </p>
                </div>
                <div className="text-right">
                  <StatusChip status={stockStatus(loc.on_hand_qty, loc.par_qty, part.reorder_point)} />
                  <p className="mt-1 text-base font-bold">
                    {loc.on_hand_qty} <span className="font-medium text-ink-soft">of {loc.par_qty}</span>
                  </p>
                </div>
              </div>

              {shelf ? (
                <p
                  className="rounded-xl bg-maroon-tint p-3 text-lg font-semibold leading-snug"
                  data-testid="directions"
                >
                  {plainDirections(loc, shelf)}
                </p>
              ) : null}

              {loc.issued_kit_id && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="issued-kit-note">
                  Issued in a kit. Use the return count to reconcile these parts.
                  <a href="/packouts/" className="ml-1 font-bold text-maroon underline">Open packouts →</a>
                </p>
              )}
              {loc.co_located_parts.length ? (
                <p className="text-base" data-testid="shares-slot">
                  <strong>Shares this slot with:</strong>{' '}
                  {loc.co_located_parts.map((p) => p.part_name).join(', ')}
                </p>
              ) : null}
              {fits === false && slot ? (
                <p
                  role="note"
                  className="rounded-xl border-2 border-amber-600 bg-amber-50 p-2 text-base font-semibold"
                  data-testid="fit-warning"
                >
                  ⚠ This part ({formatDims(part.width_in, part.height_in, part.depth_in)}) is bigger than its
                  bin ({formatDims(slot.bin_width_in, slot.bin_height_in, slot.bin_depth_in)}).
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                {shelf ? (
                  <div>
                    <p className="label-xs mb-1">Shelf front (standing in the aisle)</p>
                    <ShelfFront shelf={shelf} highlightSlotIds={[loc.slot_id]} />
                  </div>
                ) : null}
                <div>
                  <p className="label-xs mb-1">Floor plan</p>
                  <FloorPlan
                    layout={layout}
                    shelfId={loc.shelf_id}
                    slotId={loc.slot_id}
                    maxW={300}
                    maxH={280}
                  />
                </div>
              </div>

              <a
                href={`/map/?shelf=${encodeURIComponent(loc.shelf_id)}&slot=${encodeURIComponent(loc.slot_id)}&part=${encodeURIComponent(part.part_id)}`}
                data-testid="open-3d"
                className="inline-flex min-h-touch items-center text-lg font-bold text-maroon underline"
              >
                Open in 3D map →
              </a>

              <div className="grid grid-cols-2 gap-2">
                {canEdit && !loc.issued_kit_id ? (
                  <>
                    <LinkButton href={act('move', loc.slot_id)} data-testid="btn-move">
                      Move
                    </LinkButton>
                    <LinkButton href={act('swap', loc.slot_id)} variant="secondary" data-testid="btn-swap">
                      Swap
                    </LinkButton>
                    <LinkButton
                      href={act('resize', loc.slot_id)}
                      variant="secondary"
                      data-testid="btn-resize"
                    >
                      Resize bin
                    </LinkButton>
                    <Button variant="neutral" data-testid="btn-remove" onClick={() => setRemoving(loc)}>
                      Remove from this slot
                    </Button>
                  </>
                ) : (
                  ['Move', 'Swap', 'Resize bin', 'Remove from this slot'].map((t) => (
                    <Button key={t} variant="neutral" disabled aria-disabled="true">
                      {t}
                    </Button>
                  ))
                )}
              </div>
            </section>
          );
        })}

        {part.locations.length ? (
          canEdit ? (
            <LinkButton
              href={href(`${partPath(part.part_id)}/move`, { mode: 'add', slot: part.locations[0].slot_id })}
              variant="secondary"
              data-testid="btn-add-location"
              block
            >
              + Add another location
            </LinkButton>
          ) : (
            <Button variant="neutral" block disabled>
              + Add another location
            </Button>
          )
        ) : null}
        <Button variant="neutral" block onClick={() => navigate(partPath(part.part_id))}>
          Back to the part
        </Button>
      </main>

      <Modal
        open={!!removing}
        title="Remove from this slot?"
        onClose={() => setRemoving(null)}
        tone="warn"
        testId="remove-dialog"
      >
        <p className="text-lg">
          Take <strong>{part.part_name}</strong> out of{' '}
          <strong className="font-mono">{removing?.location_code}</strong>? The part stays in the system; it
          just won't have a place here
          {removing && removing.on_hand_qty > 0
            ? ` (${removing.on_hand_qty} on hand will no longer be counted in this slot)`
            : ''}
          .
        </p>
        <div className="grid gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void confirmRemove()}
            data-testid="confirm-remove"
          >
            Yes, remove it
          </Button>
          <Button variant="neutral" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
      <BottomTabs active="scan" />
    </>
  );
}
