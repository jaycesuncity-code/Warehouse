// Zones (floor slabs + outlines), walls with opening gaps, lintels over doors, translucent
// overhead doors, opening markers, and the flat "office side - not modeled" strip.

import { Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Opening, Zone } from "../../shared/contract";
import { DEFAULT_WALL_HEIGHT_IN, FOOTPRINT_Y_IN } from "../units";
import { select } from "../actions";
import { UNVERIFIED, zoneColor } from "../colors";
import { buildWalls } from "../geometry";
import { editing, isAdmin, useMap } from "../store";
import { segmentBoxMatrix, UNIT_BOX } from "./common";

const CUTAWAY_IN = 36;

function ZoneFloor({
  zone,
  color,
  highlight,
  onSelect,
}: {
  zone: Zone;
  color: string;
  highlight: boolean;
  onSelect?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(zone.polygon_in.map(([x, y]) => new THREE.Vector2(x, -y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // (x, -y, 0) -> (x, 0, y)
    return g;
  }, [zone.polygon_in]);
  const pts = useMemo(
    () => [...zone.polygon_in, zone.polygon_in[0]].map(([x, y]) => new THREE.Vector3(x, 0.6, y)),
    [zone.polygon_in],
  );
  return (
    <group>
      <mesh
        geometry={geom}
        position={[0, 0.05, 0]}
        name={`zone:${zone.name}`}
        userData={{ zone_id: zone.zone_id }}
        onClick={onSelect}
        renderOrder={-1}
      >
        <meshStandardMaterial
          color={color}
          roughness={1}
          metalness={0}
          transparent
          opacity={highlight ? 0.75 : 0.55}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={pts}
        color={zone.verified ? "#64748B" : UNVERIFIED}
        lineWidth={highlight ? 3 : zone.verified ? 1.5 : 2}
        dashed={!zone.verified}
        dashSize={18}
        gapSize={10}
      />
    </group>
  );
}

function Walls({
  zones,
  openings,
  cutaway,
  xray,
}: {
  zones: Zone[];
  openings: Opening[];
  cutaway: boolean;
  xray: boolean;
}) {
  const { walls, pieces } = useMemo(() => buildWalls(zones, openings, DEFAULT_WALL_HEIGHT_IN), [zones, openings]);
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const lintelRef = useRef<THREE.InstancedMesh>(null);
  const lintels = pieces.filter((p) => p.lintel && !cutaway);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const wm = wallRef.current!;
    walls.forEach((w, i) =>
      wm.setMatrixAt(i, segmentBoxMatrix(m, w.x1, w.y1, w.x2, w.y2, 4, 0, cutaway ? CUTAWAY_IN : w.height)),
    );
    wm.count = walls.length;
    wm.instanceMatrix.needsUpdate = true;
    wm.computeBoundingSphere();
    const lm = lintelRef.current!;
    lintels.forEach((p, i) => {
      const l = p.lintel!;
      lm.setMatrixAt(i, segmentBoxMatrix(m, l.x1, l.y1, l.x2, l.y2, 4, p.opening.height_in, l.height));
    });
    lm.count = lintels.length;
    lm.instanceMatrix.needsUpdate = true;
    lm.computeBoundingSphere();
    invalidate();
  }, [walls, lintels, cutaway, invalidate]);
  const mat = (
    <meshStandardMaterial
      color="#CBD3DC"
      roughness={0.95}
      transparent={xray}
      opacity={xray ? 0.16 : 1}
      depthWrite={!xray}
      side={THREE.DoubleSide}
    />
  );
  return (
    <group>
      <instancedMesh
        ref={wallRef}
        args={[UNIT_BOX, undefined, Math.max(1, walls.length)]}
        name="walls"
        frustumCulled={false}
        raycast={() => null}
      >
        {mat}
      </instancedMesh>
      <instancedMesh
        ref={lintelRef}
        args={[UNIT_BOX, undefined, Math.max(1, pieces.length)]}
        name="lintels"
        frustumCulled={false}
        raycast={() => null}
      >
        {mat}
      </instancedMesh>
    </group>
  );
}

const OPENING_COLOR = { door: "#8D5524", overhead: "#2563EB", opening: "#64748B" } as const;

function OpeningMarker({
  o,
  cutaway,
  selected,
  onSelect,
}: {
  o: Opening;
  cutaway: boolean;
  selected: boolean;
  onSelect?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const len = Math.hypot(o.x2_in - o.x1_in, o.y2_in - o.y1_in);
  const ang = -Math.atan2(o.y2_in - o.y1_in, o.x2_in - o.x1_in);
  const cx = (o.x1_in + o.x2_in) / 2;
  const cz = (o.y1_in + o.y2_in) / 2;
  const panelH = cutaway ? Math.min(o.height_in, CUTAWAY_IN) : o.height_in;
  return (
    <group>
      <Line
        points={[new THREE.Vector3(o.x1_in, 0.9, o.y1_in), new THREE.Vector3(o.x2_in, 0.9, o.y2_in)]}
        color={selected ? "#C9A84C" : o.verified ? OPENING_COLOR[o.kind] : UNVERIFIED}
        lineWidth={selected ? 6 : 4}
        dashed={!o.verified}
        dashSize={6}
        gapSize={4}
      />
      {/* fat invisible hit strip so openings are clickable in the plan */}
      <mesh position={[cx, 1, cz]} rotation={[0, ang, 0]} onClick={onSelect} name={`opening:${o.tag}`}>
        <boxGeometry args={[len, 2, 14]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {o.kind === "overhead" && (
        <mesh position={[cx, panelH / 2, cz]} rotation={[0, ang, 0]} raycast={() => null}>
          <boxGeometry args={[len, panelH, 1.5]} />
          <meshStandardMaterial color="#93C5FD" transparent opacity={0.32} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export function Building() {
  const layout = useMap((s) => s.layout);
  const viewOpts = useMap((s) => s.viewOpts);
  const view = useMap((s) => s.view);
  const sel = useMap((s) => s.selection);
  const adminEdit = useMap((s) => editing(s) && isAdmin(s));
  const unverifiedOnly = useMap((s) => s.unverifiedOnly);
  const colorBy = useMap((s) => s.colorBy);
  if (!layout) return null;
  const zones = viewOpts.isolateZone ? layout.zones.filter((z) => z.zone_id === viewOpts.isolateZone) : layout.zones;
  const zoneIds = new Set(zones.map((z) => z.zone_id));
  const openings = viewOpts.isolateZone
    ? layout.openings.filter((o) => !o.zone_id || zoneIds.has(o.zone_id) || zonesTouch(o, zones))
    : layout.openings;
  const cutaway = viewOpts.cutaway || view === "plan";
  const pick = (fn: () => void) => (e: ThreeEvent<MouseEvent>) => {
    if (!adminEdit || e.delta > 4) return;
    e.stopPropagation();
    fn();
  };
  const tint = (z: Zone) =>
    unverifiedOnly || colorBy === "unverified"
      ? z.verified
        ? "#E5E7EB"
        : "#FCD9A6"
      : zoneColor(layout.zones, z.zone_id);
  return (
    <group name="building">
      {zones.map((z) => (
        <ZoneFloor
          key={z.zone_id}
          zone={z}
          color={tint(z)}
          highlight={sel?.kind === "zone" && sel.id === z.zone_id}
          onSelect={pick(() => select({ kind: "zone", id: z.zone_id }))}
        />
      ))}
      <Walls zones={zones} openings={openings} cutaway={cutaway} xray={viewOpts.xray} />
      {openings.map((o) => (
        <OpeningMarker
          key={o.opening_id}
          o={o}
          cutaway={cutaway}
          selected={sel?.kind === "opening" && sel.id === o.opening_id}
          onSelect={pick(() => select({ kind: "opening", id: o.opening_id }))}
        />
      ))}
      {/* Office side: nothing modeled west of X = 0. */}
      <mesh
        position={[-72, 0.02, FOOTPRINT_Y_IN / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        name="office-strip"
        raycast={() => null}
      >
        <planeGeometry args={[144, FOOTPRINT_Y_IN]} />
        <meshBasicMaterial color="#B8BCC2" />
      </mesh>
    </group>
  );
}

function zonesTouch(o: Opening, zones: Zone[]): boolean {
  return zones.some((z) => z.polygon_in.some(([x, y]) => Math.hypot(x - o.x1_in, y - o.y1_in) < 1500));
}
