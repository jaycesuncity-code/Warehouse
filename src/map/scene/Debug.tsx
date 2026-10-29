// window.__mapDebug: reads geometry back out of the rendered scene (not the data), so tests can
// assert the drawing itself — "assert from scene data, not by eye".

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { getMap } from "../store";
import { rig } from "./CameraRig";

export interface SceneShelf {
  shelf_id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  front: { x: number; z: number };
}

export function SceneDebug() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const api = {
      zones() {
        const out: Record<
          string,
          { minX: number; maxX: number; minZ: number; maxZ: number; width: number; depth: number }
        > = {};
        scene.traverse((o) => {
          if (!o.name.startsWith("zone:")) return;
          const b = new THREE.Box3().setFromObject(o);
          out[o.name.slice(5)] = {
            minX: b.min.x,
            maxX: b.max.x,
            minZ: b.min.z,
            maxZ: b.max.z,
            width: b.max.x - b.min.x,
            depth: b.max.z - b.min.z,
          };
        });
        return out;
      },
      footprint() {
        const b = new THREE.Box3();
        scene.traverse((o) => {
          if (o.name.startsWith("zone:")) b.union(new THREE.Box3().setFromObject(o));
        });
        return {
          minX: b.min.x,
          maxX: b.max.x,
          minZ: b.min.z,
          maxZ: b.max.z,
          width: b.max.x - b.min.x,
          depth: b.max.z - b.min.z,
        };
      },
      shelves(): SceneShelf[] {
        const mesh = scene.getObjectByName("shelf-hits") as THREE.InstancedMesh | undefined;
        if (!mesh) return [];
        const ids: string[] = mesh.userData.hitIds ?? [];
        const lay = getMap().layout;
        const m = new THREE.Matrix4();
        const out: SceneShelf[] = [];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          const b = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(
            m,
          );
          const f = new THREE.Vector3(0, 0, 1).transformDirection(m);
          out.push({
            shelf_id: ids[i],
            name: lay?.shelves.find((s) => s.shelf_id === ids[i])?.name ?? ids[i],
            minX: +b.min.x.toFixed(3) + 0,
            maxX: +b.max.x.toFixed(3) + 0,
            minZ: +b.min.z.toFixed(3) + 0,
            maxZ: +b.max.z.toFixed(3) + 0,
            height: +b.max.y.toFixed(3) + 0,
            front: { x: +f.x.toFixed(3) + 0, z: +f.z.toFixed(3) + 0 },
          });
        }
        return out;
      },
      /** Anything modeled west of X = 0 other than the flat office strip? */
      westOfZero() {
        const hits: string[] = [];
        scene.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh || o.name === "office-strip" || o.name === "floor-events" || !o.visible) return;
          const mesh = o as THREE.Mesh | THREE.InstancedMesh;
          if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
            const im = mesh as THREE.InstancedMesh;
            const m = new THREE.Matrix4();
            for (let i = 0; i < im.count; i++) {
              im.getMatrixAt(i, m);
              const geom = im.geometry;
              if (!geom.boundingBox) geom.computeBoundingBox();
              const b = geom.boundingBox!.clone().applyMatrix4(m).applyMatrix4(im.matrixWorld);
              if (b.min.x < -8) hits.push(`${im.name}#${i}`);
            }
          } else {
            const b = new THREE.Box3().setFromObject(mesh);
            if (b.min.x < -8 && !b.isEmpty()) hits.push(mesh.name || mesh.type);
          }
        });
        return hits;
      },
      /** Client (page) coordinates of a map point, for tests that click the floor. */
      project(x: number, y: number, h = 0) {
        const c = get().camera;
        const v = new THREE.Vector3(x, h, y).project(c);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      searchDots() {
        const m = scene.getObjectByName("search-dots") as THREE.InstancedMesh | undefined;
        return m?.parent?.visible ? m.count : 0;
      },
      camera() {
        const c = get().camera;
        return {
          type: c.type,
          position: c.position.toArray(),
          zoom: (c as THREE.OrthographicCamera).zoom,
          target: rig.target.toArray(),
          view: getMap().view,
        };
      },
      info() {
        return {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries,
        };
      },
      /** Frame times (ms) over `ms` while auto-orbiting. */
      measureFrames(ms = 3000): Promise<{ frames: number; avg: number; p95: number; max: number }> {
        return new Promise((resolve) => {
          const times: number[] = [];
          rig.autoRotate = true;
          let last = performance.now();
          const end = last + ms;
          const tick = () => {
            invalidate();
            const now = performance.now();
            times.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else {
              rig.autoRotate = false;
              const s = times.slice(2).sort((a, b) => a - b);
              resolve({
                frames: s.length,
                avg: s.reduce((a, b) => a + b, 0) / s.length,
                p95: s[Math.floor(s.length * 0.95)],
                max: s[s.length - 1],
              });
            }
          };
          requestAnimationFrame(tick);
        });
      },
    };
    (window as unknown as { __mapDebug: typeof api }).__mapDebug = api;
  }, [scene, gl, get, invalidate]);
  return null;
}
