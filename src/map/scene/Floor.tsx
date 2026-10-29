// Floor plane events (cursor readout, "Add shelf" click, deselect, double-click orbit target) and
// admin handles for zone vertices / opening ends in the top-down plan.

import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Opening, Point, Zone } from "../../shared/contract";
import { FOOTPRINT_X_IN, FOOTPRINT_Y_IN, round16 } from "../units";
import { addShelfAt, patchOpening, patchZone, select } from "../actions";
import { editing, getMap, isAdmin, setMap, useMap } from "../store";
import { floorPointAt } from "./common";
import { rig } from "./CameraRig";

const blocked = (e: ThreeEvent<MouseEvent>) =>
  e.intersections.some((i) => i.object.name === "shelf-hits" || i.object.name.startsWith("handle"));

let raf = 0;
export function FloorEvents() {
  const invalidate = useThree((s) => s.invalidate);
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p = { x: e.point.x, y: e.point.z };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setMap({ cursor: p }));
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || blocked(e)) return;
    const s = getMap();
    if (s.view === "walk") return;
    const p = { x: e.point.x, y: e.point.z };
    if (editing(s) && s.tool?.kind === "add-shelf") {
      const preset = s.tool.preset;
      if (!e.nativeEvent.shiftKey) setMap({ tool: null });
      void addShelfAt(p, preset);
      return;
    }
    if (s.tool?.kind === "move-part") return;
    if (
      e.intersections.some(
        (i) => i.object.name.startsWith("opening:") || (i.object.name.startsWith("zone:") && editing(s) && isAdmin(s)),
      )
    )
      return;
    select(null);
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (getMap().view !== "orbit") return;
    rig.pendingTarget = new THREE.Vector3(e.point.x, 0, e.point.z);
    invalidate();
  };
  return (
    <mesh
      name="floor-events"
      position={[FOOTPRINT_X_IN / 2, 0, FOOTPRINT_Y_IN / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={onMove}
      onPointerLeave={() => setMap({ cursor: null })}
      onClick={onClick}
      onDoubleClick={onDouble}
    >
      <planeGeometry args={[FOOTPRINT_X_IN + 1200, FOOTPRINT_Y_IN + 1200]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

const HANDLE_GEOM = new THREE.SphereGeometry(1, 16, 10);

function Handle({
  p,
  onDrag,
  onDrop,
  label,
}: {
  p: Point;
  onDrag: (q: Point) => void;
  onDrop: (q: Point) => void;
  label: string;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const ref = useRef<THREE.Mesh>(null);
  const zoom = (camera as THREE.OrthographicCamera).isOrthographicCamera
    ? (camera as THREE.OrthographicCamera).zoom
    : 1;
  const r = 7 / zoom;
  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const dom = gl.domElement;
    if (controls) controls.enabled = false;
    let last: Point = p;
    const snapTo = getMap().snap || 1;
    const move = (ev: PointerEvent) => {
      const q = floorPointAt(camera, dom, ev.clientX, ev.clientY);
      if (!q) return;
      last = [round16(Math.round(Math.max(0, q.x) / snapTo) * snapTo), round16(Math.round(q.y / snapTo) * snapTo)];
      onDrag(last);
    };
    const up = () => {
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerup", up);
      if (controls) controls.enabled = true;
      onDrop(last);
    };
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerup", up);
  };
  return (
    <mesh
      ref={ref}
      name={`handle:${label}`}
      geometry={HANDLE_GEOM}
      position={[p[0], 4, p[1]]}
      scale={r}
      onPointerDown={down}
      renderOrder={20}
    >
      <meshBasicMaterial color="#C9A84C" depthTest={false} />
    </mesh>
  );
}

function ZoneHandles({ zone }: { zone: Zone }) {
  const [draft, setDraft] = useState<Point[] | null>(null);
  useEffect(() => setDraft(null), [zone.version]);
  const poly = draft ?? zone.polygon_in;
  const line = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([...poly, poly[0]].map(([x, y]) => new THREE.Vector3(x, 3, y))),
    [poly],
  );
  return (
    <group name="zone-handles">
      <line>
        <primitive object={line} attach="geometry" />
        <lineBasicMaterial color="#C9A84C" />
      </line>
      {poly.map((pt, i) => (
        <Handle
          key={i}
          label={`v${i}`}
          p={pt}
          onDrag={(q) => setDraft(poly.map((x, j) => (j === i ? q : x)))}
          onDrop={(q) => {
            const next = poly.map((x, j) => (j === i ? q : x));
            void patchZone(zone, { polygon_in: next }, `Move corner of ${zone.name}`);
          }}
        />
      ))}
    </group>
  );
}

function OpeningHandles({ o }: { o: Opening }) {
  const [draft, setDraft] = useState<[Point, Point] | null>(null);
  useEffect(() => setDraft(null), [o.version]);
  const ends: [Point, Point] = draft ?? [
    [o.x1_in, o.y1_in],
    [o.x2_in, o.y2_in],
  ];
  const drop = (i: 0 | 1, q: Point) => {
    const e = ends.map((x, j) => (j === i ? q : x)) as [Point, Point];
    void patchOpening(o, { x1_in: e[0][0], y1_in: e[0][1], x2_in: e[1][0], y2_in: e[1][1] }, `Move ${o.kind} ${o.tag}`);
  };
  return (
    <group name="opening-handles">
      {ends.map((pt, i) => (
        <Handle
          key={i}
          label={`o${i}`}
          p={pt}
          onDrag={(q) => setDraft(ends.map((x, j) => (j === i ? q : x)) as [Point, Point])}
          onDrop={(q) => drop(i as 0 | 1, q)}
        />
      ))}
    </group>
  );
}

/** Admins edit zone polygons and openings by dragging in the top-down plan. */
export function AdminHandles() {
  const on = useMap((s) => editing(s) && isAdmin(s) && s.view === "plan");
  const sel = useMap((s) => s.selection);
  const layout = useMap((s) => s.layout);
  if (!on || !layout || !sel) return null;
  if (sel.kind === "zone") {
    const z = layout.zones.find((x) => x.zone_id === sel.id);
    return z ? <ZoneHandles zone={z} /> : null;
  }
  if (sel.kind === "opening") {
    const o = layout.openings.find((x) => x.opening_id === sel.id);
    return o ? <OpeningHandles o={o} /> : null;
  }
  return null;
}
