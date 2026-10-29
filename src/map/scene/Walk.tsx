// Walk mode: first person at 5'-6", WASD + mouse look (pointer lock), Shift to run, collision with
// walls and shelves, Esc exits. Touch: virtual joystick (WalkJoystick, DOM) + drag to look.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildWalls, collideMove, collisionSegments, zoneAt } from "../geometry";
import { frontDir, shelfToMap } from "../units";
import { getMap, selectedShelfId, setMap, shelfById, useMap } from "../store";
import { EYE_HEIGHT_IN, rig } from "./CameraRig";

export const walkInput = { joy: { x: 0, y: 0 }, locked: false };

const WALK_SPEED = 66; // in/s (5.5 ft/s)
const RUN_MULT = 2.6;
const RADIUS = 9;

export function WalkController() {
  const view = useMap((s) => s.view);
  return view === "walk" ? <Walker /> : null;
}

function Walker() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const layout = useMap((s) => s.layout);
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(-0.08);
  const segs = useMemo(() => {
    if (!layout) return [];
    const { walls } = buildWalls(layout.zones, layout.openings);
    return collisionSegments(walls, layout.shelves);
  }, [layout]);

  // Start 5' in front of the selected shelf, facing it; else where the camera was looking.
  useEffect(() => {
    const s = getMap();
    const sh = shelfById(s, selectedShelfId(s.selection));
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    yaw.current = Math.abs(dir.x) + Math.abs(dir.z) > 0.01 ? Math.atan2(-dir.x, -dir.z) : 0;
    let start: THREE.Vector3;
    if (sh) {
      const p = shelfToMap(sh, sh.width_in / 2, -60);
      const f = frontDir(sh.rotation_deg);
      start = new THREE.Vector3(p.x, EYE_HEIGHT_IN, p.y);
      yaw.current = Math.atan2(f.x, f.y); // look back at the shelf (along -front)
    } else {
      const t = rig.target;
      const inside = layout && zoneAt(layout.zones, { x: t.x, y: t.z });
      start = inside ? new THREE.Vector3(t.x, EYE_HEIGHT_IN, t.z) : new THREE.Vector3(240, EYE_HEIGHT_IN, 1080);
    }
    camera.position.copy(start);
    pitch.current = -0.08;
    rig.walkPos = camera.position.clone();
  }, []);

  useEffect(() => {
    const dom = gl.domElement;
    let wasLocked = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      keys.current.add(e.code);
      if (e.code === "Escape" && !document.pointerLockElement) setMap({ view: "orbit" });
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onClick = () => {
      if (document.pointerLockElement !== dom) {
        try {
          const r = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
          r?.catch?.(() => {});
        } catch {
          /* not supported */
        }
      }
    };
    const onLockChange = () => {
      const locked = document.pointerLockElement === dom;
      walkInput.locked = locked;
      if (wasLocked && !locked) setMap({ view: "orbit" }); // Esc
      wasLocked = locked;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== dom) return;
      yaw.current -= e.movementX * 0.0023;
      pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.0023, -1.35, 1.35);
    };
    // touch: drag to look
    let touchId: number | null = null;
    let tx = 0;
    let ty = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      touchId = e.pointerId;
      tx = e.clientX;
      ty = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return;
      yaw.current -= (e.clientX - tx) * 0.005;
      pitch.current = THREE.MathUtils.clamp(pitch.current - (e.clientY - ty) * 0.005, -1.35, 1.35);
      tx = e.clientX;
      ty = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === touchId) touchId = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      if (document.pointerLockElement === dom) document.exitPointerLock?.();
      walkInput.locked = false;
      keys.current.clear();
    };
  }, [gl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw);
    const k = keys.current;
    let f =
      (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - walkInput.joy.y;
    let s =
      (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + walkInput.joy.x;
    const mag = Math.hypot(f, s);
    if (mag > 1) {
      f /= mag;
      s /= mag;
    }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || Math.hypot(walkInput.joy.x, walkInput.joy.y) > 0.92;
    const speed = WALK_SPEED * (run ? RUN_MULT : 1) * dt;
    const yw = yaw.current;
    const fwd = { x: -Math.sin(yw), y: -Math.cos(yw) };
    const right = { x: Math.cos(yw), y: -Math.sin(yw) };
    if (f || s) {
      const from = { x: camera.position.x, y: camera.position.z };
      const to = { x: from.x + (fwd.x * f + right.x * s) * speed, y: from.y + (fwd.y * f + right.y * s) * speed };
      const p = collideMove(from, to, RADIUS, segs);
      camera.position.set(p.x, EYE_HEIGHT_IN, p.y);
    } else camera.position.y = EYE_HEIGHT_IN;
    camera.rotation.set(pitch.current, yw, 0, "YXZ");
    rig.walkPos = camera.position.clone();
    rig.walkYaw = yw;
  });
  return null;
}
