// Cameras and controls: 3D orbit (perspective + OrbitControls), top-down plan (orthographic,
// north up, MapControls with rotation locked), walk (perspective, see Walk.tsx).
// Camera goals from the store (search zoom, tree clicks) fly smoothly, or cut with reduced motion.

import { MapControls, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FOOTPRINT_X_IN, FOOTPRINT_Y_IN } from "../../shared/units";
import { useMap, type CameraGoal } from "../store";
import { DEG } from "./common";
import { labelView } from "./labels";

export const EYE_HEIGHT_IN = 66; // 5'-6"
const FOV = 50;
const ORTHO_ALT = 9000;

/** Shared camera state that survives switching views. */
export const rig = {
  target: new THREE.Vector3(FOOTPRINT_X_IN / 2, 0, FOOTPRINT_Y_IN / 2),
  orthoZoom: 0.4,
  orbitDir: new THREE.Vector3(0.25, 0.85, 0.47).normalize(),
  orbitDist: 2600,
  walkPos: null as THREE.Vector3 | null,
  walkYaw: 0,
  autoRotate: false,
  pendingTarget: null as THREE.Vector3 | null,
};

interface Anim {
  t0: number;
  dur: number;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromP: THREE.Vector3;
  toP: THREE.Vector3;
  fromZ: number;
  toZ: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CameraRig() {
  const view = useMap((s) => s.view);
  const goal = useMap((s) => s.cameraGoal);
  const reduced = useMap((s) => s.reducedMotion);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const persp = useRef<THREE.PerspectiveCamera>(null);
  const ortho = useRef<THREE.OrthographicCamera>(null);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const mapRef = useRef<OrbitControlsImpl>(null);
  const anim = useRef<Anim | null>(null);
  const lastSeq = useRef(0);
  const prevView = useRef(view);

  // Place cameras when the view changes.
  useEffect(() => {
    const p = persp.current;
    const o = ortho.current;
    if (!p || !o) return;
    const from = prevView.current;
    prevView.current = view;
    anim.current = null;
    if (view === "plan") {
      if (from === "orbit") {
        rig.orbitDist = p.position.distanceTo(rig.target);
        const visH = 2 * rig.orbitDist * Math.tan((FOV / 2) * DEG);
        rig.orthoZoom = THREE.MathUtils.clamp(size.height / visH, 0.05, 40);
      } else if (from === "walk" && rig.walkPos) rig.target.set(rig.walkPos.x, 0, rig.walkPos.z);
      rig.target.y = 0;
      o.zoom = rig.orthoZoom;
      o.position.set(rig.target.x, ORTHO_ALT, rig.target.z + 0.01);
      o.updateProjectionMatrix();
    } else if (view === "orbit") {
      if (from === "plan") {
        const visH = size.height / Math.max(0.05, o.zoom);
        rig.orbitDist = THREE.MathUtils.clamp(visH / (2 * Math.tan((FOV / 2) * DEG)), 60, 9000);
        rig.target.set(o.position.x, 0, o.position.z);
      } else if (from === "walk" && rig.walkPos) {
        const fwd = new THREE.Vector3(-Math.sin(rig.walkYaw), 0, -Math.cos(rig.walkYaw));
        rig.target.set(rig.walkPos.x + fwd.x * 120, 0, rig.walkPos.z + fwd.z * 120);
        rig.orbitDist = 420;
        rig.orbitDir.set(-fwd.x, 0.75, -fwd.z).normalize();
      }
      p.position.copy(rig.target).addScaledVector(rig.orbitDir, rig.orbitDist);
      p.lookAt(rig.target);
    }
    invalidate();
  }, [view]);

  // Fly to camera goals.
  useEffect(() => {
    if (!goal || goal.seq === lastSeq.current) return;
    lastSeq.current = goal.seq;
    startGoal(goal);
  }, [goal]);

  function startGoal(g: CameraGoal) {
    const p = persp.current;
    const o = ortho.current;
    if (!p || !o || view === "walk") return;
    const toT = new THREE.Vector3(g.center.x, view === "plan" ? 0 : g.center.h, g.center.y);
    if (view === "plan") {
      const left = Math.min(g.leftPx ?? 0, size.width * 0.45);
      const z = THREE.MathUtils.clamp(
        Math.min(size.width - left, size.height) / (2 * Math.max(12, g.radius)),
        0.05,
        40,
      );
      toT.x -= left / 2 / z;
      run({
        fromT: rig.target.clone(),
        toT,
        fromP: o.position.clone(),
        toP: new THREE.Vector3(toT.x, ORTHO_ALT, toT.z + 0.01),
        fromZ: o.zoom,
        toZ: z,
      });
    } else {
      const dist = THREE.MathUtils.clamp((Math.max(12, g.radius) / Math.tan((FOV / 2) * DEG)) * 1.1, 36, 9000);
      let dir: THREE.Vector3;
      if (g.from) dir = new THREE.Vector3(g.from.x, 0.42, g.from.y).normalize();
      else {
        dir = p.position.clone().sub(rig.target).normalize();
        if (g.radius > 300) dir.y = Math.max(dir.y, 0.8);
        dir.normalize();
      }
      run({
        fromT: rig.target.clone(),
        toT,
        fromP: p.position.clone(),
        toP: toT.clone().addScaledVector(dir, dist),
        fromZ: 1,
        toZ: 1,
      });
    }
  }

  function run(a: Omit<Anim, "t0" | "dur">) {
    anim.current = { ...a, t0: performance.now(), dur: reduced ? 0 : 650 };
    invalidate();
  }

  useFrame((_, dt) => {
    const p = persp.current;
    const o = ortho.current;
    if (!p || !o) return;
    labelView.mode = view;
    const controls = view === "plan" ? mapRef.current : view === "orbit" ? orbitRef.current : null;
    if (rig.pendingTarget && view === "orbit") {
      const t = rig.pendingTarget;
      rig.pendingTarget = null;
      run({
        fromT: rig.target.clone(),
        toT: t.clone(),
        fromP: p.position.clone(),
        toP: p.position.clone().add(t.clone().sub(rig.target)),
        fromZ: 1,
        toZ: 1,
      });
    }
    const a = anim.current;
    if (a) {
      const k = a.dur ? Math.min(1, (performance.now() - a.t0) / a.dur) : 1;
      const e = ease(k);
      rig.target.lerpVectors(a.fromT, a.toT, e);
      if (view === "plan") {
        o.zoom = a.fromZ + (a.toZ - a.fromZ) * e;
        o.position.set(rig.target.x, ORTHO_ALT, rig.target.z + 0.01);
        o.updateProjectionMatrix();
      } else p.position.lerpVectors(a.fromP, a.toP, e);
      if (controls) controls.target.copy(rig.target);
      if (k >= 1) anim.current = null;
      invalidate(); // keep frames coming until the flight ends (demand mode)
    } else if (controls) {
      rig.target.copy(controls.target);
    }
    if (rig.autoRotate || rig.pendingTarget) invalidate();
    if (view === "orbit" && orbitRef.current) {
      orbitRef.current.autoRotate = rig.autoRotate;
      orbitRef.current.autoRotateSpeed = 6;
      rig.orbitDir.copy(p.position).sub(rig.target).normalize();
    }
    if (view === "plan") rig.orthoZoom = o.zoom;
    controls?.update();
    void dt;
    labelView.target.copy(rig.target);
  });

  return (
    <>
      <PerspectiveCamera
        ref={persp}
        makeDefault={view !== "plan"}
        fov={FOV}
        near={2}
        far={40000}
        position={[FOOTPRINT_X_IN / 2 + 600, 2200, FOOTPRINT_Y_IN / 2 + 1300]}
      />
      <OrthographicCamera
        ref={ortho}
        makeDefault={view === "plan"}
        near={1}
        far={40000}
        position={[FOOTPRINT_X_IN / 2, ORTHO_ALT, FOOTPRINT_Y_IN / 2 + 0.01]}
        zoom={rig.orthoZoom}
      />
      {view === "orbit" && (
        <OrbitControls
          ref={orbitRef as never}
          makeDefault
          target={rig.target.clone()}
          enableDamping
          dampingFactor={0.12}
          maxPolarAngle={Math.PI * 0.49}
          minDistance={20}
          maxDistance={9000}
          zoomSpeed={1.2}
        />
      )}
      {view === "plan" && (
        <MapControls
          ref={mapRef as never}
          makeDefault
          target={rig.target.clone()}
          enableRotate={false}
          enableDamping={false}
          screenSpacePanning
          minPolarAngle={0}
          maxPolarAngle={0}
          minAzimuthAngle={0}
          maxAzimuthAngle={0}
          minZoom={0.05}
          maxZoom={40}
          zoomToCursor
        />
      )}
    </>
  );
}
