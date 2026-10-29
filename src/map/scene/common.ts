// Shared three.js helpers. World mapping (contract §1): x = map X, z = map Y, y = height; 1 unit = 1 in.

import * as THREE from "three";
import type { ShelfBase } from "../../shared/contract";
import { shelfToMap } from "../units";

export const DEG = Math.PI / 180;
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

type Placed = Pick<ShelfBase, "x_in" | "y_in" | "rotation_deg">;

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Matrix for an axis-aligned box in shelf-local space: u (width), v (back from front), h (height). */
export function shelfBoxMatrix(
  out: THREE.Matrix4,
  sh: Placed,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  h0: number,
  h1: number,
): THREE.Matrix4 {
  const c = shelfToMap(sh, (u0 + u1) / 2, (v0 + v1) / 2);
  _p.set(c.x, (h0 + h1) / 2, c.y);
  _q.setFromAxisAngle(_up, -sh.rotation_deg * DEG);
  _s.set(Math.max(0.01, Math.abs(u1 - u0)), Math.max(0.01, Math.abs(h1 - h0)), Math.max(0.01, Math.abs(v1 - v0)));
  return out.compose(_p, _q, _s);
}

/** Matrix for a wall-like box from (x1,y1) to (x2,y2), thickness t, from h0 to h1. */
export function segmentBoxMatrix(
  out: THREE.Matrix4,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
  h0: number,
  h1: number,
): THREE.Matrix4 {
  const len = Math.hypot(x2 - x1, y2 - y1);
  _p.set((x1 + x2) / 2, (h0 + h1) / 2, (y1 + y2) / 2);
  _q.setFromAxisAngle(_up, -Math.atan2(y2 - y1, x2 - x1));
  _s.set(Math.max(0.01, len), Math.max(0.01, h1 - h0), t);
  return out.compose(_p, _q, _s);
}

export const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _hit = new THREE.Vector3();

/** Floor point (map inches) under a client-space pointer position. */
export function floorPointAt(
  camera: THREE.Camera,
  dom: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const r = dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(ndc, camera);
  const p = _ray.ray.intersectPlane(_plane, _hit);
  return p ? { x: p.x, y: p.z } : null;
}

/** Rounds an instance count up so InstancedMesh buffers are reused while editing. */
export function capacityFor(n: number): number {
  let c = 64;
  while (c < n) c *= 2;
  return c;
}

export const tmpColor = new THREE.Color();
