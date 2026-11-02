import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import type {
  BinType,
  LayoutShelf,
  LayoutSlot,
  LocationType,
  Opening,
  OpeningKind,
  Packout,
  Part,
  ShelfKind,
  SlotPartRef,
  Zone,
} from "../../shared/contract";
import { FtInInput } from "../../shared/ui";
import { cellWidth, formatFtIn, formatIn, slotRect } from "../units";
import {
  adjustQty,
  assignPart,
  createShelf,
  deleteShelf,
  deleteSlot,
  duplicateShelf,
  patchOpening,
  patchShelf,
  patchSlot,
  patchZone,
  removePart,
  resizeSlot,
  rotateShelf,
  rowOfUnits,
  select,
  setCols,
  setOnHand,
  setPar,
} from "../actions";
import { fillState } from "../colors";
import { fitCount, placeFromWall, shelfWarnings, zoneEdges, zoneForShelf } from "../geometry";
import { rowsFor } from "../presets";
import { canEdit, editing, effectiveShelf, isAdmin, setMap, useMap } from "../store";

type Status = "saving" | "saved" | "error" | null;

function useSaver() {
  const [st, setSt] = useState<Record<string, Status>>({});
  const run = async (key: string, p: Promise<unknown>) => {
    setSt((s) => ({ ...s, [key]: "saving" }));
    const r = await p;
    setSt((s) => ({ ...s, [key]: r === undefined ? "error" : "saved" }));
    setTimeout(() => setSt((s) => (s[key] === "saved" ? { ...s, [key]: null } : s)), 1600);
  };
  return [st, run] as const;
}

function Section({
  title,
  children,
  defaultOpen = true,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-gray-100" data-testid={testId}>
      <button
        className="flex w-full items-center px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-600 hover:bg-gray-50"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {title}
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

function StatusTag({ s }: { s: Status }) {
  if (!s) return null;
  return (
    <span
      className={`text-[11px] ${s === "error" ? "text-red-700" : s === "saving" ? "text-gray-500" : "text-emerald-700"}`}
    >
      {s === "saving" ? "Saving…" : s === "saved" ? "Saved" : "Not saved"}
    </span>
  );
}

function TextField({
  label,
  value,
  onCommit,
  disabled,
  status,
  testId,
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  status?: Status;
  testId?: string;
  multiline?: boolean;
}) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  const commit = () => t !== value && onCommit(t);
  const props = {
    className: "field",
    value: t,
    disabled,
    "data-testid": testId,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur(); // blur commits once
    },
  };
  return (
    <label className="block">
      <span className="field-label flex">
        {label}
        <span className="ml-auto normal-case">
          <StatusTag s={status ?? null} />
        </span>
      </span>
      {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
    </label>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  disabled,
  status,
  testId,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  status?: Status;
  testId?: string;
  suffix?: string;
}) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = () => {
    const n = Number(t);
    if (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) return setT(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <label className="block">
      <span className="field-label flex">
        {label}
        <span className="ml-auto normal-case">
          <StatusTag s={status ?? null} />
        </span>
      </span>
      <div className="flex items-center gap-1">
        <input
          className="field font-mono"
          type="number"
          min={min}
          max={max}
          step={step}
          value={t}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => setT(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLElement).blur(); // blur commits once
          }}
        />
        {suffix && <span className="whitespace-nowrap text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

const KINDS: { v: ShelfKind; label: string }[] = [
  { v: "shelving", label: "Shelving" },
  { v: "pallet_rack", label: "Pallet rack" },
  { v: "cabinet", label: "Cabinet" },
  { v: "bench", label: "Bench" },
  { v: "floor_area", label: "Floor area" },
];

function ShelfInspector({ sh }: { sh: LayoutShelf }) {
  const can = useMap(editing);
  const layout = useMap((s) => s.layout)!;
  const survey = useMap((s) => s.surveyInput);
  const warnCfg = useMap((s) => s.warnCfg);
  const [st, run] = useSaver();
  const tmp = sh.shelf_id.startsWith("tmp-");
  const dis = !can || tmp;
  const save = (key: string, fields: Partial<LayoutShelf>, label: string) =>
    run(key, patchShelf(sh.shelf_id, fields, label));
  const warnings = useMemo(
    () =>
      shelfWarnings(
        sh,
        {
          shelves: layout.shelves.map((x) => (x.shelf_id === sh.shelf_id ? sh : x)),
          zones: layout.zones,
          openings: layout.openings,
        },
        warnCfg,
      ),
    [sh, layout, warnCfg],
  );
  const autoZone = zoneForShelf(layout.zones, sh);
  return (
    <div data-testid="shelf-inspector">
      <div className="flex items-center gap-2 border-b-4 border-gold bg-maroon px-3 py-2 text-white">
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold leading-tight" data-testid="inspector-title">
            Shelf {sh.name}
          </div>
          <div className="truncate font-mono text-[11px] text-gold-light" data-testid="inspector-id">
            {sh.shelf_id} {tmp && "(saving…)"}
          </div>
        </div>
        <button
          className="btn-gold btn-sm ml-auto"
          onClick={() => setMap({ frontViewOpen: true })}
          data-testid="open-front-view"
        >
          Front view
        </button>
      </div>
      {warnings.length > 0 && (
        <ul
          className="space-y-1 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="shelf-warnings"
        >
          {warnings.map((w, i) => (
            <li key={i} data-kind={w.kind}>
              ⚠ {w.message}
            </li>
          ))}
          <li className="text-[10px] text-amber-700">Warnings never block saving.</li>
        </ul>
      )}
      <Section title="Identity">
        <TextField
          label="Name"
          value={sh.name}
          disabled={dis}
          status={st.name}
          testId="shelf-name"
          onCommit={(v) => save("name", { name: v }, "Rename shelf")}
        />
        <label className="block">
          <span className="field-label">Location type</span>
          <select className="field" value={sh.location_type ?? 'primary'} disabled={dis}
            data-testid="shelf-location-type"
            onChange={(event) => void save('location_type', { location_type: event.target.value as LocationType }, 'Change location type')}>
            <option value="primary">Primary</option>
            <option value="overstock">Overstock</option>
            <option value="packout">Packout staging / kits</option>
          </select>
        </label>
        {sh.location_type === 'packout' && (
          <a href="/packouts/" className="block text-sm font-bold text-maroon underline">Manage kits and employee returns →</a>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Kind</span>
            <select
              className="field"
              value={sh.kind}
              disabled={dis}
              onChange={(e) => void save("kind", { kind: e.target.value as ShelfKind }, "Change kind")}
            >
              {KINDS.map((k) => (
                <option key={k.v} value={k.v}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Zone</span>
            <select
              className="field"
              value={sh.zone_id ?? ""}
              disabled={dis}
              onChange={(e) => void save("zone", { zone_id: e.target.value }, "Change zone")}
            >
              <option value="">(none)</option>
              {layout.zones.map((z) => (
                <option key={z.zone_id} value={z.zone_id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {autoZone && autoZone.zone_id !== sh.zone_id && can && (
          <button
            className="text-xs text-maroon underline"
            onClick={() => void save("zone", { zone_id: autoZone.zone_id }, "Set zone")}
          >
            It stands in {autoZone.name}. Set that as its zone.
          </button>
        )}
      </Section>
      <Section title="Position (front-left corner)">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={survey}
            onChange={(e) => setMap({ surveyInput: e.target.checked })}
            data-testid="survey-toggle-inspector"
          />
          Enter from survey sheet (Y = 162'-3" − sheet Y)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <FtInInput
            label="X (east)"
            value={sh.x_in}
            unit="ft"
            disabled={dis}
            min={0}
            status={st.x}
            testId="shelf-x"
            onCommit={(v) => void save("x", { x_in: v }, "Move shelf")}
          />
          <FtInInput
            label="Y (south)"
            value={sh.y_in}
            unit="ft"
            disabled={dis}
            survey="y"
            surveyOn={survey}
            status={st.y}
            testId="shelf-y"
            onCommit={(v) => void save("y", { y_in: v }, "Move shelf")}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="w-28">
            <NumberField
              label="Rotation (°)"
              value={sh.rotation_deg}
              min={0}
              max={359.99}
              step={0.5}
              disabled={dis}
              status={st.rot}
              testId="shelf-rotation"
              onCommit={(v) => void save("rot", { rotation_deg: v }, "Rotate shelf")}
            />
          </div>
          <button
            className="btn-ghost btn-sm"
            disabled={dis}
            title="Rotate 90° (R)"
            onClick={() => void rotateShelf(sh.shelf_id, 90)}
            data-testid="rotate-90"
          >
            ⟳ 90°
          </button>
          <button
            className="btn-ghost btn-sm"
            disabled={dis}
            title="Rotate 15° (Shift+R)"
            onClick={() => void rotateShelf(sh.shelf_id, 15)}
          >
            ⟳ 15°
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          0° faces south · 90° west · 180° north · 270° east. Front = the aisle side you stand on.
        </p>
        <TextField
          label="Wall reference"
          value={sh.wall_ref ?? ""}
          disabled={dis}
          status={st.wall}
          onCommit={(v) => void save("wall", { wall_ref: v || null }, "Wall reference")}
        />
      </Section>
      <Section title="Size">
        <div className="grid grid-cols-3 gap-2">
          <FtInInput
            label="Width"
            value={sh.width_in}
            disabled={dis}
            min={1}
            status={st.w}
            testId="shelf-width"
            onCommit={(v) => void save("w", { width_in: v }, "Resize shelf")}
          />
          <FtInInput
            label="Depth"
            value={sh.depth_in}
            disabled={dis}
            min={1}
            status={st.d}
            testId="shelf-depth"
            onCommit={(v) => void save("d", { depth_in: v }, "Resize shelf")}
          />
          <FtInInput
            label="Height"
            value={sh.height_in}
            disabled={dis}
            min={1}
            status={st.h}
            testId="shelf-height"
            onCommit={(v) => void save("h", { height_in: v }, "Resize shelf")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Columns"
            value={sh.cols}
            min={1}
            max={200}
            disabled={dis}
            testId="shelf-cols"
            suffix={`cell ${formatIn(cellWidth(sh))}`}
            onCommit={(v) =>
              void run(
                "cols",
                setCols(sh.shelf_id, v).then(() => true),
              )
            }
          />
          <div className="text-xs text-gray-600">
            <span className="field-label">Rows</span>
            {sh.rows.length} ({sh.rows.map((r) => r.row_label).join(", ")})
            <button className="block text-maroon underline" onClick={() => setMap({ frontViewOpen: true })}>
              Edit rows in front view
            </button>
          </div>
        </div>
      </Section>
      {can && !tmp && <PlaceFromWall sh={sh} />}
      {can && !tmp && (
        <Section title="Actions">
          <RowTool sh={sh} />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost btn-sm"
              onClick={() => void duplicateShelf(sh.shelf_id)}
              title="Ctrl+D"
              data-testid="duplicate-shelf"
            >
              Duplicate
            </button>
            <button
              className="btn-danger btn-sm"
              onClick={() => deleteShelf(sh.shelf_id)}
              title="Del"
              data-testid="delete-shelf"
            >
              Delete…
            </button>
          </div>
        </Section>
      )}
      <Section title="Notes" defaultOpen={!!sh.notes}>
        <TextField
          label="Notes"
          value={sh.notes}
          disabled={dis}
          status={st.notes}
          multiline
          onCommit={(v) => void save("notes", { notes: v }, "Shelf notes")}
        />
      </Section>
    </div>
  );
}

function RowTool({ sh }: { sh: LayoutShelf }) {
  const [n, setN] = useState(2);
  return (
    <div className="flex items-end gap-2" data-testid="row-tool">
      <div className="w-20">
        <NumberField label="Row tool" value={n} min={1} max={30} onCommit={setN} />
      </div>
      <button className="btn-ghost btn-sm" onClick={() => void rowOfUnits(sh.shelf_id, n)}>
        Add {n} more end to end →
      </button>
    </div>
  );
}

/** Jayce's paper measurement log -> exact position: wall, offset along it from one end, gap out from it. */
function PlaceFromWall({ sh }: { sh: LayoutShelf }) {
  const layout = useMap((s) => s.layout)!;
  const lastSize = useMap((s) => s.lastSize);
  const [zoneId, setZoneId] = useState(sh.zone_id ?? layout.zones[0]?.zone_id);
  const zone = layout.zones.find((z) => z.zone_id === zoneId) ?? layout.zones[0];
  const edges = useMemo(() => (zone ? zoneEdges(zone).filter((e) => !e.open) : []), [zone]);
  const [edgeIndex, setEdgeIndex] = useState<number>(edges[0]?.index ?? 0);
  const [fromEnd, setFromEnd] = useState<"start" | "end">("start");
  const [offset, setOffset] = useState(0);
  const [gap, setGap] = useState(0);
  useEffect(() => {
    if (!edges.some((e) => e.index === edgeIndex) && edges[0]) setEdgeIndex(edges[0].index);
  }, [edges, edgeIndex]);
  const edge = edges.find((e) => e.index === edgeIndex);
  const result = useMemo(() => {
    if (!zone || !edge) return null;
    try {
      return placeFromWall({
        zone,
        edgeIndex,
        fromEnd,
        offsetIn: offset,
        gapIn: gap,
        width_in: sh.width_in,
        depth_in: sh.depth_in,
      });
    } catch {
      return null;
    }
  }, [zone, edge, edgeIndex, fromEnd, offset, gap, sh.width_in, sh.depth_in]);
  return (
    <Section title="Place from wall (tape measurement)" defaultOpen={false} testId="place-from-wall">
      <label className="block">
        <span className="field-label">Zone</span>
        <select
          className="field"
          value={zone?.zone_id}
          onChange={(e) => setZoneId(e.target.value)}
          data-testid="pfw-zone"
        >
          {layout.zones.map((z) => (
            <option key={z.zone_id} value={z.zone_id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="field-label">Wall</span>
          <select
            className="field"
            value={edgeIndex}
            onChange={(e) => setEdgeIndex(Number(e.target.value))}
            data-testid="pfw-wall"
          >
            {edges.map((e) => (
              <option key={e.index} value={e.index}>
                {e.name} ({formatFtIn(e.length)})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Measured from</span>
          <select
            className="field"
            value={fromEnd}
            onChange={(e) => setFromEnd(e.target.value as "start" | "end")}
            data-testid="pfw-end"
          >
            <option value="start">{edge?.startName ?? "start"}</option>
            <option value="end">{edge?.endName ?? "end"}</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FtInInput label="Along the wall" value={offset} unit="ft" min={0} onCommit={setOffset} testId="pfw-offset" />
        <FtInInput label="Out from wall" value={gap} min={0} onCommit={setGap} testId="pfw-gap" />
      </div>
      <p className="text-[11px] text-gray-500">
        "Along" = from that end of the wall to the nearest end of the unit. "Out" = gap between the wall and the back of
        the unit (0 = against it).
      </p>
      {result && (
        <div className="rounded-md bg-gray-50 p-2 font-mono text-[11px] text-gray-700" data-testid="pfw-result">
          → X {formatFtIn(result.x_in)}, Y {formatFtIn(result.y_in)}, {result.rotation_deg}°
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={!result}
          data-testid="pfw-apply"
          onClick={() =>
            result &&
            void patchShelf(
              sh.shelf_id,
              {
                x_in: result.x_in,
                y_in: result.y_in,
                rotation_deg: result.rotation_deg,
                wall_ref: result.wall_ref,
                zone_id: zone?.zone_id ?? sh.zone_id,
              },
              `Place ${sh.name} from wall`,
            )
          }
        >
          Move {sh.name} here
        </button>
        <button
          className="btn-ghost btn-sm"
          disabled={!zone || !edge}
          onClick={() => {
            if (!zone || !edge) return;
            const r = placeFromWall({
              zone,
              edgeIndex,
              fromEnd,
              offsetIn: offset,
              gapIn: gap,
              width_in: lastSize.width_in,
              depth_in: lastSize.depth_in,
            });
            void createShelf(
              {
                name: "",
                zone_id: zone.zone_id,
                kind: lastSize.kind,
                x_in: r.x_in,
                y_in: r.y_in,
                rotation_deg: r.rotation_deg,
                width_in: lastSize.width_in,
                depth_in: lastSize.depth_in,
                height_in: lastSize.height_in,
                cols: lastSize.cols,
                rows: rowsFor(lastSize),
                wall_ref: r.wall_ref,
                notes: "",
              },
              "Add shelf from wall",
            );
          }}
        >
          New unit here
        </button>
      </div>
    </Section>
  );
}

const BIN_TYPES: BinType[] = ["bin", "box", "tote", "loose", "drawer"];

function statusOf(p: Pick<SlotPartRef, "on_hand_qty" | "par_qty">) {
  if (p.on_hand_qty <= 0) return { text: "Out", cls: "bg-red-100 text-red-800" };
  if (p.on_hand_qty < p.par_qty) return { text: "Below par", cls: "bg-amber-100 text-amber-900" };
  if (p.par_qty > 0 && p.on_hand_qty > p.par_qty) return { text: "Over par", cls: "bg-blue-100 text-blue-900" };
  return { text: "OK", cls: "bg-emerald-100 text-emerald-800" };
}

function SlotInspector({ sh, slot }: { sh: LayoutShelf; slot: LayoutSlot }) {
  const can = useMap(editing);
  const detail = useMap((s) => s.shelfDetail[sh.shelf_id]);
  const rev = useMap((s) => s.partsRev);
  const [st, run] = useSaver();
  const full = detail?.slots.find((x) => x.slot_id === slot.slot_id);
  const parts = full?.parts ?? [];
  const r = slotRect(sh, slot);
  const [partInfo, setPartInfo] = useState<Record<string, Part>>({});
  const partIds = parts.map((part) => part.part_id).join("|");
  useEffect(() => {
    let live = true;
    Promise.all((partIds ? partIds.split("|") : []).map((id) => api.getPart(id).catch(() => null))).then((xs) => {
      if (!live) return;
      const m: Record<string, Part> = {};
      xs.forEach((p) => p && (m[p.part_id] = p));
      setPartInfo(m);
    });
    return () => {
      live = false;
    };
  }, [partIds, rev]);
  const issuedKit = Object.values(partInfo).flatMap((part) => part.locations)
    .find((location) => location.slot_id === slot.slot_id && location.issued_kit_id)?.issued_kit_id;
  const contentsLoaded = parts.every((part) => partInfo[part.part_id]);
  const box = {
    w: slot.bin_width_in ?? r?.width ?? 0,
    h: slot.bin_height_in ?? r?.height ?? 0,
    d: slot.bin_depth_in ?? sh.depth_in,
  };
  const binTooBig =
    r &&
    ((slot.bin_width_in ?? 0) > r.width + 0.01 ||
      (slot.bin_height_in ?? 0) > r.height + 0.01 ||
      (slot.bin_depth_in ?? 0) > sh.depth_in + 0.01);
  const fill = fillState(slot);
  return (
    <div data-testid="slot-inspector">
      <div className="flex items-center gap-2 border-b-4 border-gold bg-maroon px-3 py-2 text-white">
        <div className="min-w-0">
          <div className="font-mono text-lg font-extrabold leading-tight" data-testid="inspector-title">
            {slot.location_code}
          </div>
          <div className="truncate font-mono text-[11px] text-gold-light">{slot.slot_id}</div>
        </div>
        <button
          className="btn-ghost btn-sm ml-auto !border-white/40 !bg-transparent !text-white"
          onClick={() => select({ kind: "shelf", id: sh.shelf_id }, { front: true })}
        >
          ← {sh.name}
        </button>
      </div>
      {issuedKit && (
        <p role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-sm">
          This kit is issued to an employee. Count remaining parts when it returns.
          <a className="ml-1 font-bold text-maroon underline" href="/packouts/">Open packouts →</a>
        </p>
      )}
      <Section title={`Parts here (${parts.length})`} testId="slot-parts">
        {parts.length === 0 && (
          <p className="text-sm text-gray-500">Empty. {can ? "Drag a part here, or add one below." : ""}</p>
        )}
        <ul className="space-y-2">
          {parts.map((p) => {
            const s = statusOf(p);
            const info = partInfo[p.part_id];
            const loc = info?.locations.find((l) => l.slot_id === slot.slot_id);
            const dims =
              info && info.width_in && info.height_in && info.depth_in
                ? { w: info.width_in, h: info.height_in, d: info.depth_in }
                : null;
            const fits = dims ? fitCount(box, dims) : null;
            return (
              <li key={p.part_id} className="rounded-lg border border-gray-200 p-2" data-testid="slot-part">
                <button className="block w-full text-left" onClick={() => setMap({ partCardId: p.part_id })}>
                  <div className="font-semibold leading-tight">{p.part_name}</div>
                  <div className="font-mono text-xs font-bold text-gray-700">{p.part_code}</div>
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`chip ${s.cls}`}>{s.text}</span>
                  <span>
                    On hand <b data-testid="on-hand">{p.on_hand_qty}</b> / par <b>{p.par_qty}</b>
                  </span>
                </div>
                {fits != null && (
                  <div
                    className={`mt-1 text-[11px] ${fits === 0 ? "font-semibold text-red-700" : "text-gray-600"}`}
                    data-testid="fit-check"
                  >
                    {fits === 0
                      ? "⚠ One of these is bigger than the bin."
                      : `About ${fits} fit in the bin (by bounding box).`}
                  </div>
                )}
                {can && loc && !loc.issued_kit_id && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => void adjustQty(p.part_id, slot.slot_id, -1, p.part_name)}
                      disabled={p.on_hand_qty <= 0}
                      aria-label="One less"
                    >
                      −1
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => void adjustQty(p.part_id, slot.slot_id, 1, p.part_name)}
                      aria-label="One more"
                    >
                      +1
                    </button>
                    {loc && (
                      <>
                        <InlineNumber
                          label="Count"
                          value={p.on_hand_qty}
                          onSave={(v) => void setOnHand(p.part_id, slot.slot_id, v, loc.version, p.part_name)}
                        />
                        <InlineNumber
                          label="Par"
                          value={p.par_qty}
                          onSave={(v) => void setPar(p.part_id, slot.slot_id, v, loc.version, p.part_name)}
                        />
                      </>
                    )}
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        setMap({
                          tool: {
                            kind: "move-part",
                            part_id: p.part_id,
                            part_name: p.part_name,
                            from_slot_id: slot.slot_id,
                          },
                          frontViewOpen: true,
                        })
                      }
                      data-testid="move-part"
                    >
                      Move…
                    </button>
                    <button
                      className="btn-ghost btn-sm text-red-700"
                      onClick={() => void removePart(p.part_id, slot.slot_id, p.part_name)}
                      data-testid="remove-part"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {can && contentsLoaded && !issuedKit && <AddPartForm slotId={slot.slot_id} />}
      </Section>
      <Section title="Bin">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Type</span>
            <select
              className="field"
              value={slot.bin_type ?? "loose"}
              disabled={!can}
              onChange={(e) =>
                void run("type", patchSlot(sh.shelf_id, slot.slot_id, { bin_type: e.target.value as BinType }))
              }
              data-testid="bin-type"
            >
              {BIN_TYPES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Color</span>
            <div className="flex items-center gap-1">
              <input
                type="color"
                className="h-8 w-10 rounded border"
                value={slot.bin_color ?? "#9aa5b1"}
                disabled={!can}
                onChange={(e) => void run("color", patchSlot(sh.shelf_id, slot.slot_id, { bin_color: e.target.value }))}
              />
              {slot.bin_color && can && (
                <button
                  className="text-xs underline"
                  onClick={() => void run("color", patchSlot(sh.shelf_id, slot.slot_id, { bin_color: null }))}
                >
                  none
                </button>
              )}
            </div>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <FtInInput
            label="Bin W"
            value={slot.bin_width_in}
            disabled={!can}
            min={0.0625}
            status={st.bw}
            testId="bin-w"
            onCommit={(v) => void run("bw", patchSlot(sh.shelf_id, slot.slot_id, { bin_width_in: v }))}
          />
          <FtInInput
            label="Bin H"
            value={slot.bin_height_in}
            disabled={!can}
            min={0.0625}
            status={st.bh}
            testId="bin-h"
            onCommit={(v) => void run("bh", patchSlot(sh.shelf_id, slot.slot_id, { bin_height_in: v }))}
          />
          <FtInInput
            label="Bin D"
            value={slot.bin_depth_in}
            disabled={!can}
            min={0.0625}
            status={st.bd}
            testId="bin-d"
            onCommit={(v) => void run("bd", patchSlot(sh.shelf_id, slot.slot_id, { bin_depth_in: v }))}
          />
        </div>
        {r && (
          <p className="text-[11px] text-gray-500">
            Slot opening: {formatIn(r.width)} W × {formatIn(r.height)} H × {formatIn(sh.depth_in)} D. Blank bin size =
            the slot size.
          </p>
        )}
        {binTooBig && (
          <p className="text-xs font-semibold text-red-700" data-testid="bin-too-big">
            ⚠ The bin is bigger than its slot.
          </p>
        )}
        {can && (slot.bin_width_in || slot.bin_height_in || slot.bin_depth_in) && (
          <button
            className="text-xs underline"
            onClick={() =>
              void run(
                "bw",
                patchSlot(sh.shelf_id, slot.slot_id, { bin_width_in: null, bin_height_in: null, bin_depth_in: null }),
              )
            }
          >
            Clear bin size (use slot size)
          </button>
        )}
      </Section>
      <Section title="Grid position" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Slot no."
            value={slot.slot_no}
            min={1}
            disabled={!can}
            status={st.no}
            onCommit={(v) => void run("no", patchSlot(sh.shelf_id, slot.slot_id, { slot_no: v }, "Renumber slot"))}
          />
          <NumberField
            label="Row (0 = G)"
            value={slot.row_index}
            min={0}
            max={sh.rows.length - 1}
            disabled={!can}
            onCommit={(v) =>
              void resizeSlot(sh.shelf_id, slot.slot_id, {
                width_span: slot.width_span,
                height_span: slot.height_span,
                row_index: v,
                col_start: slot.col_start,
              })
            }
          />
          <NumberField
            label="First column"
            value={slot.col_start}
            min={1}
            max={sh.cols}
            disabled={!can}
            onCommit={(v) =>
              void resizeSlot(sh.shelf_id, slot.slot_id, {
                width_span: slot.width_span,
                height_span: slot.height_span,
                col_start: v,
                row_index: slot.row_index,
              })
            }
          />
          <NumberField
            label="Width (cols)"
            value={slot.width_span}
            min={1}
            max={sh.cols}
            disabled={!can}
            testId="slot-width-span"
            onCommit={(v) =>
              void resizeSlot(sh.shelf_id, slot.slot_id, {
                width_span: v,
                height_span: slot.height_span,
                col_start: slot.col_start,
                row_index: slot.row_index,
              })
            }
          />
          <NumberField
            label="Height (rows)"
            value={slot.height_span}
            min={1}
            max={sh.rows.length}
            disabled={!can}
            onCommit={(v) =>
              void resizeSlot(sh.shelf_id, slot.slot_id, {
                width_span: slot.width_span,
                height_span: v,
                col_start: slot.col_start,
                row_index: slot.row_index,
              })
            }
          />
        </div>
        <p className="text-[11px] text-gray-500">
          Fill: {fill}. Codes: shelf-row-slot, numbered left to right facing the shelf.
        </p>
        {can && (
          <button
            className="btn-danger btn-sm"
            onClick={() => void deleteSlot(sh.shelf_id, slot.slot_id)}
            data-testid="delete-slot"
          >
            Delete slot
          </button>
        )}
      </Section>
    </div>
  );
}

function InlineNumber({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  if (!edit)
    return (
      <button className="btn-ghost btn-sm" onClick={() => setEdit(true)}>
        {label}…
      </button>
    );
  const done = () => {
    const n = Number(t);
    setEdit(false);
    if (Number.isInteger(n) && n >= 0 && n !== value) onSave(n);
  };
  return (
    <input
      autoFocus
      className="field !w-16 !py-0.5 font-mono"
      type="number"
      min={0}
      value={t}
      aria-label={label}
      onChange={(e) => setT(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done();
        if (e.key === "Escape") setEdit(false);
      }}
    />
  );
}

function AddPartForm({ slotId }: { slotId: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Part[]>([]);
  const [pick, setPick] = useState<Part | null>(null);
  const [par, setParV] = useState(0);
  const [onHand, setOnHandV] = useState(0);
  useEffect(() => {
    if (!q.trim() || pick) return setItems([]);
    const t = setTimeout(
      () =>
        api
          .searchParts({ q, limit: 8 })
          .then((r) => setItems(r.items))
          .catch(() => {}),
      150,
    );
    return () => clearTimeout(t);
  }, [q, pick]);
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-2" data-testid="add-part-form">
      <div className="field-label">Add part</div>
      {pick ? (
        <div className="flex items-center gap-2 text-sm">
          <b className="min-w-0 flex-1 truncate">{pick.part_name}</b>
          <button className="text-xs underline" onClick={() => setPick(null)}>
            change
          </button>
        </div>
      ) : (
        <>
          <input
            className="field"
            placeholder="Search name or code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            data-testid="add-part-search"
          />
          <ul className="mt-1 max-h-40 overflow-auto">
            {items.map((p) => (
              <li key={p.part_id}>
                <button
                  className="w-full truncate rounded px-1 py-0.5 text-left text-sm hover:bg-maroon-tint"
                  onClick={() => setPick(p)}
                >
                  {p.part_name} <span className="font-mono text-[11px] text-gray-500">{p.part_code}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-1 grid grid-cols-2 gap-2">
        <NumberField label="Par" value={par} min={0} onCommit={setParV} testId="add-part-par" />
        <NumberField label="On hand" value={onHand} min={0} onCommit={setOnHandV} testId="add-part-onhand" />
      </div>
      <button
        className="btn-primary btn-sm mt-2 w-full"
        disabled={!pick}
        data-testid="add-part-submit"
        onClick={async () => {
          if (!pick) return;
          const ok = await assignPart(pick, slotId, { mode: "add", par_qty: par, on_hand_qty: onHand });
          if (ok) {
            setPick(null);
            setQ("");
          }
        }}
      >
        Put it here
      </button>
    </div>
  );
}

function ZoneInspector({ z }: { z: Zone }) {
  const admin = useMap((s) => editing(s) && isAdmin(s));
  const survey = useMap((s) => s.surveyInput);
  const edges = zoneEdges(z);
  const [st, run] = useSaver();
  const setPoint = (i: number, k: 0 | 1, v: number) => {
    const poly = z.polygon_in.map((p, j) => (j === i ? ((k === 0 ? [v, p[1]] : [p[0], v]) as [number, number]) : p));
    void run(`p${i}${k}`, patchZone(z, { polygon_in: poly }, `Edit corner of ${z.name}`));
  };
  return (
    <div data-testid="zone-inspector">
      <div className="border-b-4 border-gold bg-maroon px-3 py-2 text-white">
        <div className="text-lg font-extrabold leading-tight">{z.name}</div>
        <div className="font-mono text-[11px] text-gold-light">
          {z.zone_id} · room {z.room_no || "—"}
        </div>
      </div>
      {!admin && (
        <p className="px-3 pt-2 text-xs text-gray-600">
          Building geometry. Admins edit it in Edit mode, in the top-down plan.
        </p>
      )}
      <Section title="Status">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={z.verified}
            disabled={!admin}
            onChange={(e) =>
              void run(
                "verified",
                patchZone(
                  z,
                  { verified: e.target.checked },
                  e.target.checked ? `Verify ${z.name}` : `Unverify ${z.name}`,
                ),
              )
            }
            data-testid="zone-verified"
          />
          Verified on site with a tape <StatusTag s={st.verified} />
        </label>
        <TextField
          label="Notes"
          value={z.notes}
          disabled={!admin}
          multiline
          status={st.notes}
          onCommit={(v) => void run("notes", patchZone(z, { notes: v }))}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Name"
            value={z.name}
            disabled={!admin}
            status={st.name}
            onCommit={(v) => void run("name", patchZone(z, { name: v }))}
          />
          <FtInInput
            label="Wall height"
            value={z.wall_height_in}
            unit="ft"
            disabled={!admin}
            min={12}
            status={st.wh}
            onCommit={(v) => void run("wh", patchZone(z, { wall_height_in: v }))}
          />
        </div>
      </Section>
      <Section title={`Corners (${z.polygon_in.length})`} defaultOpen={admin}>
        {admin && (
          <p className="text-[11px] text-gray-500">
            Drag the gold corner handles in the top-down plan, or type exact numbers.
          </p>
        )}
        {z.polygon_in.map((p, i) => (
          <div key={i} className="grid grid-cols-[20px_1fr_1fr] items-end gap-2">
            <span className="pb-2 text-xs text-gray-500">{i}</span>
            <FtInInput
              label="X"
              value={p[0]}
              unit="ft"
              min={0}
              disabled={!admin}
              status={st[`p${i}0`]}
              onCommit={(v) => setPoint(i, 0, v)}
            />
            <FtInInput
              label="Y"
              value={p[1]}
              unit="ft"
              survey="y"
              surveyOn={survey}
              disabled={!admin}
              status={st[`p${i}1`]}
              onCommit={(v) => setPoint(i, 1, v)}
            />
          </div>
        ))}
      </Section>
      <Section title="Walls" defaultOpen={false}>
        {edges.map((e) => (
          <label key={e.index} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!e.open}
              disabled={!admin}
              onChange={(ev) => {
                const open = new Set(z.open_edges);
                if (ev.target.checked) open.delete(e.index);
                else open.add(e.index);
                void patchZone(z, { open_edges: [...open].sort((a, b) => a - b) }, `Walls of ${z.name}`);
              }}
            />
            Edge {e.index}: {e.name}, {formatFtIn(e.length)} {e.open ? "(open, no wall)" : ""}
          </label>
        ))}
      </Section>
    </div>
  );
}

/** Tools / Packouts floor areas, for every role. Admins in Edit mode get the zone editor instead. */
function AreaPanel({ z }: { z: Zone }) {
  return (
    <div data-testid={`area-panel-${z.area_kind}`}>
      <div className="border-b-4 border-gold bg-maroon px-3 py-2 text-white">
        <div className="text-lg font-extrabold leading-tight" data-testid="area-name">
          {z.name}
        </div>
        <div className="text-[11px] text-gold-light">{z.area_kind === "tools" ? "Tools area" : "Packout kits"}</div>
      </div>
      {z.area_kind === "tools" ? (
        <p className="px-3 py-3 text-sm text-gray-600" data-testid="area-tools-placeholder">
          Contents coming soon
        </p>
      ) : (
        <PackoutKits />
      )}
    </div>
  );
}

function PackoutKits() {
  const [kits, setKits] = useState<Packout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .listPackouts()
      .then((r) => live && setKits(r.items))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load kits."));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Section title="Kits">
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {!error && !kits && <p className="text-sm text-gray-500">Loading kits…</p>}
      {kits && !kits.length && (
        <p className="text-sm text-gray-600" data-testid="packouts-empty">
          No kits yet.
        </p>
      )}
      {kits && kits.length > 0 && (
        <ul className="divide-y divide-gray-100" data-testid="packouts-list">
          {kits.map((k) => (
            <li key={k.kit_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{k.name}</span>
                <span className="font-mono text-[11px] text-gray-500">{k.location_code}</span>
              </span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${k.status === "issued" ? "bg-amber-100 text-amber-950" : "bg-green-100 text-green-950"}`}
              >
                {k.status === "issued" ? "Issued" : "Available"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <a className="text-sm font-bold text-maroon underline" href="../packouts/" data-testid="packouts-link">
        Open Packouts
      </a>
    </Section>
  );
}

const OPENING_KINDS: OpeningKind[] = ["door", "overhead", "opening"];

function OpeningInspector({ o }: { o: Opening }) {
  const admin = useMap((s) => editing(s) && isAdmin(s));
  const survey = useMap((s) => s.surveyInput);
  const [st, run] = useSaver();
  const set = (k: keyof Opening, v: number | string | boolean) => void run(k, patchOpening(o, { [k]: v }));
  return (
    <div data-testid="opening-inspector">
      <div className="border-b-4 border-gold bg-maroon px-3 py-2 text-white">
        <div className="text-lg font-extrabold capitalize leading-tight">
          {o.kind} {o.tag}
        </div>
        <div className="font-mono text-[11px] text-gold-light">
          {o.opening_id} · {formatFtIn(Math.hypot(o.x2_in - o.x1_in, o.y2_in - o.y1_in))} wide
        </div>
      </div>
      <Section title="Opening">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={o.verified}
            disabled={!admin}
            onChange={(e) => set("verified", e.target.checked)}
            data-testid="opening-verified"
          />{" "}
          Verified on site <StatusTag s={st.verified} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Kind</span>
            <select className="field" value={o.kind} disabled={!admin} onChange={(e) => set("kind", e.target.value)}>
              {OPENING_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <TextField label="Tag" value={o.tag ?? ""} disabled={!admin} status={st.tag} onCommit={(v) => set("tag", v)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FtInInput
            label="End 1 X"
            value={o.x1_in}
            unit="ft"
            min={0}
            disabled={!admin}
            status={st.x1_in}
            onCommit={(v) => set("x1_in", v)}
          />
          <FtInInput
            label="End 1 Y"
            value={o.y1_in}
            unit="ft"
            survey="y"
            surveyOn={survey}
            disabled={!admin}
            status={st.y1_in}
            onCommit={(v) => set("y1_in", v)}
          />
          <FtInInput
            label="End 2 X"
            value={o.x2_in}
            unit="ft"
            min={0}
            disabled={!admin}
            status={st.x2_in}
            onCommit={(v) => set("x2_in", v)}
          />
          <FtInInput
            label="End 2 Y"
            value={o.y2_in}
            unit="ft"
            survey="y"
            surveyOn={survey}
            disabled={!admin}
            status={st.y2_in}
            onCommit={(v) => set("y2_in", v)}
          />
        </div>
        <FtInInput
          label="Height"
          value={o.height_in}
          unit="ft"
          min={1}
          disabled={!admin}
          status={st.height_in}
          onCommit={(v) => set("height_in", v)}
        />
        <TextField
          label="Notes"
          value={o.notes}
          disabled={!admin}
          multiline
          status={st.notes}
          onCommit={(v) => set("notes", v)}
        />
      </Section>
    </div>
  );
}

export function Inspector() {
  const sel = useMap((s) => s.selection);
  const layout = useMap((s) => s.layout);
  const drafts = useMap((s) => s.drafts);
  const editor = useMap(canEdit);
  const adminEdit = useMap((s) => editing(s) && isAdmin(s));
  if (!layout || !sel)
    return (
      <div className="p-4 text-sm text-gray-600" data-testid="inspector-empty">
        <p className="font-semibold text-gray-800">Nothing selected</p>
        <p className="mt-1">Search for a part, or click a shelf on the map or in the Layout list.</p>
        {editor && (
          <p className="mt-2">
            Switch to <b>Edit</b> to place shelves, rows, slots, bins and parts.
          </p>
        )}
      </div>
    );
  if (sel.kind === "shelf") {
    const sh = effectiveShelf({ layout, drafts }, sel.id);
    return sh ? <ShelfInspector sh={sh} /> : null;
  }
  if (sel.kind === "slot") {
    const sh = layout.shelves.find((s) => s.shelf_id === sel.shelfId);
    const sl = sh?.slots.find((x) => x.slot_id === sel.id);
    return sh && sl ? <SlotInspector sh={sh} slot={sl} /> : null;
  }
  if (sel.kind === "zone") {
    const z = layout.zones.find((x) => x.zone_id === sel.id);
    if (z?.area_kind && !adminEdit) return <AreaPanel z={z} />;
    return z ? <ZoneInspector z={z} /> : null;
  }
  const o = layout.openings.find((x) => x.opening_id === sel.id);
  return o ? <OpeningInspector o={o} /> : null;
}
