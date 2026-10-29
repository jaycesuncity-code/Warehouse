// Shelf front-view editor: a to-scale elevation like Jayce's paper "shelf front view" sheets —
// height up the left, distance from the shelf's left edge along the bottom, standing in the aisle
// facing the shelf. Rows (drag decks), columns, slots (draw / fill / resize), bins, part drops.

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LayoutShelf, LayoutSlot, Row } from "../../shared/contract";
import { overlappingSlots, slotBoundsProblem } from "../gridRules";
import { cellWidth, formatFtIn, formatIn, recalcClearHeights, round16, slotRect } from "../units";
import { assignPart, createSlot, fillRow, renumberShelf, resizeSlot, select, setCols, setRows } from "../actions";
import { fillState } from "../colors";
import { editing, effectiveShelf, selectedShelfId, setMap, toast, useMap } from "../store";
import { readPartDrag } from "./LeftPanel";

const PAD_L = 92;
const PAD_R = 76;
const PAD_T = 16;
const PAD_B = 46;

const FILL_STYLE = {
  empty: { fill: "#F8FAFC", stroke: "#94A3B8" },
  stock: { fill: "#DCFCE7", stroke: "#15803D" },
  low: { fill: "#FEF3C7", stroke: "#B45309" },
  out: { fill: "#FEE2E2", stroke: "#B91C1C" },
};

type Drag =
  | { kind: "draw"; r0: number; c0: number; r1: number; c1: number }
  | {
      kind: "resize";
      slot: LayoutSlot;
      edge: "l" | "r" | "t" | "b";
      rect: { row_index: number; col_start: number; width_span: number; height_span: number };
    }
  | { kind: "row"; index: number; elevation: number };

export function FrontView({ onClose }: { onClose: () => void }) {
  const sel = useMap((s) => s.selection);
  const layout = useMap((s) => s.layout);
  const drafts = useMap((s) => s.drafts);
  const id = selectedShelfId(sel);
  const sh = id && layout ? effectiveShelf({ layout, drafts }, id) : undefined;
  if (!sh) return null;
  return <FrontViewInner sh={sh} slotId={sel?.kind === "slot" ? sel.id : null} onClose={onClose} />;
}

function FrontViewInner({ sh, slotId, onClose }: { sh: LayoutShelf; slotId: string | null; onClose: () => void }) {
  const can = useMap(editing) && !sh.shelf_id.startsWith("tmp-");
  const detail = useMap((s) => s.shelfDetail[sh.shelf_id]);
  const glow = useMap((s) => s.search.focus.slotIds);
  const reduced = useMap((s) => s.reducedMotion);
  const tool = useMap((s) => s.tool);
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 360 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [fillRowIdx, setFillRowIdx] = useState(0);
  const [fillN, setFillN] = useState(4);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const s = Math.max(0.5, Math.min((size.w - PAD_L - PAD_R) / sh.width_in, (size.h - PAD_T - PAD_B) / sh.height_in));
  const ox = PAD_L + Math.max(0, (size.w - PAD_L - PAD_R - sh.width_in * s) / 2);
  const X = (u: number) => ox + u * s;
  const Y = (h: number) => PAD_T + (sh.height_in - h) * s;
  const cw = cellWidth(sh);
  const rows =
    drag?.kind === "row"
      ? recalcClearHeights(
          sh.rows.map((r) => (r.row_index === drag.index ? { ...r, elevation_in: drag.elevation } : r)),
          sh.height_in,
        )
      : sh.rows;
  const grid = { ...sh, rows };
  const partsBySlot = useMemo(() => new Map((detail?.slots ?? []).map((x) => [x.slot_id, x.parts])), [detail]);

  const toLocal = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { u: (clientX - r.left - ox) / s, h: sh.height_in - (clientY - r.top - PAD_T) / s };
  };
  const colAt = (u: number) => Math.min(sh.cols, Math.max(1, Math.floor(u / cw) + 1));
  const rowAt = (h: number) => {
    let idx = 0;
    sh.rows.forEach((r, i) => {
      if (h >= r.elevation_in - 1) idx = i;
    });
    return idx;
  };
  const slotAt = (row: number, col: number) =>
    sh.slots.find(
      (x) =>
        row >= x.row_index &&
        row < x.row_index + x.height_span &&
        col >= x.col_start &&
        col < x.col_start + x.width_span,
    );

  // pointer handling for drawing / resizing / row dragging
  const dragging = drag?.kind;
  const movePointer = useEffectEvent((e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      const next = ((d: Drag | null): Drag | null => {
        if (!d) return d;
        if (d.kind === "draw") return { ...d, r1: rowAt(p.h), c1: colAt(p.u) };
        if (d.kind === "row") {
          const below = sh.rows[d.index - 1];
          const above = sh.rows[d.index + 1];
          const lo = below ? below.elevation_in + 2 : 0;
          const hi = above ? above.elevation_in - 2 : sh.height_in - 1;
          return { ...d, elevation: round16(Math.min(hi, Math.max(lo, Math.round(p.h * 2) / 2))) };
        }
        const sl = d.slot;
        const right = sl.col_start + sl.width_span - 1;
        const top = sl.row_index + sl.height_span - 1;
        const c = colAt(p.u);
        const r = rowAt(p.h);
        let rect = {
          row_index: sl.row_index,
          col_start: sl.col_start,
          width_span: sl.width_span,
          height_span: sl.height_span,
        };
        if (d.edge === "r") rect = { ...rect, width_span: Math.max(1, c - sl.col_start + 1) };
        if (d.edge === "l") {
          const nl = Math.min(c, right);
          rect = { ...rect, col_start: nl, width_span: right - nl + 1 };
        }
        if (d.edge === "t") rect = { ...rect, height_span: Math.max(1, r - sl.row_index + 1) };
        if (d.edge === "b") {
          const nb = Math.min(r, top);
          rect = { ...rect, row_index: nb, height_span: top - nb + 1 };
        }
        return { ...d, rect };
      })(dragRef.current);
      dragRef.current = next;
      setDrag(next);
  });
  const endPointer = useEffectEvent(() => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === "draw") {
        const r0 = Math.min(d.r0, d.r1);
        const c0 = Math.min(d.c0, d.c1);
        void createSlot(sh.shelf_id, {
          row_index: r0,
          col_start: c0,
          width_span: Math.abs(d.c1 - d.c0) + 1,
          height_span: Math.abs(d.r1 - d.r0) + 1,
        });
      } else if (d.kind === "resize") {
        const a = d.rect;
        const sl = d.slot;
        if (
          a.col_start !== sl.col_start ||
          a.width_span !== sl.width_span ||
          a.row_index !== sl.row_index ||
          a.height_span !== sl.height_span
        )
          void resizeSlot(sh.shelf_id, sl.slot_id, a);
      } else if (d.kind === "row") {
        const old = sh.rows[d.index];
        if (old && old.elevation_in !== d.elevation)
          void setRows(
            sh.shelf_id,
            recalcClearHeights(
              sh.rows.map((r) => (r.row_index === d.index ? { ...r, elevation_in: d.elevation } : r)),
              sh.height_in,
            ),
            `Move row ${old.row_label}`,
          );
      }
  });
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => movePointer(event);
    const up = () => endPointer();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toLocal(e.clientX, e.clientY);
    if (p.u < 0 || p.u > sh.width_in || p.h < 0 || p.h > sh.height_in) return;
    const r = rowAt(p.h);
    const c = colAt(p.u);
    if (slotAt(r, c)) return;
    if (!can) return select({ kind: "shelf", id: sh.shelf_id }, { front: true });
    e.preventDefault();
    setDrag({ kind: "draw", r0: r, c0: c, r1: r, c1: c });
  };

  const clickSlot = (sl: LayoutSlot) => {
    if (tool?.kind === "move-part") {
      setMap({ tool: null });
      if (tool.from_slot_id === sl.slot_id) return;
      void assignPart({ part_id: tool.part_id, part_name: tool.part_name }, sl.slot_id, {
        from_slot_id: tool.from_slot_id,
      });
      return;
    }
    select({ kind: "slot", shelfId: sh.shelf_id, id: sl.slot_id }, { front: true });
  };

  const drop = (e: React.DragEvent, sl: LayoutSlot) => {
    e.preventDefault();
    setDropOn(null);
    const p = readPartDrag(e);
    if (!p || !can) return;
    if (p.from_slot_id === sl.slot_id) return;
    void assignPart(
      { part_id: p.part_id, part_name: p.part_name },
      sl.slot_id,
      p.from_slot_id ? { from_slot_id: p.from_slot_id } : { mode: "add", par_qty: 0, on_hand_qty: 0 },
    );
  };

  // preview rectangle (draw / resize)
  let preview: {
    rect: { row_index: number; col_start: number; width_span: number; height_span: number };
    bad: string | null;
    exclude?: string;
  } | null = null;
  if (drag?.kind === "draw") {
    const rect = {
      row_index: Math.min(drag.r0, drag.r1),
      col_start: Math.min(drag.c0, drag.c1),
      width_span: Math.abs(drag.c1 - drag.c0) + 1,
      height_span: Math.abs(drag.r1 - drag.r0) + 1,
    };
    const over = overlappingSlots(sh.slots, rect);
    preview = {
      rect,
      bad:
        slotBoundsProblem(sh, rect) ?? (over.length ? `Overlaps ${over.map((o) => o.location_code).join(", ")}` : null),
    };
  } else if (drag?.kind === "resize") {
    const over = overlappingSlots(sh.slots, drag.rect, drag.slot.slot_id);
    preview = {
      rect: drag.rect,
      bad:
        slotBoundsProblem(sh, drag.rect) ??
        (over.length ? `Overlaps ${over.map((o) => o.location_code).join(", ")}` : null),
      exclude: drag.slot.slot_id,
    };
  }
  const previewRect = preview ? slotRect(grid, preview.rect) : null;

  const addRow = () => {
    const top = sh.rows[sh.rows.length - 1];
    if (top.clear_height_in < 6) return toast("No room above the top row for another deck.", "warn");
    const nr: Row = {
      row_index: sh.rows.length,
      row_label: String(sh.rows.length),
      elevation_in: round16(top.elevation_in + Math.floor(top.clear_height_in / 2)),
      clear_height_in: 1,
    };
    void setRows(sh.shelf_id, recalcClearHeights([...sh.rows, nr], sh.height_in), "Add row");
  };
  const removeTopRow = () => {
    if (sh.rows.length <= 1) return toast("A shelf needs at least one row.", "warn");
    void setRows(
      sh.shelf_id,
      recalcClearHeights(sh.rows.slice(0, -1), sh.height_in),
      `Remove row ${sh.rows[sh.rows.length - 1].row_label}`,
    );
  };

  const ticks: number[] = [];
  for (let i = 0; i <= sh.height_in; i += 12) ticks.push(i);
  const uticks: number[] = [];
  for (let i = 0; i <= sh.width_in; i += 12) uticks.push(i);
  const selSlot = slotId ? sh.slots.find((x) => x.slot_id === slotId) : undefined;

  return (
    <div className="flex h-full flex-col bg-white" data-testid="front-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-1.5">
        <div className="flex min-w-0 basis-full items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-maroon">
              Shelf {sh.name} <span className="font-normal text-gray-500">· front view</span>
            </div>
            <div className="text-[11px] text-gray-600">
              {formatFtIn(sh.width_in)} W × {formatFtIn(sh.height_in)} H · {sh.cols} cols ({formatIn(cw)} cells) ·{" "}
              {sh.rows.length} rows · standing in the aisle facing the shelf
            </div>
          </div>
          <button
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close front view"
            data-testid="close-front-view"
          >
            ✕
          </button>
        </div>
        {can && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="front-tools">
            <button className="btn-ghost btn-sm" onClick={addRow} data-testid="add-row">
              + Row
            </button>
            <button className="btn-ghost btn-sm" onClick={removeTopRow} data-testid="remove-row">
              − Top row
            </button>
            <label className="flex items-center gap-1">
              Cols
              <input
                className="field !w-14 !py-0.5 font-mono"
                type="number"
                min={1}
                max={200}
                defaultValue={sh.cols}
                key={`${sh.shelf_id}-${sh.cols}`}
                data-testid="front-cols"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n !== sh.cols) void setCols(sh.shelf_id, n);
                  else e.target.value = String(sh.cols);
                }}
              />
            </label>
            <span className="text-gray-300">|</span>
            <label className="flex items-center gap-1">
              Fill row
              <select
                className="field !w-auto !py-0.5"
                value={fillRowIdx}
                onChange={(e) => setFillRowIdx(Number(e.target.value))}
                data-testid="fill-row-select"
              >
                {sh.rows.map((r) => (
                  <option key={r.row_index} value={r.row_index}>
                    {r.row_label}
                  </option>
                ))}
              </select>
              with
              <input
                className="field !w-12 !py-0.5 font-mono"
                type="number"
                min={1}
                max={sh.cols}
                value={fillN}
                onChange={(e) => setFillN(Number(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                data-testid="fill-row-n"
              />
            </label>
            <button
              className="btn-ghost btn-sm"
              onClick={() => void fillRow(sh.shelf_id, fillRowIdx, fillN)}
              data-testid="fill-row"
            >
              Fill
            </button>
            <button className="btn-ghost btn-sm" onClick={() => renumberShelf(sh.shelf_id)} data-testid="renumber">
              Renumber L→R
            </button>
            <span
              className="cursor-help rounded-full border border-gray-300 px-1.5 text-[11px] font-bold text-gray-500"
              title="Drag across empty cells to draw a slot. Click a slot, then drag its gold edges to resize. Drag a deck's ⇕ grip to move a row. Drop parts on slots."
            >
              ?
            </span>
          </div>
        )}
      </div>

      {tool?.kind === "move-part" && (
        <div className="mx-3 mt-1 rounded bg-gold px-2 py-1 text-xs font-semibold">
          Click the slot to move {tool.part_name} into.
        </div>
      )}
      <div ref={wrap} className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          className="block select-none"
          onPointerDown={onBgDown}
          role="img"
          aria-label={`Front view of shelf ${sh.name}`}
        >
          {/* frame */}
          <rect
            x={X(0)}
            y={Y(sh.height_in)}
            width={sh.width_in * s}
            height={sh.height_in * s}
            fill="#F1F5F9"
            stroke="#CBD5E1"
          />
          {/* column grid */}
          {Array.from({ length: sh.cols + 1 }, (_, i) => (
            <line
              key={`c${i}`}
              x1={X(i * cw)}
              x2={X(i * cw)}
              y1={Y(sh.height_in)}
              y2={Y(0)}
              stroke="#CBD5E1"
              strokeDasharray="3 3"
            />
          ))}
          {/* uprights */}
          <rect x={X(0) - 3} y={Y(sh.height_in)} width={4} height={sh.height_in * s} fill="#5F6B78" />
          <rect x={X(sh.width_in) - 1} y={Y(sh.height_in)} width={4} height={sh.height_in * s} fill="#5F6B78" />
          {/* decks + row labels */}
          {rows.map((r) => (
            <g key={r.row_index} data-testid={`row-${r.row_label}`}>
              <rect x={X(0)} y={Y(r.elevation_in)} width={sh.width_in * s} height={Math.max(2, s)} fill="#7B8794" />
              <text
                x={X(0) - 8}
                y={Y(r.elevation_in) + 4}
                textAnchor="end"
                className="fill-maroon text-[12px] font-extrabold"
              >
                {r.row_label}
              </text>
              <text
                x={X(0) - 8}
                y={Y(r.elevation_in) + 15}
                textAnchor="end"
                className="fill-gray-500 font-mono text-[9px]"
              >
                {formatFtIn(r.elevation_in)}
              </text>
              <text
                x={X(sh.width_in) + (can ? 38 : 8)}
                y={Y(r.elevation_in + r.clear_height_in / 2) + 3}
                className="fill-gray-500 font-mono text-[9px]"
              >
                ↕{formatIn(r.clear_height_in)}
              </text>
              {can && (
                <g
                  className="cursor-ns-resize"
                  data-testid={`row-grip-${r.row_label}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDrag({ kind: "row", index: r.row_index, elevation: r.elevation_in });
                  }}
                >
                  <rect x={X(sh.width_in) + 6} y={Y(r.elevation_in) - 7} width={26} height={14} rx={3} fill="#C9A84C" />
                  <text
                    x={X(sh.width_in) + 19}
                    y={Y(r.elevation_in) + 4}
                    textAnchor="middle"
                    className="fill-ink text-[10px] font-bold"
                  >
                    ⇕
                  </text>
                </g>
              )}
            </g>
          ))}
          {/* slots */}
          {sh.slots.map((sl) => {
            if (preview?.exclude === sl.slot_id) return null;
            const r = slotRect(grid, sl);
            if (!r) return null;
            const fs = FILL_STYLE[fillState(sl)];
            const isSel = sl.slot_id === slotId;
            const isGlow = glow.includes(sl.slot_id);
            const parts = partsBySlot.get(sl.slot_id) ?? [];
            const x = X(r.left) + 1.5;
            const y = Y(r.bottom + r.height) + 1.5;
            const w = Math.max(2, r.width * s - 3);
            const h = Math.max(2, (r.height - 0) * s - 3);
            const bw = sl.bin_width_in;
            const bh = sl.bin_height_in;
            const big = (bw ?? 0) > r.width + 0.01 || (bh ?? 0) > r.height + 0.01;
            return (
              <g
                key={sl.slot_id}
                data-testid={`fv-slot-${sl.location_code}`}
                data-slot-id={sl.slot_id}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => clickSlot(sl)}
                onDragOver={(e) => {
                  if (!can) return;
                  e.preventDefault();
                  setDropOn(sl.slot_id);
                }}
                onDragLeave={() => setDropOn((d) => (d === sl.slot_id ? null : d))}
                onDrop={(e) => drop(e, sl)}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={3}
                  fill={dropOn === sl.slot_id ? "#FDE68A" : fs.fill}
                  stroke={isSel ? "#C9A84C" : isGlow ? "#B0213F" : fs.stroke}
                  strokeWidth={isSel ? 3.5 : isGlow ? 3 : 1.25}
                  className={isGlow && !reduced ? "animate-pulse" : undefined}
                  style={isGlow ? { filter: "drop-shadow(0 0 5px rgba(224,51,90,.85))" } : undefined}
                />
                {(bw || bh) && (
                  <rect
                    x={X(r.left + r.width / 2 - (bw ?? r.width - 1) / 2)}
                    y={Y(r.bottom + (bh ?? r.height - 1))}
                    width={(bw ?? r.width - 1) * s}
                    height={(bh ?? r.height - 1) * s}
                    fill={sl.bin_color ?? "none"}
                    fillOpacity={0.18}
                    stroke={big ? "#DC2626" : "#475569"}
                    strokeDasharray={big ? "4 2" : "2 2"}
                    strokeWidth={big ? 2 : 1}
                    pointerEvents="none"
                  />
                )}
                <foreignObject
                  x={x + 2}
                  y={y + 1}
                  width={Math.max(0, w - 4)}
                  height={Math.max(0, h - 2)}
                  pointerEvents="none"
                >
                  <div className="h-full overflow-hidden text-[10px] leading-tight text-ink">
                    <div className="flex items-baseline gap-1">
                      <b className="text-[12px]">{sl.slot_no}</b>
                      <span className="truncate font-mono text-[9px] text-gray-600">{sl.location_code}</span>
                    </div>
                    {parts.slice(0, Math.max(1, Math.floor((h - 14) / 12))).map((p) => (
                      <div key={p.part_id} className="truncate">
                        {p.part_name}
                      </div>
                    ))}
                    {!parts.length && h > 26 && <div className="italic text-gray-400">empty</div>}
                  </div>
                </foreignObject>
              </g>
            );
          })}
          {/* draw / resize preview */}
          {preview && previewRect && (
            <g data-testid="fv-preview" data-bad={preview.bad ? "1" : "0"}>
              <rect
                x={X(previewRect.left) + 1}
                y={Y(previewRect.bottom + previewRect.height) + 1}
                width={previewRect.width * s - 2}
                height={previewRect.height * s - 2}
                fill={preview.bad ? "rgba(220,38,38,.25)" : "rgba(201,168,76,.35)"}
                stroke={preview.bad ? "#DC2626" : "#C9A84C"}
                strokeWidth={2}
                rx={3}
              />
              <text
                x={X(previewRect.left) + 6}
                y={Y(previewRect.bottom + previewRect.height) + 16}
                className={`text-[11px] font-bold ${preview.bad ? "fill-red-700" : "fill-ink"}`}
              >
                {preview.bad ?? `${preview.rect.width_span} × ${preview.rect.height_span}`}
              </text>
            </g>
          )}
          {/* resize handles on the selected slot */}
          {can && selSlot && !drag && (
            <ResizeHandles
              sl={selSlot}
              grid={grid}
              X={X}
              Y={Y}
              s={s}
              onStart={(edge) =>
                setDrag({
                  kind: "resize",
                  slot: selSlot,
                  edge,
                  rect: {
                    row_index: selSlot.row_index,
                    col_start: selSlot.col_start,
                    width_span: selSlot.width_span,
                    height_span: selSlot.height_span,
                  },
                })
              }
            />
          )}
          {/* axes */}
          {ticks.map((t) => (
            <g key={`t${t}`}>
              <line x1={X(0) - 58} x2={X(0) - 52} y1={Y(t)} y2={Y(t)} stroke="#94A3B8" />
              <text x={X(0) - 60} y={Y(t) + 3} textAnchor="end" className="fill-gray-400 font-mono text-[8px]">
                {t / 12}'
              </text>
            </g>
          ))}
          {Array.from({ length: sh.cols }, (_, i) =>
            cw * s > 13 ? (
              <text
                key={`cn${i}`}
                x={X((i + 0.5) * cw)}
                y={Y(0) + 13}
                textAnchor="middle"
                className="fill-gray-500 font-mono text-[9px]"
              >
                {i + 1}
              </text>
            ) : null,
          )}
          {uticks.map((t) => (
            <g key={`u${t}`}>
              <line x1={X(t)} x2={X(t)} y1={Y(0) + 17} y2={Y(0) + 22} stroke="#94A3B8" />
              <text x={X(t)} y={Y(0) + 32} textAnchor="middle" className="fill-gray-400 font-mono text-[8px]">
                {t / 12}'
              </text>
            </g>
          ))}
          <text x={X(0)} y={Y(0) + 43} className="fill-gray-500 text-[9px]">
            ← left edge · distance from the left edge (columns above, feet below)
          </text>
        </svg>
      </div>
    </div>
  );
}

function ResizeHandles({
  sl,
  grid,
  X,
  Y,
  s,
  onStart,
}: {
  sl: LayoutSlot;
  grid: Pick<LayoutShelf, "width_in" | "cols" | "rows">;
  X: (u: number) => number;
  Y: (h: number) => number;
  s: number;
  onStart: (edge: "l" | "r" | "t" | "b") => void;
}) {
  const r = slotRect(grid, sl);
  if (!r) return null;
  const x0 = X(r.left);
  const x1 = X(r.left + r.width);
  const y0 = Y(r.bottom + r.height);
  const y1 = Y(r.bottom);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const H = 10;
  const start = (edge: "l" | "r" | "t" | "b") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onStart(edge);
  };
  void s;
  return (
    <g data-testid="resize-handles">
      <rect
        x={x1 - H / 2}
        y={my - 14}
        width={H}
        height={28}
        rx={3}
        fill="#C9A84C"
        stroke="#6B1A2C"
        className="cursor-ew-resize"
        onPointerDown={start("r")}
        data-testid="handle-r"
      />
      <rect
        x={x0 - H / 2}
        y={my - 14}
        width={H}
        height={28}
        rx={3}
        fill="#C9A84C"
        stroke="#6B1A2C"
        className="cursor-ew-resize"
        onPointerDown={start("l")}
        data-testid="handle-l"
      />
      <rect
        x={mx - 14}
        y={y0 - H / 2}
        width={28}
        height={H}
        rx={3}
        fill="#C9A84C"
        stroke="#6B1A2C"
        className="cursor-ns-resize"
        onPointerDown={start("t")}
        data-testid="handle-t"
      />
      <rect
        x={mx - 14}
        y={y1 - H / 2}
        width={28}
        height={H}
        rx={3}
        fill="#C9A84C"
        stroke="#6B1A2C"
        className="cursor-ns-resize"
        onPointerDown={start("b")}
        data-testid="handle-b"
      />
    </g>
  );
}
