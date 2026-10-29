import { useEffect, useState } from "react";
import { api, isApiError } from "../../shared/api";
import type { Part } from "../../shared/contract";
import { departmentColor, FtInInput } from "../../shared/ui";
import { formatIn } from "../../shared/units";
import { patchPart, select } from "../actions";
import { fitCount } from "../geometry";
import { editing, setMap, useMap } from "../store";
import { setPartDrag } from "./LeftPanel";

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

export function PartCard() {
  const id = useMap((s) => s.partCardId);
  const rev = useMap((s) => s.partsRev);
  const layout = useMap((s) => s.layout);
  const can = useMap(editing);
  const [part, setPart] = useState<Part | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setErr(null);
    api
      .getPart(id)
      .then((p) => live && setPart(p))
      .catch((e) => live && setErr(isApiError(e, "not_found") ? "Part not found." : e.message));
    return () => {
      live = false;
    };
  }, [id, rev]);
  if (!id) return null;
  const close = () => setMap({ partCardId: null });
  if (!part || part.part_id !== id)
    return (
      <div className="p-3 text-sm text-gray-600" data-testid="part-card">
        {err ?? "Loading part…"}
        <button className="ml-2 underline" onClick={close}>
          Close
        </button>
      </div>
    );
  const dims =
    part.width_in && part.height_in && part.depth_in ? { w: part.width_in, h: part.height_in, d: part.depth_in } : null;
  return (
    <div className="border-b border-gray-200 bg-white" data-testid="part-card">
      <div
        className="flex items-start gap-2 border-l-4 px-3 py-2"
        style={{ borderColor: departmentColor(part.department) }}
      >
        <div className="min-w-0 flex-1">
          <div className="font-bold leading-tight" data-testid="part-card-name">
            {part.part_name}
          </div>
          <div className="font-mono text-base font-extrabold text-ink">{part.part_code}</div>
          <div className="text-[11px] text-gray-500">
            {part.category} · {part.department || "No department"} · <span className="font-mono">{part.part_id}</span>
          </div>
        </div>
        <button
          className="text-xl leading-none text-gray-400 hover:text-gray-700"
          onClick={close}
          aria-label="Close part card"
          data-testid="close-part-card"
        >
          ×
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1 px-3 pb-2 text-center text-[11px]">
        {[
          ["On hand", part.on_hand_total],
          ["Par", part.par_total],
          ["Cost", money(part.cost)],
          ["Price", money(part.sale_price)],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded bg-gray-50 py-1">
            <div className="text-gray-500">{k}</div>
            <div className="text-sm font-bold">{v}</div>
          </div>
        ))}
      </div>
      <div className="px-3 pb-2">
        <div className="field-label">Where it is ({part.locations.length})</div>
        {!part.locations.length && (
          <p className="text-sm text-amber-800">Not on a shelf yet.{can ? " Drag it onto a slot:" : ""}</p>
        )}
        {!part.locations.length && can && (
          <div
            draggable
            onDragStart={(e) => setPartDrag(e, { part_id: part.part_id, part_name: part.part_name })}
            className="mt-1 cursor-grab rounded border border-dashed border-maroon px-2 py-1 text-sm text-maroon"
          >
            ⠿ {part.part_name}
          </div>
        )}
        <ul className="space-y-1">
          {part.locations.map((l) => {
            const sh = layout?.shelves.find((s) => s.shelf_id === l.shelf_id);
            const sl = sh?.slots.find((s) => s.slot_id === l.slot_id);
            const box =
              sl && sh
                ? {
                    w: sl.bin_width_in ?? (sh.width_in / sh.cols) * sl.width_span,
                    h: sl.bin_height_in ?? 12,
                    d: sl.bin_depth_in ?? sh.depth_in,
                  }
                : null;
            const fit = dims && box ? fitCount(box, dims) : null;
            return (
              <li key={l.slot_id}>
                <button
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-maroon-tint"
                  onClick={() =>
                    select({ kind: "slot", shelfId: l.shelf_id, id: l.slot_id }, { fly: true, front: true })
                  }
                  data-testid="part-card-location"
                >
                  <span className="font-mono font-bold">{l.location_code}</span>
                  <span className="text-xs text-gray-600">
                    {l.on_hand_qty}/{l.par_qty}
                  </span>
                  {fit === 0 && <span className="text-[11px] font-semibold text-red-700">doesn't fit the bin</span>}
                  <span className="ml-auto truncate text-[11px] text-gray-500">{l.zone_name}</span>
                </button>
                {l.co_located_parts.length > 0 && (
                  <div className="pl-2 text-[11px] text-gray-500">
                    shares with {l.co_located_parts.map((c) => c.part_name).join(", ")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-3">
        <FtInInput
          label="Part W"
          value={part.width_in}
          disabled={!can}
          min={0.0625}
          testId="part-w"
          onCommit={(v) => void patchPart(part, { width_in: v })}
        />
        <FtInInput
          label="Part H"
          value={part.height_in}
          disabled={!can}
          min={0.0625}
          testId="part-h"
          onCommit={(v) => void patchPart(part, { height_in: v })}
        />
        <FtInInput
          label="Part D"
          value={part.depth_in}
          disabled={!can}
          min={0.0625}
          testId="part-d"
          onCommit={(v) => void patchPart(part, { depth_in: v })}
        />
        {dims && (
          <p className="col-span-3 text-[11px] text-gray-500">
            Bounding box {formatIn(dims.w)} × {formatIn(dims.h)} × {formatIn(dims.d)}. Used for the fit check.
          </p>
        )}
        <a
          className="col-span-3 text-xs text-maroon underline"
          href={`../warehouse/?part=${encodeURIComponent(part.part_id)}`}
        >
          Open in the scan app
        </a>
      </div>
    </div>
  );
}
