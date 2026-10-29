// HTML label overlay. One DOM node per label, positioned each frame by <LabelProjector/> inside the
// canvas (direct style writes, no React re-render). No three.js text = no font downloads.

import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";

export type LabelKind = "zone" | "shelf" | "slot" | "axis" | "note" | "measure";

interface Entry {
  el: HTMLElement;
  pos: THREE.Vector3;
  kind: LabelKind;
  minZoom: number;
  shown: boolean;
  last: string;
}

const registry = new Map<string, Entry>();

/** Set by <LabelProjector/>: asks for one frame so newly added labels get positioned. */
export const labelRender = { invalidate: () => {} };

export const labelView = {
  mode: "plan" as "plan" | "orbit" | "walk",
  zoom: 1,
  target: new THREE.Vector3(),
  camPos: new THREE.Vector3(),
};

const _v = new THREE.Vector3();

function visibleFor(kind: LabelKind, dist: number): boolean {
  const { mode, zoom } = labelView;
  switch (kind) {
    case "axis":
      return mode === "plan";
    case "zone":
      return mode === "walk" ? dist < 700 : true;
    case "note":
      return mode === "plan" ? zoom > 0.35 : dist < 1500;
    case "shelf":
      return mode === "plan" ? true : dist < (mode === "walk" ? 500 : 1600);
    case "slot":
      return mode === "plan" ? false : dist < (mode === "walk" ? 160 : 260);
    case "measure":
      return true;
  }
}

/** Lives inside <Canvas>: projects every registered label once per frame. */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    labelRender.invalidate = () => invalidate();
    return () => {
      labelRender.invalidate = () => {};
    };
  }, [invalidate]);
  useFrame(() => {
    labelView.camPos.copy(camera.position);
    labelView.zoom = (camera as THREE.OrthographicCamera).isOrthographicCamera
      ? (camera as THREE.OrthographicCamera).zoom
      : 1;
    for (const e of registry.values()) {
      const dist = camera.position.distanceTo(e.pos);
      _v.copy(e.pos).project(camera);
      const zoomOk = labelView.mode !== "plan" || labelView.zoom >= e.minZoom;
      const on =
        zoomOk && _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15 && visibleFor(e.kind, dist);
      if (on !== e.shown) {
        e.el.style.display = on ? "" : "none";
        e.shown = on;
      }
      if (!on) continue;
      const x = Math.round((_v.x * 0.5 + 0.5) * size.width);
      const y = Math.round((-_v.y * 0.5 + 0.5) * size.height);
      // room names shrink a little when the plan is zoomed far out (phones)
      const sc =
        labelView.mode === "plan" && (e.kind === "zone" || e.kind === "note")
          ? Math.min(1, Math.max(0.72, labelView.zoom / 0.38))
          : 1;
      const t = `translate(${x}px, ${y}px) translate(-50%, -50%)${sc < 1 ? ` scale(${sc.toFixed(2)})` : ""}`;
      if (t !== e.last) {
        e.el.style.transform = t;
        e.last = t;
      }
    }
  });
  return null;
}

export interface LabelSpec {
  key: string;
  kind: LabelKind;
  x: number; // map X
  y: number; // map Y
  h: number; // height
  text: string;
  sub?: string;
  className?: string;
  testId?: string;
  onClick?: () => void;
  /** Plan view: hide below this zoom (px per inch). */
  minZoom?: number;
}

const STYLE: Record<LabelKind, string> = {
  zone: "text-[11px] font-bold uppercase tracking-wide text-slate-700/90 text-center leading-tight",
  note: "text-[10px] font-semibold text-amber-800 bg-amber-100/90 border border-amber-300 rounded px-1",
  shelf: "text-[11px] font-bold text-white bg-maroon/90 rounded px-1 shadow cursor-pointer pointer-events-auto",
  slot: "text-[9px] font-mono font-semibold text-ink bg-white/90 border border-gray-300 rounded px-0.5",
  axis: "text-[10px] font-mono text-slate-600",
  measure: "text-[10px] font-bold text-white bg-amber-600 rounded px-1",
};

const Label = memo(function Label({ spec }: { spec: LabelSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const entry: Entry = {
      el,
      pos: new THREE.Vector3(spec.x, spec.h, spec.y),
      kind: spec.kind,
      minZoom: spec.minZoom ?? 0,
      shown: true,
      last: "",
    };
    el.style.display = "none";
    entry.shown = false;
    registry.set(spec.key, entry);
    labelRender.invalidate();
    return () => {
      if (registry.get(spec.key) === entry) registry.delete(spec.key);
    };
  }, [spec.key, spec.x, spec.y, spec.h, spec.kind, spec.minZoom]);
  return (
    <div
      ref={ref}
      data-testid={spec.testId}
      data-label-kind={spec.kind}
      className={`absolute left-0 top-0 whitespace-nowrap select-none ${spec.onClick ? "" : "pointer-events-none"} ${STYLE[spec.kind]} ${spec.className ?? ""}`}
      onClick={spec.onClick}
    >
      {spec.text}
      {spec.sub && (
        <div className="text-[9px] font-semibold normal-case tracking-normal text-amber-800">{spec.sub}</div>
      )}
    </div>
  );
});

/** DOM side: absolutely positioned over the canvas. */
export function LabelLayer({ labels }: { labels: LabelSpec[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-testid="label-layer">
      {labels.map((l) => (
        <Label key={l.key} spec={l} />
      ))}
    </div>
  );
}
