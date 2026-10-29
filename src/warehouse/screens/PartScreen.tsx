import { useEffect, useState } from 'react';
import { api, isApiError } from '../../shared/api';
import type { Part } from '../../shared/contract';
import {
  AppHeader,
  Button,
  DepartmentChip,
  ErrorBox,
  LinkButton,
  money,
  plural,
  Spinner,
  StatusChip,
  useAsync,
  useSession,
  useToast,
  ViewOnlyNote,
} from '../../shared/ui';
import { formatDims } from '../../shared/units';
import { BottomTabs } from '../components/BottomTabs';
import { QtyAdjust } from '../components/QtyAdjust';
import { goBack, href, partPath } from '../router';
import { fillFraction, partStatus, shortfall } from '../stock';
import { UnknownScreen } from './UnknownScreen';

export function PartScreen({ partId }: { partId: string }) {
  const { canEdit, role, epoch, isMock } = useSession();
  const toast = useToast();
  const state = useAsync(() => api.getPart(partId), [partId, epoch]);
  const part = state.data;
  const [slotId, setSlotId] = useState<string | null>(null);

  // Keep the chosen slot valid when the part reloads.
  useEffect(() => {
    if (!part) return;
    if (!part.locations.some((l) => l.slot_id === slotId)) setSlotId(part.locations[0]?.slot_id ?? null);
  }, [part, slotId]);

  if (state.error && isApiError(state.error) && state.error.is('not_found'))
    return <UnknownScreen partId={partId} />;

  const header = <AppHeader title="Part" onBack={() => goBack('#/scan')} />;
  if (state.loading && !part) {
    return (
      <>
        {header}
        <Spinner label="Looking it up…" />
        <BottomTabs active="scan" />
      </>
    );
  }
  if (!part) {
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

  const location = part.locations.find((l) => l.slot_id === slotId) ?? part.locations[0] ?? null;
  const status = partStatus(part);
  const short = shortfall(part.par_total, part.on_hand_total);
  const over = Math.max(part.on_hand_total - part.par_total, 0);
  const dims = formatDims(part.width_in, part.height_in, part.depth_in);
  const setPart = (u: (p: Part) => Part) => state.setData((p) => (p ? u(p) : p));
  const showCost = role !== 'viewer' && part.cost != null;

  return (
    <>
      {header}
      <main
        className="mx-auto grid w-full max-w-3xl gap-4 px-4 pb-28 pt-4"
        data-testid="part-screen"
        data-part-id={part.part_id}
      >
        {/* 1. Name, code, category, department */}
        <section className="card" aria-label="Part">
          <h2 className="text-3xl font-extrabold leading-tight" data-testid="part-name">
            {part.part_name}
          </h2>
          <p className="mt-1 font-mono text-2xl font-extrabold text-maroon" data-testid="part-code">
            {part.part_code}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {part.category ? (
              <span className="text-base font-semibold text-ink-soft" data-testid="part-category">
                {part.category}
              </span>
            ) : null}
            <DepartmentChip dept={part.department} />
          </div>
        </section>

        {/* 2. Stock */}
        <section className="card grid gap-3" aria-label="Stock" data-testid="stock-panel">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-extrabold">Stock</h2>
            <StatusChip status={status} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-surface p-2">
              <p className="label-xs">On hand{part.locations.length > 1 ? ' (all places)' : ''}</p>
              <p className="text-4xl font-extrabold" data-testid="onhand-total">
                {part.on_hand_total}
              </p>
            </div>
            <div className="rounded-xl bg-surface p-2">
              <p className="label-xs">Par (full)</p>
              <p className="text-4xl font-extrabold" data-testid="par-total">
                {part.par_total}
              </p>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="On hand compared with par"
            aria-valuemin={0}
            aria-valuemax={Math.max(part.par_total, 1)}
            aria-valuenow={Math.min(part.on_hand_total, Math.max(part.par_total, 1))}
            className="h-5 overflow-hidden rounded-full border border-surface-line bg-surface"
          >
            <div
              data-testid="fill-bar"
              className={`h-full ${status === 'out' ? 'bg-red-600' : status === 'low' ? 'bg-amber-500' : 'bg-emerald-600'}`}
              style={{ width: `${Math.round(fillFraction(part.on_hand_total, part.par_total) * 100)}%` }}
            />
          </div>
          <p className="text-base font-bold" data-testid="shortfall">
            {part.par_total === 0
              ? 'No par level set yet.'
              : over > 0
                ? `${over} over par`
                : short > 0
                  ? `Short ${short} to get to par`
                  : 'At par'}
            {part.reorder_point != null ? (
              <span className="font-medium text-ink-soft"> · reorder at {part.reorder_point}</span>
            ) : null}
          </p>

          {part.locations.length > 1 ? (
            <div role="radiogroup" aria-label="Which place are you counting?" className="grid gap-2">
              <p className="label-xs">
                In {plural(part.locations.length, 'place')} — which one are you changing?
              </p>
              {part.locations.map((l) => (
                <button
                  key={l.slot_id}
                  type="button"
                  role="radio"
                  aria-checked={l.slot_id === location?.slot_id}
                  data-testid={`pick-${l.location_code}`}
                  onClick={() => setSlotId(l.slot_id)}
                  className={`flex min-h-touch items-center justify-between rounded-xl border-2 px-3 text-left text-base font-bold ${l.slot_id === location?.slot_id ? 'border-maroon bg-maroon-tint' : 'border-surface-line bg-white'}`}
                >
                  <span className="font-mono">{l.location_code}</span>
                  <span>
                    {l.on_hand_qty} <span className="font-medium text-ink-soft">of {l.par_qty}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {/* 3. Price */}
        <section
          className="card grid grid-cols-2 gap-3 text-center"
          aria-label="Price"
          data-testid="price-panel"
        >
          {showCost ? (
            <div>
              <p className="label-xs">Cost</p>
              <p className="text-2xl font-extrabold" data-testid="price-cost">
                {money(part.cost)}
              </p>
            </div>
          ) : (
            <div>
              <p className="label-xs">Cost</p>
              <p className="text-base font-semibold text-ink-soft" data-testid="cost-hidden">
                Not shown to viewers
              </p>
            </div>
          )}
          <div>
            <p className="label-xs">Sale price</p>
            <p className="text-2xl font-extrabold" data-testid="price-sale">
              {money(part.sale_price)}
            </p>
          </div>
        </section>

        {/* 4. Size */}
        {dims ? (
          <p className="px-1 text-lg font-semibold" data-testid="size-line">
            <span className="label-xs mr-2">Size W × H × D</span>
            {dims}
          </p>
        ) : null}

        {/* 5. Quick adjust */}
        {location ? (
          <QtyAdjust
            key={location.slot_id}
            part={part}
            location={location}
            canEdit={canEdit}
            onPartChange={setPart}
            reload={state.reload}
          />
        ) : (
          <section className="card border-2 border-amber-600 bg-amber-50" data-testid="not-assigned">
            <p className="text-xl font-extrabold">Not assigned yet</p>
            <p className="mt-1 text-base">This part has no shelf place, so there is no count to change.</p>
            {!canEdit ? (
              <div className="mt-3">
                <ViewOnlyNote />
              </div>
            ) : null}
          </section>
        )}

        {/* 6. Where is it */}
        {location ? (
          <LinkButton
            href={href(`${partPath(part.part_id)}/where`)}
            data-testid="where-button"
            className="!min-h-[88px] !text-3xl !tracking-wide"
            block
          >
            📍 WHERE IS IT?
          </LinkButton>
        ) : canEdit ? (
          <LinkButton
            href={href(`${partPath(part.part_id)}/move`)}
            data-testid="put-somewhere"
            className="!min-h-[88px] !text-3xl"
            block
          >
            Put it somewhere
          </LinkButton>
        ) : (
          <Button block disabled data-testid="put-somewhere" className="!min-h-[88px] !text-3xl">
            Put it somewhere
          </Button>
        )}

        {isMock && location ? (
          <details
            className="rounded-xl border border-dashed border-surface-line p-3"
            data-testid="demo-conflict-tool"
          >
            <summary className="min-h-touch cursor-pointer text-base font-bold text-ink-soft">
              Demo: make a version conflict
            </summary>
            <p className="mt-2 text-sm text-ink-soft">
              Changes this count behind the screen's back (+3), as if someone else did it. Then use{' '}
              <strong>Set count</strong> to see the conflict message.
            </p>
            <Button
              variant="neutral"
              className="mt-2"
              data-testid="simulate-other-user"
              disabled={!canEdit}
              onClick={async () => {
                try {
                  await api.adjustStock({
                    part_id: part.part_id,
                    slot_id: location.slot_id,
                    delta: 3,
                    reason: 'Simulated other user',
                  });
                  toast.show({ message: 'Someone else added 3 (not shown here yet).', tone: 'info' });
                } catch (e) {
                  toast.show({
                    message: isApiError(e) ? e.message : 'Could not simulate that.',
                    tone: 'error',
                  });
                }
              }}
            >
              Someone else adds 3
            </Button>
          </details>
        ) : null}
      </main>
      <BottomTabs active="scan" />
    </>
  );
}
