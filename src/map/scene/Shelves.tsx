// All shelves drawn with a handful of InstancedMeshes (posts, decks, front lips, bins, pick boxes),
// so ~300 shelves / 5,000 slots stay cheap. No textures.

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LayoutShelf, LayoutSlot } from "../../shared/contract";
import { slotRect } from "../units";
import { DECK, SHELF_STEEL, slotColor, zoneColor, type ColorBy } from "../colors";
import { useMap } from "../store";
import { capacityFor, shelfBoxMatrix, tmpColor, UNIT_BOX } from "./common";
import { useShelfPointer } from "./Interaction";

export interface BinBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  h0: number;
  h1: number;
}

/** Physical box drawn for a slot's bin (real bin dimensions when set). */
export function binBox(
  sh: Pick<LayoutShelf, "width_in" | "depth_in" | "cols" | "rows">,
  slot: Pick<
    LayoutSlot,
    | "row_index"
    | "col_start"
    | "width_span"
    | "height_span"
    | "bin_type"
    | "bin_width_in"
    | "bin_height_in"
    | "bin_depth_in"
  >,
): BinBox | null {
  const r = slotRect(sh, slot);
  if (!r) return null;
  const uc = r.left + r.width / 2;
  const bw = slot.bin_width_in ?? Math.max(0.5, r.width - 1);
  const bh =
    slot.bin_height_in ?? (slot.bin_type === "loose" ? 1.5 : Math.max(2, Math.min(r.height - 1, r.height * 0.75)));
  const bd = slot.bin_depth_in ?? Math.max(1, sh.depth_in - 2);
  const h0 = r.bottom + 0.05;
  return { u0: uc - bw / 2, u1: uc + bw / 2, v0: 0.75, v1: 0.75 + bd, h0, h1: h0 + bh };
}

interface Built {
  posts: THREE.Matrix4[];
  decks: THREE.Matrix4[];
  lips: THREE.Matrix4[];
  bins: THREE.Matrix4[];
  binColors: THREE.Color[];
  binRefs: { shelfId: string; slotId: string }[];
  hits: THREE.Matrix4[];
  hitIds: string[];
}

export function buildShelfInstances(
  shelves: LayoutShelf[],
  opts: {
    colorBy: ColorBy;
    hideEmpty: boolean;
    unverifiedOnly: boolean;
    zoneOf: (id: string | null) => { color: string; verified: boolean };
  },
): Built {
  const out: Built = { posts: [], decks: [], lips: [], bins: [], binColors: [], binRefs: [], hits: [], hitIds: [] };
  for (const sh of shelves) {
    const W = sh.width_in;
    const D = sh.depth_in;
    const H = sh.height_in;
    if (sh.kind !== "floor_area") {
      for (const u of [0.75, W - 0.75])
        for (const v of [0.75, D - 0.75])
          out.posts.push(shelfBoxMatrix(new THREE.Matrix4(), sh, u - 0.75, u + 0.75, v - 0.75, v + 0.75, 0, H));
      for (const r of sh.rows)
        out.decks.push(
          shelfBoxMatrix(
            new THREE.Matrix4(),
            sh,
            0,
            W,
            0,
            D,
            Math.max(0, r.elevation_in - 1),
            Math.max(0.5, r.elevation_in),
          ),
        );
      out.lips.push(shelfBoxMatrix(new THREE.Matrix4(), sh, 0, W, 0, 2.5, H - 1, H + 0.5));
    } else {
      out.decks.push(shelfBoxMatrix(new THREE.Matrix4(), sh, 0, W, 0, D, 0, 0.5));
      out.lips.push(shelfBoxMatrix(new THREE.Matrix4(), sh, 0, W, 0, 2.5, 0, 1));
    }
    const z = opts.zoneOf(sh.zone_id);
    for (const sl of sh.slots) {
      if (opts.hideEmpty && sl.part_count === 0) continue;
      const b = binBox(sh, sl);
      if (!b) continue;
      out.bins.push(shelfBoxMatrix(new THREE.Matrix4(), sh, b.u0, b.u1, b.v0, b.v1, b.h0, b.h1));
      let c = slotColor(sl, opts.colorBy, { zoneColor: z.color, zoneVerified: z.verified });
      if (opts.unverifiedOnly && z.verified) c = "#E5E7EB";
      out.binColors.push(new THREE.Color(c));
      out.binRefs.push({ shelfId: sh.shelf_id, slotId: sl.slot_id });
    }
    out.hits.push(shelfBoxMatrix(new THREE.Matrix4(), sh, 0, W, 0, D, 0, Math.max(H, 2)));
    out.hitIds.push(sh.shelf_id);
  }
  return out;
}

function fill(mesh: THREE.InstancedMesh | null, mats: THREE.Matrix4[], colors?: THREE.Color[]) {
  if (!mesh) return;
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.count = mats.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

export function Shelves() {
  const layout = useMap((s) => s.layout);
  const dragId = useMap((s) => s.dragId);
  const colorBy = useMap((s) => s.colorBy);
  const hideEmpty = useMap((s) => s.viewOpts.hideEmpty);
  const isolate = useMap((s) => s.viewOpts.isolateZone);
  const unverifiedOnly = useMap((s) => s.unverifiedOnly);
  const onDown = useShelfPointer();
  const invalidate = useThree((s) => s.invalidate);

  const shelves = useMemo(
    () => (layout?.shelves ?? []).filter((s) => s.shelf_id !== dragId && (!isolate || s.zone_id === isolate)),
    [layout, dragId, isolate],
  );
  const built = useMemo(() => {
    const zones = layout?.zones ?? [];
    const zmap = new Map(zones.map((z) => [z.zone_id, { color: zoneColor(zones, z.zone_id), verified: z.verified }]));
    return buildShelfInstances(shelves, {
      colorBy,
      hideEmpty,
      unverifiedOnly,
      zoneOf: (id) => (id && zmap.get(id)) || { color: "#BDBDBD", verified: false },
    });
  }, [shelves, layout?.zones, colorBy, hideEmpty, unverifiedOnly]);

  const postRef = useRef<THREE.InstancedMesh>(null);
  const deckRef = useRef<THREE.InstancedMesh>(null);
  const lipRef = useRef<THREE.InstancedMesh>(null);
  const binRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const caps = {
    posts: capacityFor(built.posts.length),
    decks: capacityFor(built.decks.length),
    lips: capacityFor(built.lips.length),
    bins: capacityFor(built.bins.length),
    hits: capacityFor(built.hits.length),
  };
  useLayoutEffect(() => {
    fill(postRef.current, built.posts);
    fill(deckRef.current, built.decks);
    fill(lipRef.current, built.lips);
    fill(binRef.current, built.bins, built.binColors);
    fill(hitRef.current, built.hits);
    const hit = hitRef.current;
    if (hit) hit.userData.hitIds = built.hitIds;
    const bins = binRef.current;
    if (bins) bins.userData.binRefs = built.binRefs;
    invalidate();
  }, [built, caps.posts, caps.decks, caps.lips, caps.bins, caps.hits, invalidate]);

  const onHitDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return;
    const shelfId = built.hitIds[e.instanceId];
    // Was a bin of this shelf under the pointer too? (bins sit inside the pick box)
    const binHit = e.intersections.find(
      (i) => i.object === binRef.current && i.instanceId != null && built.binRefs[i.instanceId!]?.shelfId === shelfId,
    );
    onDown(e, { shelfId, slotId: binHit ? built.binRefs[binHit.instanceId!].slotId : null });
  };
  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = on ? "pointer" : "";
  };

  return (
    <group name="shelves">
      <instancedMesh
        key={`p${caps.posts}`}
        ref={postRef}
        args={[UNIT_BOX, undefined, caps.posts]}
        name="posts"
        frustumCulled={false}
        raycast={() => null}
      >
        <meshStandardMaterial color={SHELF_STEEL} roughness={0.6} metalness={0.2} />
      </instancedMesh>
      <instancedMesh
        key={`d${caps.decks}`}
        ref={deckRef}
        args={[UNIT_BOX, undefined, caps.decks]}
        name="decks"
        frustumCulled={false}
        raycast={() => null}
      >
        <meshStandardMaterial color={DECK} roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        key={`l${caps.lips}`}
        ref={lipRef}
        args={[UNIT_BOX, undefined, caps.lips]}
        name="front-lips"
        frustumCulled={false}
        raycast={() => null}
      >
        <meshStandardMaterial color="#6B1A2C" roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        key={`b${caps.bins}`}
        ref={binRef}
        args={[UNIT_BOX, undefined, caps.bins]}
        name="bins"
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.75} />
      </instancedMesh>
      <instancedMesh
        key={`h${caps.hits}`}
        ref={hitRef}
        args={[UNIT_BOX, undefined, caps.hits]}
        name="shelf-hits"
        frustumCulled={false}
        onPointerDown={onHitDown}
        onPointerOver={hover(true)}
        onPointerOut={hover(false)}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </instancedMesh>
    </group>
  );
}

/** A single (non-instanced) shelf, used for the drag ghost. */
export function ShelfGhost({ shelf, warn }: { shelf: LayoutShelf; warn: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const mats = useMemo(() => {
    const b = buildShelfInstances([shelf], {
      colorBy: "fill",
      hideEmpty: false,
      unverifiedOnly: false,
      zoneOf: () => ({ color: "#999", verified: true }),
    });
    return [...b.posts, ...b.decks, ...b.lips, ...b.bins];
  }, [shelf]);
  useLayoutEffect(() => {
    fill(ref.current, mats);
    invalidate();
  }, [mats, invalidate]);
  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, undefined, Math.max(1, mats.length)]}
      frustumCulled={false}
      raycast={() => null}
      name="drag-ghost"
    >
      <meshStandardMaterial color={warn ? "#F59E0B" : "#C9A84C"} transparent opacity={0.8} />
    </instancedMesh>
  );
}

export { tmpColor };
