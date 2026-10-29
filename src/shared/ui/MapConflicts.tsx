import type { SlotConflict } from "../contract";
import type { ApiError } from "../api";
import { Dialog } from "./Dialog";

export type OccupiedChoice = "swap" | "share" | "move_other" | "different" | "cancel";

/**
 * "Something's already here" — same follow-up options everywhere (scan app and map):
 * swap / share / move the other part first / choose a different spot / cancel.
 * Options that don't apply are hidden via `allow`.
 */
export function SlotOccupiedDialog({
  open,
  conflicts,
  movingName,
  allow = ["swap", "share", "different", "cancel"],
  onChoose,
}: {
  open: boolean;
  conflicts: SlotConflict[];
  movingName?: string;
  allow?: OccupiedChoice[];
  onChoose: (c: OccupiedChoice) => void;
}) {
  const occupants = conflicts.flatMap((c) => c.parts.map((p) => ({ ...p, code: c.location_code })));
  const has = (c: OccupiedChoice) => allow.includes(c);
  return (
    <Dialog open={open} title="Something's already here" onClose={() => onChoose("cancel")} testId="occupied-dialog">
      <div className="space-y-2 text-sm">
        {occupants.length ? (
          <ul className="space-y-1">
            {occupants.map((p) => (
              <li key={`${p.code}-${p.part_id}`} className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                <b>{p.part_name}</b> <span className="text-gray-600">(on hand {p.on_hand_qty})</span>
                <div className="text-xs text-gray-600">in {p.code}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            That space overlaps {conflicts.length === 1 ? "another slot" : `${conflicts.length} slots`}:{" "}
            <b>{conflicts.map((c) => c.location_code).join(", ")}</b>. Slots can never overlap.
          </p>
        )}
        {movingName && occupants.length > 0 && (
          <p className="text-gray-700">
            What should happen with <b>{movingName}</b>?
          </p>
        )}
      </div>
      <div className="mt-4 grid gap-2">
        {has("swap") && occupants.length > 0 && (
          <button className="btn-primary min-h-[48px]" onClick={() => onChoose("swap")}>
            Swap places
          </button>
        )}
        {has("share") && occupants.length > 0 && (
          <button className="btn-gold min-h-[48px]" onClick={() => onChoose("share")}>
            Put both here (share the slot)
          </button>
        )}
        {has("move_other") && occupants.length > 0 && (
          <button className="btn-ghost min-h-[48px]" onClick={() => onChoose("move_other")}>
            Move {occupants.length === 1 ? occupants[0].part_name : "those parts"} somewhere else first
          </button>
        )}
        {has("different") && (
          <button className="btn-ghost min-h-[48px]" onClick={() => onChoose("different")}>
            Choose a different spot
          </button>
        )}
        <button className="btn-ghost min-h-[48px]" onClick={() => onChoose("cancel")}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** "Changed by someone else": Reload for everyone, Overwrite for admins only. */
export function VersionConflictDialog({
  open,
  what,
  isAdmin,
  onReload,
  onOverwrite,
  onClose,
}: {
  open: boolean;
  what: string;
  isAdmin: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title="Changed by someone else" onClose={onClose} testId="version-dialog">
      <p className="text-sm">
        Someone else changed <b>{what}</b> since you loaded it, so your edit was not saved.
      </p>
      <div className="mt-4 grid gap-2">
        <button className="btn-primary min-h-[48px]" onClick={onReload}>
          Reload (see their change)
        </button>
        {isAdmin && (
          <button className="btn-danger min-h-[48px]" onClick={onOverwrite}>
            Overwrite with mine (admin)
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function errorText(e: unknown): string {
  const err = e as ApiError;
  if (err?.body?.fields) {
    const f = Object.entries(err.body.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    return `${err.message} (${f})`;
  }
  return err?.message ?? String(e);
}
