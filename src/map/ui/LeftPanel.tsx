import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import type { LayoutShelf, Part } from "../../shared/contract";
import { formatFtIn } from "../../shared/units";
import { assignPart, select } from "../actions";
import { fillState } from "../colors";
import { canEdit, editing, selectedShelfId, setMap, useMap } from "../store";

export const PART_DND = "application/x-sc-part";

export function setPartDrag(e: React.DragEvent, p: { part_id: string; part_name: string; from_slot_id?: string }) {
  e.dataTransfer.setData(PART_DND, JSON.stringify(p));
  e.dataTransfer.setData("text/plain", p.part_id);
  e.dataTransfer.effectAllowed = "move";
}

export function readPartDrag(
  e: React.DragEvent | DragEvent,
): { part_id: string; part_name: string; from_slot_id?: string } | null {
  try {
    const raw = e.dataTransfer?.getData(PART_DND);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const FILL_DOT = { empty: "bg-gray-300", stock: "bg-emerald-600", low: "bg-amber-500", out: "bg-red-600" };

function ShelfNode({ sh, open, onToggle }: { sh: LayoutShelf; open: boolean; onToggle: () => void }) {
  const sel = useMap((s) => s.selection);
  const selected = selectedShelfId(sel) === sh.shelf_id;
  return (
    <li>
      <div className={`flex items-center rounded ${selected ? "bg-maroon-tint" : "hover:bg-gray-100"}`}>
        <button className="w-5 text-xs text-gray-500" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 text-left text-sm"
          data-testid={`tree-shelf-${sh.name}`}
          onClick={() => select({ kind: "shelf", id: sh.shelf_id }, { fly: true, front: true })}
        >
          <span className="font-bold">{sh.name}</span>
          <span className="truncate text-[11px] text-gray-500">
            {formatFtIn(sh.width_in)} · {sh.rows.length} rows · {sh.slots.length} slots
          </span>
        </button>
      </div>
      {open && (
        <ul className="ml-5 border-l border-gray-200 pl-1">
          {sh.rows
            .slice()
            .reverse()
            .map((r) => {
              const slots = sh.slots
                .filter((x) => x.row_index === r.row_index)
                .sort((a, b) => a.col_start - b.col_start);
              return (
                <li key={r.row_index}>
                  <button
                    className="w-full rounded px-1 py-0.5 text-left text-xs font-semibold text-gray-600 hover:bg-gray-100"
                    onClick={() => select({ kind: "shelf", id: sh.shelf_id }, { fly: true, front: true })}
                  >
                    Row {r.row_label} <span className="font-normal text-gray-400">at {formatFtIn(r.elevation_in)}</span>
                  </button>
                  <ul className="ml-2">
                    {slots.map((sl) => (
                      <li key={sl.slot_id}>
                        <button
                          className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-gray-100 ${sel?.kind === "slot" && sel.id === sl.slot_id ? "bg-gold/30" : ""}`}
                          onClick={() =>
                            select({ kind: "slot", shelfId: sh.shelf_id, id: sl.slot_id }, { fly: true, front: true })
                          }
                        >
                          <span className={`inline-block h-2 w-2 rounded-full ${FILL_DOT[fillState(sl)]}`} />
                          <span className="font-mono">{sl.location_code}</span>
                          <span className="text-gray-400">
                            {sl.part_count ? `${sl.part_count} part${sl.part_count === 1 ? "" : "s"}` : "empty"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
        </ul>
      )}
    </li>
  );
}

export function TreePanel() {
  const layout = useMap((s) => s.layout);
  const sel = useMap((s) => s.selection);
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());
  const [openShelves, setOpenShelves] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const selShelf = selectedShelfId(sel);
  // keep the selected shelf's zone open
  useEffect(() => {
    if (!selShelf || !layout) return;
    const z = layout.shelves.find((s) => s.shelf_id === selShelf)?.zone_id ?? "none";
    setOpenZones((o) => (o.has(z) ? o : new Set([...o, z])));
  }, [selShelf, layout]);
  const groups = useMemo(() => {
    if (!layout) return [];
    const f = filter.trim().toLowerCase();
    const byZone = new Map<string, LayoutShelf[]>();
    for (const s of layout.shelves) {
      if (f && !s.name.toLowerCase().includes(f)) continue;
      const k = s.zone_id ?? "none";
      byZone.set(k, [...(byZone.get(k) ?? []), s]);
    }
    const zones = layout.zones.map((z) => ({
      id: z.zone_id,
      name: z.name,
      verified: z.verified,
      shelves: (byZone.get(z.zone_id) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
    if (byZone.has("none"))
      zones.push({ id: "none", name: "Outside any zone", verified: true, shelves: byZone.get("none")! });
    return zones;
  }, [layout, filter]);
  if (!layout) return null;
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  return (
    <div className="flex h-full flex-col" data-testid="tree-panel">
      <div className="p-2">
        <input
          className="field"
          placeholder="Filter shelves by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter shelves"
        />
      </div>
      <ul className="flex-1 overflow-auto px-1 pb-4">
        {groups.map((z) => {
          const open = openZones.has(z.id) || !!filter;
          return (
            <li key={z.id} className="mb-0.5">
              <div
                className={`flex items-center rounded ${sel?.kind === "zone" && sel.id === z.id ? "bg-maroon-tint" : "hover:bg-gray-100"}`}
              >
                <button
                  className="w-5 text-xs text-gray-500"
                  onClick={() => setOpenZones(toggle(openZones, z.id))}
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? "▾" : "▸"}
                </button>
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs font-bold uppercase tracking-wide text-gray-700"
                  data-testid={`tree-zone-${z.name}`}
                  onClick={() => {
                    if (z.id !== "none") select({ kind: "zone", id: z.id }, { fly: true });
                    setOpenZones(new Set([...openZones, z.id]));
                  }}
                >
                  <span className="truncate">{z.name}</span>
                  {!z.verified && (
                    <span className="chip bg-amber-100 !px-1 !py-0 text-[9px] normal-case text-amber-800">
                      unverified
                    </span>
                  )}
                  <span className="ml-auto pr-1 text-[10px] font-normal normal-case text-gray-400">
                    {z.shelves.length}
                  </span>
                </button>
              </div>
              {open && (
                <ul className="ml-3">
                  {z.shelves.length === 0 && <li className="px-2 py-1 text-xs text-gray-400">No shelves yet</li>}
                  {z.shelves.map((sh) => (
                    <ShelfNode
                      key={sh.shelf_id}
                      sh={sh}
                      open={openShelves.has(sh.shelf_id)}
                      onToggle={() => setOpenShelves(toggle(openShelves, sh.shelf_id))}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PartRow({ p, slotTarget }: { p: Part; slotTarget: { shelfId: string; slotId: string; code: string } | null }) {
  const canAssign = useMap(editing);
  return (
    <li
      className="group flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm"
      draggable={canAssign}
      onDragStart={(e) => setPartDrag(e, { part_id: p.part_id, part_name: p.part_name })}
      data-testid="part-row"
    >
      {canAssign && (
        <span className="cursor-grab select-none text-gray-400" title="Drag onto a slot" aria-hidden>
          ⠿
        </span>
      )}
      <button className="min-w-0 flex-1 text-left" onClick={() => setMap({ partCardId: p.part_id })}>
        <div className="truncate font-semibold">{p.part_name}</div>
        <div className="flex gap-2 text-[11px] text-gray-500">
          <span className="font-mono font-bold text-gray-700">{p.part_code}</span>
          <span className="truncate">{p.category}</span>
          <span className="ml-auto whitespace-nowrap">
            {p.locations.length ? `${p.locations.length} spot${p.locations.length === 1 ? "" : "s"}` : "no spot"}
          </span>
        </div>
      </button>
      {canAssign && slotTarget && (
        <button
          className="btn-ghost btn-sm whitespace-nowrap"
          title={`Put in ${slotTarget.code}`}
          onClick={() => void assignPart(p, slotTarget.slotId, { mode: "add", par_qty: 0, on_hand_qty: 0 })}
        >
          → {slotTarget.code}
        </button>
      )}
    </li>
  );
}

export function PartsPanel() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Part[]>([]);
  const [unassigned, setUnassigned] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const rev = useMap((s) => s.partsRev);
  const editor = useMap(canEdit);
  const sel = useMap((s) => s.selection);
  const layout = useMap((s) => s.layout);
  const slotTarget = useMemo(() => {
    if (sel?.kind !== "slot") return null;
    const sl = layout?.shelves.find((s) => s.shelf_id === sel.shelfId)?.slots.find((x) => x.slot_id === sel.id);
    return sl ? { shelfId: sel.shelfId, slotId: sl.slot_id, code: sl.location_code } : null;
  }, [sel, layout]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const [r, u] = await Promise.all([
          q.trim() ? api.searchParts({ q, limit: 60 }) : Promise.resolve({ items: [], total: 0 }),
          api.searchParts({ unassigned: true, limit: 200 }),
        ]);
        if (!live) return;
        setItems(r.items);
        setUnassigned(u.items);
      } catch {
        /* offline banner covers it */
      } finally {
        if (live) setBusy(false);
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, rev]);
  return (
    <div className="flex h-full flex-col" data-testid="parts-panel">
      <div className="p-2">
        <input
          className="field"
          placeholder="Search parts to place"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search parts"
          data-testid="parts-search"
        />
        <p className="mt-1 text-[11px] text-gray-500">
          {editor
            ? slotTarget
              ? `Selected slot: ${slotTarget.code}. Drag a part onto any slot, or use →.`
              : "Drag a part onto a slot in the front view or in 3D (Edit mode)."
            : "View only."}
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        {q.trim() && (
          <>
            <div className="bg-gray-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-600">
              Results {busy && "…"}
            </div>
            <ul>
              {items.map((p) => (
                <PartRow key={p.part_id} p={p} slotTarget={slotTarget} />
              ))}
              {!items.length && !busy && <li className="px-2 py-2 text-sm text-gray-500">No parts match.</li>}
            </ul>
          </>
        )}
        <div
          className="bg-gray-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-600"
          data-testid="unassigned-heading"
        >
          Unassigned parts ({unassigned.length})
        </div>
        <ul data-testid="unassigned-list">
          {unassigned.map((p) => (
            <PartRow key={p.part_id} p={p} slotTarget={slotTarget} />
          ))}
          {!unassigned.length && <li className="px-2 py-2 text-sm text-gray-500">Every part has a spot. 🎉</li>}
        </ul>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const tab = useMap((s) => s.leftTab);
  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-gray-200">
        {(["layout", "parts"] as const).map((t) => (
          <button
            key={t}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide ${tab === t ? "border-b-2 border-maroon text-maroon" : "text-gray-500 hover:text-gray-800"}`}
            onClick={() => setMap({ leftTab: t })}
            data-testid={`left-tab-${t}`}
          >
            {t === "layout" ? "Layout" : "Parts"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === "layout" ? <TreePanel /> : <PartsPanel />}</div>
    </div>
  );
}
