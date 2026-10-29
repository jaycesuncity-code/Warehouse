// Pointer handling for shelves in the viewport: click = select, drag (edit mode) = move with
// snapping, saved once on release (one PATCH with version).

import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useCallback } from "react";
import { placementFromCenter, shelfCenter } from "../../shared/units";
import { assignPart, moveShelfTo, select, snapShelf } from "../actions";
import { editing, getMap, setMap, shelfById } from "../store";
import { floorPointAt } from "./common";

type Controls = { enabled: boolean } | null;

export interface PickInfo {
  shelfId: string;
  /** Slot under the pointer, if a bin was hit. */
  slotId?: string | null;
}

/** Shared by all shelf meshes. */
export function useShelfPointer() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as Controls;

  const click = useCallback((info: PickInfo) => {
    const s = getMap();
    if (s.view === "walk") return;
    const sh = shelfById(s, info.shelfId);
    if (!sh) return;
    if (s.tool?.kind === "move-part" && info.slotId) {
      const t = s.tool;
      setMap({ tool: null });
      void assignPart({ part_id: t.part_id, part_name: t.part_name }, info.slotId, { from_slot_id: t.from_slot_id });
      return;
    }
    const sel = s.selection;
    const sameShelf =
      sel &&
      ((sel.kind === "shelf" && sel.id === info.shelfId) || (sel.kind === "slot" && sel.shelfId === info.shelfId));
    if (sameShelf && info.slotId) select({ kind: "slot", shelfId: info.shelfId, id: info.slotId }, { front: true });
    else select({ kind: "shelf", id: info.shelfId }, { front: true });
  }, []);

  return useCallback(
    (e: ThreeEvent<PointerEvent>, info: PickInfo) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const s = getMap();
      const sh = shelfById(s, info.shelfId);
      if (!sh) return;
      const startX = e.nativeEvent.clientX;
      const startY = e.nativeEvent.clientY;
      const canDrag = editing(s) && s.view !== "walk" && !info.shelfId.startsWith("tmp-") && !s.tool;
      const grab = floorPointAt(camera, gl.domElement, startX, startY);
      const c0 = shelfCenter(sh);
      const offset = grab ? { x: grab.x - c0.x, y: grab.y - c0.y } : { x: 0, y: 0 };
      let dragging = false;
      let last: { x_in: number; y_in: number } | null = null;
      const dom = gl.domElement;
      const pid = e.nativeEvent.pointerId;
      try {
        dom.setPointerCapture(pid);
      } catch {
        /* synthetic events */
      }
      const move = (ev: PointerEvent) => {
        if (!canDrag) return;
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        if (!dragging) {
          dragging = true;
          if (controls) controls.enabled = false;
          setMap({ dragId: sh.shelf_id, selection: { kind: "shelf", id: sh.shelf_id } });
        }
        const p = floorPointAt(camera, dom, ev.clientX, ev.clientY);
        if (!p) return;
        const cur = shelfById(getMap(), sh.shelf_id) ?? sh;
        const pl = placementFromCenter(p.x - offset.x, p.y - offset.y, cur.rotation_deg, cur.width_in, cur.depth_in);
        const snapped = snapShelf(
          { ...pl, rotation_deg: cur.rotation_deg, width_in: cur.width_in, depth_in: cur.depth_in },
          cur.shelf_id,
        );
        last = { x_in: snapped.x_in, y_in: snapped.y_in };
        setMap((st) => ({ drafts: { ...st.drafts, [cur.shelf_id]: last! } }));
      };
      const up = () => {
        dom.removeEventListener("pointermove", move);
        dom.removeEventListener("pointerup", up);
        dom.removeEventListener("pointercancel", up);
        try {
          dom.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        if (controls) controls.enabled = true;
        if (dragging) {
          const id = sh.shelf_id;
          const draft = last;
          setMap((st) => {
            const drafts = { ...st.drafts };
            delete drafts[id];
            return { drafts, dragId: null };
          });
          const cur = shelfById(getMap(), id);
          if (draft && cur && (draft.x_in !== cur.x_in || draft.y_in !== cur.y_in))
            void moveShelfTo(id, draft.x_in, draft.y_in);
        } else click(info);
      };
      dom.addEventListener("pointermove", move);
      dom.addEventListener("pointerup", up);
      dom.addEventListener("pointercancel", up);
    },
    [camera, gl, controls, click],
  );
}
