// Lets the DOM drop handler on the viewport ask "which slot is under this point?" (drag a part
// onto a bin in 3D).

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

export const dropPicker = {
  pick: (_x: number, _y: number): { shelfId: string; slotId: string } | null => null,
};

export function DropPicker() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const ray = new THREE.Raycaster();
    dropPicker.pick = (clientX, clientY) => {
      const bins = scene.getObjectByName("bins") as THREE.InstancedMesh | undefined;
      if (!bins) return null;
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
      const hit = ray.intersectObject(bins)[0];
      const refs = bins.userData.binRefs as { shelfId: string; slotId: string }[] | undefined;
      return hit?.instanceId != null && refs ? refs[hit.instanceId] : null;
    };
    return () => {
      dropPicker.pick = () => null;
    };
  }, [camera, scene, gl]);
  return null;
}
