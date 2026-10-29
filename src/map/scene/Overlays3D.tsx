// Selection outline + front arrow, drag ghost, aisle measurement, search glow (pulsing maroon
// dots on matching shelves, glowing matching slots), plan grid.

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FOOTPRINT_X_IN, FOOTPRINT_Y_IN, frontDir, shelfCenter, shelfToMap } from "../units";
import { GLOW } from "../colors";
import { aisleWidth, shelfWarnings, type WarningConfig } from "../geometry";
import type { Layout, LayoutShelf } from "../../shared/contract";
import { effectiveShelf, selectedShelfId, useMap } from "../store";
import { shelfBoxMatrix, UNIT_BOX } from "./common";
import { binBox, ShelfGhost } from "./Shelves";

export function SelectionOverlay() {
  const sel = useMap((s) => s.selection);
  const drafts = useMap((s) => s.drafts);
  const layout = useMap((s) => s.layout);
  const dragId = useMap((s) => s.dragId);
  const warnCfg = useMap((s) => s.warnCfg);
  const id = selectedShelfId(sel) ?? dragId;
  const sh = id ? effectiveShelf({ layout, drafts }, id) : undefined;
  if (!sh || !layout) return null;
  return (
    <SelectedShelf
      sh={sh}
      layout={layout}
      dragging={dragId === sh.shelf_id}
      slotId={sel?.kind === "slot" ? sel.id : null}
      warnCfg={warnCfg}
    />
  );
}

function SelectedShelf({
  sh,
  layout,
  dragging,
  slotId,
  warnCfg,
}: {
  sh: LayoutShelf;
  layout: Layout;
  dragging: boolean;
  slotId: string | null;
  warnCfg: WarningConfig;
}) {
  const info = useMemo(() => {
    const others = layout.shelves.filter((x) => x.shelf_id !== sh.shelf_id);
    const warnings = shelfWarnings(
      sh,
      {
        shelves: layout.shelves.map((x) => (x.shelf_id === sh.shelf_id ? sh : x)),
        zones: layout.zones,
        openings: layout.openings,
      },
      warnCfg,
    );
    return { warnings, aisle: aisleWidth(sh, others) };
  }, [sh, layout, warnCfg]);
  const edges = useMemo(() => new THREE.EdgesGeometry(UNIT_BOX), []);
  const box = useMemo(
    () =>
      decompose(shelfBoxMatrix(new THREE.Matrix4(), sh, -1, sh.width_in + 1, -1, sh.depth_in + 1, 0, sh.height_in + 1)),
    [sh],
  );
  const arrow = useMemo(() => {
    const c = shelfCenter(sh);
    const f = frontDir(sh.rotation_deg);
    const tip = { x: c.x + f.x * (sh.depth_in / 2 + 26), y: c.y + f.y * (sh.depth_in / 2 + 26) };
    const l = shelfToMap(sh, sh.width_in / 2 - 10, -4);
    const r = shelfToMap(sh, sh.width_in / 2 + 10, -4);
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(l.x, 1.2, l.y),
      new THREE.Vector3(tip.x, 1.2, tip.y),
      new THREE.Vector3(r.x, 1.2, r.y),
    ]);
  }, [sh]);
  useEffect(() => () => arrow.dispose(), [arrow]);
  const slotSel = slotId ? sh.slots.find((x) => x.slot_id === slotId) : undefined;
  const sb = slotSel ? binBox(sh, slotSel) : null;
  const slotM = sb
    ? shelfBoxMatrix(
        new THREE.Matrix4(),
        sh,
        sb.u0 - 0.6,
        sb.u1 + 0.6,
        sb.v0 - 0.6,
        sb.v1 + 0.6,
        sb.h0 - 0.3,
        sb.h1 + 0.6,
      )
    : null;
  const warn = info.warnings.length > 0;
  const f = frontDir(sh.rotation_deg);
  const aisleFrom = shelfToMap(sh, sh.width_in / 2, -0.5);
  return (
    <group name="selection">
      {dragging && <ShelfGhost shelf={sh} warn={warn} />}
      <lineSegments geometry={edges} position={box.pos} quaternion={box.quat} scale={box.scl} raycast={() => null}>
        <lineBasicMaterial color={warn ? "#F59E0B" : "#C9A84C"} />
      </lineSegments>
      <mesh geometry={arrow} raycast={() => null} name="front-arrow">
        <meshBasicMaterial color={warn ? "#F59E0B" : "#C9A84C"} side={THREE.DoubleSide} />
      </mesh>
      {slotM && <SlotOutline m={slotM} />}
      {info.aisle && (
        <Line
          points={[
            new THREE.Vector3(aisleFrom.x, 3, aisleFrom.y),
            new THREE.Vector3(aisleFrom.x + f.x * info.aisle.width, 3, aisleFrom.y + f.y * info.aisle.width),
          ]}
          color={info.aisle.width < warnCfg.minAisleIn ? "#DC2626" : "#0EA5E9"}
          lineWidth={3}
          dashed
          dashSize={4}
          gapSize={3}
        />
      )}
    </group>
  );
}

function decompose(m: THREE.Matrix4) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);
  return { pos, quat, scl };
}

function SlotOutline({ m }: { m: THREE.Matrix4 }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(UNIT_BOX), []);
  const { pos, quat, scl } = decompose(m);
  return (
    <lineSegments geometry={edges} position={pos} quaternion={quat} scale={scl} raycast={() => null}>
      <lineBasicMaterial color="#C9A84C" />
    </lineSegments>
  );
}

const SPHERE = new THREE.SphereGeometry(1, 20, 14);

/** Pulsing maroon dots above every shelf holding a match + glowing matching slots. */
export function SearchGlow() {
  const focus = useMap((s) => s.search.focus);
  const layout = useMap((s) => s.layout);
  const reduced = useMap((s) => s.reducedMotion);
  const view = useMap((s) => s.view);
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const slotRef = useRef<THREE.InstancedMesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const slotMat = useRef<THREE.MeshBasicMaterial>(null);

  const { dots, slots } = useMemo(() => {
    const dots: THREE.Vector3[] = [];
    const slots: THREE.Matrix4[] = [];
    if (!layout || focus.level === "idle" || focus.level === "none") return { dots, slots };
    const ids = new Set(focus.shelfIds);
    const slotIds = new Set(focus.slotIds);
    for (const sh of layout.shelves) {
      if (!ids.has(sh.shelf_id)) continue;
      const c = shelfCenter(sh);
      dots.push(new THREE.Vector3(c.x, sh.height_in + 16, c.y));
      for (const sl of sh.slots) {
        if (!slotIds.has(sl.slot_id)) continue;
        const b = binBox(sh, sl);
        if (b)
          slots.push(
            shelfBoxMatrix(
              new THREE.Matrix4(),
              sh,
              b.u0 - 0.8,
              b.u1 + 0.8,
              b.v0 - 1.2,
              b.v1 + 0.4,
              b.h0 - 0.4,
              b.h1 + 0.8,
            ),
          );
      }
    }
    return { dots, slots };
  }, [layout, focus]);

  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const s = slotRef.current;
    if (!s) return;
    slots.forEach((m, i) => s.setMatrixAt(i, m));
    s.count = slots.length;
    s.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [slots, invalidate]);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera }) => {
    const core = coreRef.current;
    const halo = haloRef.current;
    if (!core || !halo) return;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    // constant on-screen size in the plan; real size (8" radius) in 3D
    const base = ortho ? 7 / (camera as THREE.OrthographicCamera).zoom : 8;
    const t = clock.elapsedTime;
    const phase = reduced ? 0.5 : (t * 1.2) % 1;
    dots.forEach((p, i) => {
      sc.setScalar(base);
      core.setMatrixAt(i, m4.compose(p, q, sc));
      sc.setScalar(base * (reduced ? 2.2 : 1.4 + phase * 2.4));
      halo.setMatrixAt(i, m4.compose(p, q, sc));
    });
    core.count = dots.length;
    halo.count = dots.length;
    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    if (haloMat.current) haloMat.current.opacity = reduced ? 0.35 : 0.55 * (1 - phase);
    if (slotMat.current) slotMat.current.opacity = reduced ? 0.55 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 5));
  });
  const cap = Math.max(16, dots.length);
  return (
    <group name="search-glow" visible={dots.length > 0 || slots.length > 0}>
      <instancedMesh
        key={`c${cap}`}
        ref={coreRef}
        args={[SPHERE, undefined, cap]}
        frustumCulled={false}
        raycast={() => null}
        name="search-dots"
        renderOrder={10}
      >
        <meshBasicMaterial color={GLOW} depthTest={view !== "plan"} />
      </instancedMesh>
      <instancedMesh
        key={`h${cap}`}
        ref={haloRef}
        args={[SPHERE, undefined, cap]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={9}
      >
        <meshBasicMaterial
          ref={haloMat}
          color="#E0335A"
          transparent
          opacity={0.4}
          depthWrite={false}
          depthTest={view !== "plan"}
        />
      </instancedMesh>
      <instancedMesh
        key={`s${Math.max(16, slots.length)}`}
        ref={slotRef}
        args={[UNIT_BOX, undefined, Math.max(16, slots.length)]}
        frustumCulled={false}
        raycast={() => null}
        name="search-slots"
      >
        <meshBasicMaterial ref={slotMat} color="#E0335A" transparent opacity={0.5} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/** 1 ft / 5 ft grid for the top-down plan (1 ft lines fade in as you zoom in). */
export function PlanGrid() {
  const view = useMap((s) => s.view);
  const minorMat = useRef<THREE.LineBasicMaterial>(null);
  const majorMat = useRef<THREE.LineBasicMaterial>(null);
  useFrame(({ camera }) => {
    const z = (camera as THREE.OrthographicCamera).isOrthographicCamera ? (camera as THREE.OrthographicCamera).zoom : 1;
    if (minorMat.current) minorMat.current.opacity = THREE.MathUtils.clamp((z - 0.45) * 0.6, 0, 0.3);
    if (majorMat.current) majorMat.current.opacity = THREE.MathUtils.clamp(0.25 + z * 0.3, 0.25, 0.6);
  });
  const { minor, major } = useMemo(() => {
    const maxX = Math.ceil(FOOTPRINT_X_IN / 12) * 12;
    const maxY = Math.ceil(FOOTPRINT_Y_IN / 12) * 12;
    const mi: number[] = [];
    const ma: number[] = [];
    for (let x = 0; x <= maxX; x += 12) (x % 60 === 0 ? ma : mi).push(x, 0.25, 0, x, 0.25, maxY);
    for (let y = 0; y <= maxY; y += 12) (y % 60 === 0 ? ma : mi).push(0, 0.25, y, maxX, 0.25, y);
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute("position", new THREE.Float32BufferAttribute(mi, 3));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(ma, 3));
    return { minor: g1, major: g2 };
  }, []);
  return (
    <group visible={view === "plan"} name="plan-grid">
      <lineSegments geometry={minor} raycast={() => null}>
        <lineBasicMaterial ref={minorMat} color="#94A3B8" transparent opacity={0.28} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={major} raycast={() => null}>
        <lineBasicMaterial ref={majorMat} color="#64748B" transparent opacity={0.55} depthWrite={false} />
      </lineSegments>
    </group>
  );
}
