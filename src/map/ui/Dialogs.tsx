import { useEffect } from "react";
import { ConfirmDialog, Dialog, SlotOccupiedDialog, useToast, VersionConflictDialog } from "../../shared/ui";
import { closeDialog, discardFailed, retryAllFailed, select } from "../actions";
import { isAdmin, setMap, useMap } from "../store";

/** Renders whichever dialog the store asks for (same dialogs as the scan app). */
export function DialogHost() {
  const d = useMap((s) => s.dialog);
  const admin = useMap(isAdmin);
  const layout = useMap((s) => s.layout);
  if (!d) return null;
  switch (d.kind) {
    case "version":
      return (
        <VersionConflictDialog
          open
          what={d.what}
          isAdmin={admin}
          onClose={closeDialog}
          onReload={async () => {
            closeDialog();
            await d.reload();
          }}
          onOverwrite={async () => {
            closeDialog();
            await d.overwrite?.();
          }}
        />
      );
    case "occupied":
      return (
        <SlotOccupiedDialog
          open
          conflicts={d.conflicts}
          movingName={d.movingName}
          allow={d.allow}
          onChoose={(c) => d.resolve(c === "move_other" ? "different" : c)}
        />
      );
    case "out_of_bounds":
      return (
        <Dialog open title={d.title} onClose={closeDialog} testId="oob-dialog">
          <p className="text-sm">These slots no longer fit on the shelf, so nothing was changed:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {d.slots.map((s) => {
              const sh = layout?.shelves.find((x) => x.slots.some((y) => y.slot_id === s.slot_id));
              return (
                <li
                  key={s.slot_id}
                  className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <b className="font-mono">{s.location_code}</b>
                    <div className="text-xs text-gray-700">{s.reason}</div>
                  </div>
                  {sh && (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        closeDialog();
                        select({ kind: "slot", shelfId: sh.shelf_id, id: s.slot_id }, { front: true });
                      }}
                    >
                      Show
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-gray-700">
            Resize or move those slots first{d.onFix ? ", or let the map do it:" : "."}
          </p>
          <div className="mt-3 grid gap-2">
            {d.onFix && (
              <button
                className="btn-primary min-h-[44px]"
                data-testid="oob-fix"
                onClick={async () => {
                  const fix = d.onFix!;
                  closeDialog();
                  await fix();
                }}
              >
                Shrink / move those slots to fit, then apply
              </button>
            )}
            <button className="btn-ghost" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      );
    case "shelf_not_empty":
      return (
        <Dialog open title={`${d.shelfName} still holds parts`} onClose={closeDialog} testId="not-empty-dialog">
          <p className="text-sm">{d.message}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
            {d.conflicts.map((c) => (
              <li key={c.slot_id} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5">
                <b className="font-mono">{c.location_code}</b>:{" "}
                {c.parts.map((p) => `${p.part_name} (${p.on_hand_qty})`).join(", ")}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <button
              className="btn-primary min-h-[44px]"
              onClick={() => {
                closeDialog();
                d.onOpen();
              }}
            >
              Open the shelf to move or remove parts
            </button>
            {d.canForce && (
              <button
                className="btn-danger min-h-[44px]"
                onClick={async () => {
                  closeDialog();
                  await d.onForce();
                }}
              >
                Delete anyway (admin): parts lose these locations
              </button>
            )}
            <button className="btn-ghost" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      );
    case "confirm":
      return (
        <ConfirmDialog
          open
          title={d.title}
          message={d.message}
          confirmLabel={d.confirmLabel}
          danger={d.danger}
          onClose={closeDialog}
          onConfirm={() => {
            void d.onConfirm();
          }}
        />
      );
  }
}

/** Pipes store toasts into the shared toast UI. */
export function ToastBridge() {
  const t = useMap((s) => s.toast);
  const { show } = useToast();
  useEffect(() => {
    if (t) show(t.text, { kind: t.kind, undo: t.undo });
  }, [t, show]);
  return null;
}

/** Edits that failed to save (offline or server error). Never silently dropped. */
export function FailedEdits() {
  const failed = useMap((s) => s.failed);
  const offline = useMap((s) => s.offline);
  if (!failed.length && !offline) return null;
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-30 w-[min(92vw,460px)] -translate-x-1/2 rounded-lg border border-red-300 bg-white/95 shadow-lg"
      data-testid="offline-banner"
      role="alert"
    >
      <div className="flex items-center gap-2 rounded-t-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white">
        <span>{offline ? "Can't reach the server. Retrying…" : "Some edits weren't saved"}</span>
        {failed.length > 0 && (
          <button
            className="ml-auto rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
            onClick={() => void retryAllFailed()}
          >
            Retry all
          </button>
        )}
      </div>
      {failed.length > 0 && (
        <ul className="max-h-40 divide-y overflow-auto text-sm" data-testid="failed-edits">
          {failed.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                <b>{f.label}</b> <span className="text-xs text-gray-600">not saved</span>
              </span>
              <button className="btn-ghost btn-sm" onClick={() => void f.retry()}>
                Retry
              </button>
              <button
                className="btn-ghost btn-sm"
                title="Throw this edit away"
                onClick={() => {
                  discardFailed(f.id);
                  if (!useMap.getState().failed.length) setMap({});
                }}
              >
                Discard
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
