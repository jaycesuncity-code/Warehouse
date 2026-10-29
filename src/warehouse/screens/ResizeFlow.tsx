/**
 * Resize a bin: width and height in grid cells with a live footprint preview on the shelf front.
 * It grows right and up from the bottom-left corner unless you pick another corner to hold still.
 * A slot can never overlap another slot; if the new size would, the neighbors are listed with ways out.
 */
import { useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { BinType, Location, ResizeAnchor, Slot } from '../../shared/contract';
import { findOverlaps, largestFreeSize, rectOf, resizeRect, withinGrid } from '../../shared/grid';
import {
  AppHeader,
  Button,
  ConflictDialog,
  ErrorBox,
  FtInInput,
  Spinner,
  useAsync,
  useSession,
  useToast,
  ViewOnlyNote,
} from '../../shared/ui';
import { binExceedsSlot, formatDims, formatFtIn, niceZoneName, slotRect } from '../../shared/units';
import { BottomTabs } from '../components/BottomTabs';
import { ShelfFront } from '../components/ShelfFront';
import { Stepper } from '../components/Stepper';
import { MoveFlow } from './MoveFlow';

const ANCHORS: { id: ResizeAnchor; label: string; arrow: string }[] = [
  { id: 'top-left', label: 'Top-left', arrow: '↖' },
  { id: 'top-right', label: 'Top-right', arrow: '↗' },
  { id: 'bottom-left', label: 'Bottom-left', arrow: '↙' },
  { id: 'bottom-right', label: 'Bottom-right', arrow: '↘' },
];
const BIN_TYPES: BinType[] = ['bin', 'box', 'tote', 'loose', 'drawer'];

interface Props {
  partId: string;
  slotId: string | null;
  onDone: () => void;
  onCancel: () => void;
}

export function ResizeFlow({ partId, slotId, onDone, onCancel }: Props) {
  const { canEdit, isAdmin, epoch, invalidate } = useSession();
  const toast = useToast();
  const partState = useAsync(() => api.getPart(partId), [partId, epoch]);
  const part = partState.data;
  const loc: Location | null =
    part?.locations.find((l) => l.slot_id === slotId) ?? part?.locations[0] ?? null;
  const shelfState = useAsync(
    () => (loc ? api.getShelf(loc.shelf_id) : Promise.resolve(null)),
    [loc?.shelf_id, epoch],
  );
  const shelf = shelfState.data;
  const slot: Slot | null = shelf?.slots.find((s) => s.slot_id === loc?.slot_id) ?? null;

  const [w, setW] = useState<number | null>(null);
  const [h, setH] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<ResizeAnchor>('bottom-left');
  const [binType, setBinType] = useState<BinType | null | undefined>(undefined);
  const [bw, setBw] = useState<number | null | undefined>(undefined);
  const [bh, setBh] = useState<number | null | undefined>(undefined);
  const [bd, setBd] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ current: Slot } | null>(null);
  const [nested, setNested] = useState<{ partId: string; fromSlotId: string } | null>(null);

  const header = (
    <AppHeader
      title="Resize bin"
      subtitle={part ? `${part.part_code} · ${part.part_name}` : undefined}
      onBack={onCancel}
    />
  );

  if (nested) {
    return (
      <>
        {header}
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">
          <MoveFlow
            partId={nested.partId}
            fromSlotId={nested.fromSlotId}
            depth={1}
            onCancel={() => setNested(null)}
            onDone={() => {
              setNested(null);
              shelfState.reload();
            }}
          />
        </main>
      </>
    );
  }

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
  if ((partState.loading && !part) || (shelfState.loading && !shelf))
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  if (!part || !loc || !shelf || !slot) {
    return (
      <>
        {header}
        <main className="mx-auto grid max-w-3xl gap-3 px-4 pb-28 pt-4">
          {partState.error || shelfState.error ? (
            <ErrorBox
              message={(partState.error ?? shelfState.error)!.message}
              onRetry={() => {
                partState.reload();
                shelfState.reload();
              }}
            />
          ) : (
            <p className="card text-lg font-semibold">This part has no bin to resize yet.</p>
          )}
          <Button variant="neutral" onClick={onCancel}>
            Go back
          </Button>
        </main>
      </>
    );
  }

  // ---- derived values ----
  const wNow = w ?? slot.width_span;
  const hNow = h ?? slot.height_span;
  const bin = {
    type: binType === undefined ? slot.bin_type : binType,
    w: bw === undefined ? slot.bin_width_in : bw,
    h: bh === undefined ? slot.bin_height_in : bh,
    d: bd === undefined ? slot.bin_depth_in : bd,
  };
  const rect = resizeRect(rectOf(slot), wNow, hNow, anchor);
  const inGrid = withinGrid(rect, shelf.cols, shelf.rows.length);
  const overlaps = inGrid ? findOverlaps(rect, shelf.slots, slot.slot_id) : [];
  const ok = inGrid && overlaps.length === 0;
  const sizeChanged = wNow !== slot.width_span || hNow !== slot.height_span;
  const binChanged =
    bin.type !== slot.bin_type ||
    bin.w !== slot.bin_width_in ||
    bin.h !== slot.bin_height_in ||
    bin.d !== slot.bin_depth_in;
  const pr = inGrid ? slotRect(shelf, rect) : slotRect(shelf, slot);
  const binTooBig =
    inGrid &&
    binExceedsSlot(shelf, { ...rect, bin_width_in: bin.w, bin_height_in: bin.h, bin_depth_in: bin.d });
  const maxW = shelf.cols;
  const maxH = shelf.rows.length;
  const others = shelf.slots.filter((s) => s.slot_id !== slot.slot_id);

  async function apply(forceVersion?: number) {
    if (!slot) return;
    setBusy(true);
    const events: string[] = [];
    try {
      let version = forceVersion ?? slot.version;
      if (sizeChanged) {
        const r = await api.resizeSlot(slot.slot_id, {
          width_span: wNow,
          height_span: hNow,
          anchor,
          version,
        });
        events.unshift(r.event_id);
        version = r.slot.version;
      }
      if (binChanged) {
        const r = await api.patchSlot(slot.slot_id, {
          version,
          bin_type: bin.type,
          bin_width_in: bin.w,
          bin_height_in: bin.h,
          bin_depth_in: bin.d,
        });
        events.unshift(r.event_id);
      }
      toast.show({
        tone: 'ok',
        message: `${slot.location_code}: ${sizeChanged ? `now ${wNow} wide × ${hNow} tall` : 'bin size saved'}.`,
        undoEventIds: events,
        durationMs: 10_000,
        onUndone: invalidate,
      });
      onDone();
    } catch (e) {
      if (isApiError(e) && e.is('version_conflict')) {
        const current = e.current<Slot>();
        if (current) setConflict({ current });
      } else if (isApiError(e) && e.is('slot_occupied')) {
        toast.show({
          tone: 'warn',
          message: 'Something is in the way now. Check the preview and try again.',
          durationMs: 6000,
        });
      } else {
        toast.show({
          tone: 'error',
          message: isApiError(e) ? e.message : "Couldn't resize.",
          durationMs: 6000,
        });
      }
      shelfState.reload();
    } finally {
      setBusy(false);
    }
  }

  async function removeEmpty(s: Slot) {
    try {
      const res = await api.deleteSlot(s.slot_id);
      toast.show({
        tone: 'ok',
        message: `Removed empty spot ${s.location_code}.`,
        undoEventIds: [res.event_id],
        onUndone: shelfState.reload,
      });
      shelfState.reload();
    } catch (e) {
      toast.show({
        tone: 'error',
        message: isApiError(e) ? e.message : "Couldn't remove that spot.",
        durationMs: 6000,
      });
    }
  }

  function biggestThatFits() {
    if (!slot) return;
    const best = largestFreeSize(slot, others, anchor, shelf!.cols, shelf!.rows.length, {
      width: wNow,
      height: hNow,
    });
    setW(best.width);
    setH(best.height);
  }

  return (
    <>
      {header}
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4" data-testid="resize-flow">
        <section className="card grid gap-1">
          <p className="text-lg">
            Bin <span className="font-mono font-extrabold text-maroon">{slot.location_code}</span> on shelf{' '}
            {shelf.name} · {niceZoneName(shelf.zone_name)}
          </p>
          <p className="text-base text-ink-soft" data-testid="current-size">
            Now: {slot.width_span} wide × {slot.height_span} tall ({formatFtIn(slotRect(shelf, slot).width)} ×{' '}
            {formatFtIn(slotRect(shelf, slot).height)})
          </p>
        </section>

        <section className="card grid gap-3">
          <h2 className="text-xl font-extrabold">New size</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="label-xs mb-1">Width (cells across)</p>
              <Stepper
                label="Width"
                value={wNow}
                min={1}
                max={maxW}
                onChange={setW}
                testId="width-stepper"
                hint={`${formatFtIn(pr.width)} wide`}
              />
            </div>
            <div>
              <p className="label-xs mb-1">Height (rows up)</p>
              <Stepper
                label="Height"
                value={hNow}
                min={1}
                max={maxH}
                onChange={setH}
                testId="height-stepper"
                hint={`${formatFtIn(pr.height)} tall`}
              />
            </div>
          </div>
          <fieldset>
            <legend className="label-xs mb-1">Keep this corner fixed (it grows away from it)</legend>
            <div role="radiogroup" aria-label="Fixed corner" className="grid grid-cols-2 gap-2">
              {ANCHORS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={anchor === a.id}
                  data-testid={`anchor-${a.id}`}
                  onClick={() => setAnchor(a.id)}
                  className={`min-h-touch rounded-xl border-2 px-2 text-base font-bold ${anchor === a.id ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                >
                  <span aria-hidden="true" className="mr-1 text-xl">
                    {a.arrow}
                  </span>
                  {a.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-ink-soft">The dashed box on the shelf shows where the bin will be.</p>
          <div className="rounded-2xl border border-surface-line bg-white p-2">
            <ShelfFront
              shelf={shelf}
              pxPerIn={7}
              highlightSlotIds={[slot.slot_id]}
              ghost={sizeChanged && inGrid ? { rect, ok } : null}
            />
          </div>
        </section>

        {!inGrid ? (
          <section
            role="alert"
            className="card border-2 border-amber-600 bg-amber-50"
            data-testid="resize-edge"
          >
            <p className="text-lg font-extrabold">That would go past the edge of the shelf.</p>
            <p className="text-base">Pick a smaller size, or hold a different corner fixed.</p>
            <Button className="mt-2" variant="secondary" onClick={biggestThatFits}>
              Use the biggest size that fits
            </Button>
          </section>
        ) : null}

        {overlaps.length ? (
          <section
            role="alert"
            className="card grid gap-3 border-2 border-amber-600 bg-amber-50"
            data-testid="resize-overlap"
          >
            <p className="text-lg font-extrabold">
              That size runs into{' '}
              {overlaps.length === 1 ? 'a neighboring spot' : `${overlaps.length} neighboring spots`}:
            </p>
            <ul className="grid gap-2">
              {overlaps.map((o) => (
                <li key={o.slot_id} className="rounded-xl bg-white p-3" data-testid="overlap-item">
                  <p className="font-mono text-lg font-extrabold">{o.location_code}</p>
                  <p className="text-base">
                    {o.parts.length
                      ? o.parts.map((p) => `${p.part_name} (on hand ${p.on_hand_qty})`).join(', ')
                      : 'Empty spot'}
                  </p>
                  <div className="mt-2 grid gap-2">
                    {o.parts.map((p) => (
                      <Button
                        key={p.part_id}
                        variant="secondary"
                        data-testid="overlap-move"
                        onClick={() => setNested({ partId: p.part_id, fromSlotId: o.slot_id })}
                      >
                        Move {p.part_name} somewhere else
                      </Button>
                    ))}
                    {o.parts.length === 0 ? (
                      <Button
                        variant="secondary"
                        data-testid="overlap-remove"
                        onClick={() => void removeEmpty(o)}
                      >
                        Remove the empty spot {o.location_code}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="neutral" data-testid="biggest-fit" onClick={biggestThatFits}>
              Pick a different size: the biggest that fits
            </Button>
            <p className="text-sm text-ink-soft">
              A spot can never overlap another one. After the way is clear, this screen updates by itself.
            </p>
          </section>
        ) : null}

        <section className="card grid gap-3">
          <h2 className="text-xl font-extrabold">Real bin size (optional)</h2>
          <p className="text-sm text-ink-soft">
            The container itself, in inches or feet-inches (15 or 1'-3").
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <FtInInput label="Width" value={bin.w ?? null} onChange={(v) => setBw(v)} optional />
            <FtInInput label="Height" value={bin.h ?? null} onChange={(v) => setBh(v)} optional />
            <FtInInput label="Depth" value={bin.d ?? null} onChange={(v) => setBd(v)} optional />
          </div>
          <div>
            <label htmlFor="bin-type" className="label-xs">
              Kind of container
            </label>
            <select
              id="bin-type"
              value={bin.type ?? ''}
              onChange={(e) => setBinType((e.target.value || null) as BinType | null)}
              className="mt-1 min-h-touch w-full rounded-xl border-2 border-surface-line bg-white px-3 text-lg font-semibold"
            >
              <option value="">Not set</option>
              {BIN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          {binTooBig ? (
            <p
              role="note"
              className="rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-base font-semibold"
              data-testid="bin-warning"
            >
              ⚠ This bin ({formatDims(bin.w ?? null, bin.h ?? null, bin.d ?? null)}) is bigger than the spot (
              {formatFtIn(pr.width)} × {formatFtIn(pr.height)}). You can still save it.
            </p>
          ) : null}
        </section>

        <div className="grid gap-2">
          <Button
            block
            disabled={busy || !ok || (!sizeChanged && !binChanged)}
            onClick={() => void apply()}
            data-testid="apply-resize"
          >
            {sizeChanged ? `Save: ${wNow} wide × ${hNow} tall` : 'Save'}
          </Button>
          <Button block variant="neutral" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </main>

      <ConflictDialog
        open={!!conflict}
        message="Someone else just changed this bin. Reload to see their change."
        canOverwrite={isAdmin}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          setW(null);
          setH(null);
          shelfState.reload();
        }}
        onOverwrite={() => {
          const v = conflict?.current.version;
          setConflict(null);
          if (v !== undefined) void apply(v);
        }}
      />
      <BottomTabs active="scan" />
    </>
  );
}
