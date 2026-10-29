// DOM overlays on top of the viewport: cursor readout, north arrow, legend, walk hint + touch
// joystick, tool hints, and the label list fed to <LabelLayer/>.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutShelf } from "../../shared/contract";
import { formatFtIn, frontDir, mapToSheet, shelfCenter, shelfToMap, slotRect } from "../units";
import { COLOR_BY_LABEL, LEGENDS, UNVERIFIED } from "../colors";
import { aisleWidth, labelPoint } from "../geometry";
import { PRESETS } from "../presets";
import { select } from "../actions";
import { effectiveShelf, selectedShelfId, setMap, useMap } from "../store";
import { rig } from "../scene/CameraRig";
import { labelView, type LabelSpec } from "../scene/labels";
import { walkInput } from "../scene/Walk";

export function CursorReadout() {
  const c = useMap((s) => s.cursor);
  const survey = useMap((s) => s.surveyInput);
  const view = useMap((s) => s.view);
  if (!c || view === "walk") return null;
  const sheet = mapToSheet(c);
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md bg-ink/85 px-2 py-1 font-mono text-[11px] text-white shadow"
      data-testid="cursor-readout"
    >
      X {formatFtIn(c.x)} · Y {formatFtIn(c.y)}
      {survey && <span className="ml-2 text-gold-light">sheet Y {formatFtIn(sheet.y)}</span>}
    </div>
  );
}

export function NorthArrow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = labelView.target;
      const p = labelView.camPos;
      let deg = 0;
      if (labelView.mode !== "plan") {
        const dx = labelView.mode === "walk" ? -Math.sin(rig.walkYaw) : t.x - p.x;
        const dz = labelView.mode === "walk" ? -Math.cos(rig.walkYaw) : t.z - p.z;
        deg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      }
      if (ref.current) ref.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="pointer-events-none absolute right-2 top-2 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-gray-300 bg-white/90 shadow"
      title="Plan north"
      data-testid="north-arrow"
    >
      <div ref={ref} className="flex flex-col items-center leading-none">
        <span className="text-[10px] font-black text-maroon">N</span>
        <svg width="14" height="22" viewBox="0 0 14 22" aria-hidden>
          <path d="M7 0 L13 14 L7 10 L1 14 Z" fill="#6B1A2C" />
          <path d="M7 22 L1 14 L7 18 L13 14 Z" fill="#9CA3AF" />
        </svg>
      </div>
    </div>
  );
}

export function Legend() {
  const colorBy = useMap((s) => s.colorBy);
  const [open, setOpen] = useState(false);
  return (
    <div
      className="absolute bottom-2 right-2 z-10 max-w-[230px] rounded-md border border-gray-200 bg-white/92 text-[11px] shadow"
      data-testid="legend"
    >
      <button
        className="flex w-full items-center gap-1 px-2 py-1 font-semibold text-gray-700"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Legend · {COLOR_BY_LABEL[colorBy]} <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 px-2 pb-2">
          {LEGENDS[colorBy].map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3.5 rounded-sm border border-black/10"
                style={{ background: l.color }}
              />
              {l.label}
            </li>
          ))}
          <li className="flex items-center gap-1.5 pt-1">
            <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: UNVERIFIED }} />
            Unverified (not tape-checked yet)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-3.5 bg-maroon" />
            Shelf front (aisle side)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#B0213F] shadow-[0_0_0_3px_rgba(224,51,90,.35)]" />
            Search match
          </li>
        </ul>
      )}
    </div>
  );
}

export function ToolHint() {
  const tool = useMap((s) => s.tool);
  const view = useMap((s) => s.view);
  const last = useMap((s) => s.lastSize);
  if (view === "walk") return <WalkHint />;
  if (!tool) return null;
  const text =
    tool.kind === "add-shelf"
      ? `Click the floor to place ${tool.preset === "last" ? `a ${formatFtIn(last.width_in)} W × ${formatFtIn(last.depth_in)} D unit` : `a ${PRESETS[tool.preset].label} unit`}. Shift-click to place several. Esc cancels.`
      : `Pick a slot for ${tool.part_name}: click it in the front view or in 3D. Esc cancels.`;
  return (
    <div
      className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink shadow"
      data-testid="tool-hint"
    >
      {text}
      <button className="ml-2 underline" onClick={() => setMap({ tool: null })}>
        Cancel
      </button>
    </div>
  );
}

function WalkHint() {
  const coarse =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches || window.matchMedia?.("(hover: none)").matches);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLocked(walkInput.locked), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {!locked && (
        <div
          className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1 text-xs font-semibold text-white shadow"
          data-testid="walk-hint"
        >
          {coarse
            ? "Joystick to walk · drag to look"
            : "Click to look around · WASD to walk · Shift to run · Esc to exit"}
        </div>
      )}
      {coarse && <Joystick />}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-1 ring-black/40" />
    </>
  );
}

/** Virtual joystick for touch walking (also usable with a mouse). */
function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const set = (clientX: number, clientY: number) => {
    const r = base.current!.getBoundingClientRect();
    const R = r.width / 2;
    let x = (clientX - (r.left + R)) / R;
    let y = (clientY - (r.top + R)) / R;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    walkInput.joy = { x, y };
    setKnob({ x, y });
  };
  const end = () => {
    active.current = null;
    walkInput.joy = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
  };
  useEffect(() => () => end(), []);
  return (
    <div
      ref={base}
      className="absolute bottom-16 left-4 z-20 h-28 w-28 touch-none rounded-full border-2 border-white/70 bg-black/25 shadow-lg"
      data-testid="joystick"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        set(e.clientX, e.clientY);
        e.stopPropagation();
      }}
      onPointerMove={(e) => active.current === e.pointerId && set(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/85 shadow"
        style={{ transform: `translate(calc(-50% + ${knob.x * 34}px), calc(-50% + ${knob.y * 34}px))` }}
      />
    </div>
  );
}

/** Label list for the HTML overlay (zones, shelves, slots near the camera, plan axes). */
export function useLabels(): LabelSpec[] {
  const layout = useMap((s) => s.layout);
  const sel = useMap((s) => s.selection);
  const drafts = useMap((s) => s.drafts);
  const view = useMap((s) => s.view);
  const survey = useMap((s) => s.surveyInput);
  const isolate = useMap((s) => s.viewOpts.isolateZone);
  const [near, setNear] = useState<string[]>([]);
  useEffect(() => {
    const t = setInterval(() => {
      const lay = useMap.getState().layout;
      if (!lay) return;
      const tx = labelView.target.x;
      const tz = labelView.target.z;
      const close =
        labelView.mode !== "plan" && (labelView.camPos.distanceTo(labelView.target) < 420 || labelView.mode === "walk");
      if (!close) return setNear((n) => (n.length ? [] : n));
      const px = labelView.mode === "walk" ? labelView.camPos.x : tx;
      const pz = labelView.mode === "walk" ? labelView.camPos.z : tz;
      const ids = lay.shelves
        .map((s) => ({ id: s.shelf_id, d: Math.hypot(shelfCenter(s).x - px, shelfCenter(s).y - pz) }))
        .filter((x) => x.d < 260)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
        .map((x) => x.id);
      setNear((n) => (n.join() === ids.join() ? n : ids));
    }, 400);
    return () => clearInterval(t);
  }, []);
  const selId = selectedShelfId(sel);
  return useMemo(() => {
    if (!layout) return [];
    const out: LabelSpec[] = [];
    const zones = isolate ? layout.zones.filter((z) => z.zone_id === isolate) : layout.zones;
    for (const z of zones) {
      const p = labelPoint(z.polygon_in);
      out.push({
        key: `z:${z.zone_id}`,
        kind: "zone",
        x: p.x,
        y: p.y,
        h: 2,
        text: z.name,
        sub: z.verified ? undefined : "unverified",
      });
      if (z.notes && /high-pile/i.test(z.notes))
        out.push({
          key: `zn:${z.zone_id}`,
          kind: "note",
          x: p.x,
          y: p.y + 60,
          h: 2,
          text: `⚠ ${z.notes}`,
          testId: "zone-note",
        });
    }
    out.push({
      key: "office",
      kind: "axis",
      x: -72,
      y: 975,
      h: 2,
      text: "OFFICE SIDE · not modeled",
      className: "!font-bold !text-slate-600 [writing-mode:vertical-rl]",
    });
    const shelves = isolate ? layout.shelves.filter((s) => s.zone_id === isolate) : layout.shelves;
    for (const s0 of shelves) {
      const s = (drafts[s0.shelf_id] ? effectiveShelf({ layout, drafts }, s0.shelf_id) : s0) as LayoutShelf;
      const c = shelfCenter(s);
      out.push({
        key: `s:${s.shelf_id}`,
        kind: "shelf",
        x: c.x,
        y: c.y,
        h: s.height_in + 6,
        text: s.name,
        testId: `shelf-label-${s.name}`,
        className: s.shelf_id === selId ? "!bg-gold !text-ink" : undefined,
        onClick: () => select({ kind: "shelf", id: s.shelf_id }, { front: true }),
      });
    }
    const slotShelves = new Set(view === "plan" ? [] : [...near, ...(selId ? [selId] : [])]);
    for (const id of slotShelves) {
      const s = layout.shelves.find((x) => x.shelf_id === id);
      if (!s) continue;
      for (const sl of s.slots) {
        const r = slotRect(s, sl);
        if (!r) continue;
        const p = shelfToMap(s, r.left + r.width / 2, -1);
        out.push({
          key: `sl:${sl.slot_id}`,
          kind: "slot",
          x: p.x,
          y: p.y,
          h: r.bottom + Math.min(r.height, 10) / 2 + 1,
          text: sl.location_code,
        });
      }
    }
    if (selId) {
      const s = effectiveShelf({ layout, drafts }, selId);
      if (s) {
        const a = aisleWidth(
          s,
          layout.shelves.filter((x) => x.shelf_id !== selId),
        );
        if (a) {
          const f = frontDir(s.rotation_deg);
          const m = shelfToMap(s, s.width_in / 2, -a.width / 2);
          out.push({
            key: "aisle",
            kind: "measure",
            x: m.x + f.x * 0,
            y: m.y,
            h: 4,
            text: `Aisle ${formatFtIn(a.width)}`,
            testId: "aisle-label",
          });
        }
      }
    }
    if (view === "plan") {
      for (let ft = 0; ft <= 100; ft += 10)
        out.push({
          key: `ax:${ft}`,
          kind: "axis",
          x: ft * 12,
          y: -22,
          h: 0,
          text: ft === 0 ? "X 0'" : `${ft}'`,
          minZoom: ft % 20 ? 0.3 : 0,
        });
      for (let ft = 0; ft <= 160; ft += 10) {
        const y = ft * 12;
        out.push({
          key: `ay:${ft}`,
          kind: "axis",
          minZoom: ft % 20 ? 0.3 : 0,
          x: -18,
          y,
          h: 0,
          text: survey ? `${ft}' (sheet ${formatFtIn(mapToSheet({ x: 0, y }).y)})` : ft === 0 ? "Y 0'" : `${ft}'`,
          className: survey ? "!text-amber-700 -translate-x-1/2" : undefined,
        });
      }
    }
    return out;
  }, [layout, drafts, selId, near, view, survey, isolate]);
}
