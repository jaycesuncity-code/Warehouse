import { beforeEach, describe, expect, it } from "vitest";
import type { Layout, Shelf } from "../shared/contract";
import { handleSync, resetDemoData } from "../shared/mock";
import { learnDepartments, removeShelf, removeSlot, slotSummary, toLayoutShelf, upsertShelf } from "./layoutOps";

const get = (path: string) => handleSync({ method: "GET", path }).body as never;

beforeEach(() => resetDemoData());

describe("patching the local layout matches a fresh GET /api/layout", () => {
  it("a full shelf converts to the same summary the layout endpoint returns", () => {
    const layout = get("/layout") as Layout;
    const deptOf = learnDepartments(layout);
    for (const ls of layout.shelves) {
      const full = get(`/shelves/${ls.shelf_id}`) as Shelf;
      const conv = toLayoutShelf(full as never, ls, (id) => deptOf[id]);
      expect(conv).toEqual(ls);
    }
  });
  it("upsert replaces a temporary shelf by id and remove drops it", () => {
    const layout = get("/layout") as Layout;
    const tmp = { ...layout.shelves[0], shelf_id: "tmp-1", name: "New" };
    const withTmp = upsertShelf(layout, tmp);
    expect(withTmp.shelves.length).toBe(layout.shelves.length + 1);
    const swapped = upsertShelf(withTmp, { ...tmp, shelf_id: "shf-real0000" }, "tmp-1");
    expect(swapped.shelves.some((s) => s.shelf_id === "tmp-1")).toBe(false);
    expect(removeShelf(swapped, "shf-real0000").shelves.length).toBe(layout.shelves.length);
  });
  it("slot summary: low when on hand < par; departments kept from the previous copy", () => {
    const s = {
      slot_id: "slt-x",
      slot_no: 1,
      location_code: "A1-G-1",
      row_index: 0,
      col_start: 1,
      width_span: 1,
      height_span: 1,
      bin_type: "bin" as const,
      bin_width_in: null,
      bin_height_in: null,
      bin_depth_in: null,
      bin_color: null,
      version: 1,
    };
    const sum = slotSummary(
      { ...s, parts: [{ part_id: "p", part_name: "P", part_code: "P", on_hand_qty: 2, par_qty: 5 }] } as never,
      {
        ...s,
        part_count: 1,
        on_hand_total: 9,
        par_total: 5,
        low: false,
        part_ids: ["p"],
        departments: ["HVAC Service"],
      },
    );
    expect(sum).toMatchObject({
      part_count: 1,
      on_hand_total: 2,
      par_total: 5,
      low: true,
      departments: ["HVAC Service"],
    });
    const layout = get("/layout") as Layout;
    const sh = layout.shelves[0];
    expect(removeSlot(layout, sh.shelf_id, sh.slots[0].slot_id).shelves[0].slots.length).toBe(sh.slots.length - 1);
  });
});

describe("mock: PATCH /api/locations (par edit, added by the map)", () => {
  it("needs the location version and records an undoable event", () => {
    const part = get("/parts/prt-k7m2qx9d") as { locations: { slot_id: string; version: number; par_qty: number }[] };
    const loc = part.locations[0];
    const bad = handleSync({
      method: "PATCH",
      path: "/locations",
      body: { part_id: "prt-k7m2qx9d", slot_id: loc.slot_id, par_qty: 120, version: loc.version + 5 },
    });
    expect(bad.status).toBe(409);
    expect((bad.body as { error: string }).error).toBe("version_conflict");
    const ok = handleSync({
      method: "PATCH",
      path: "/locations",
      body: { part_id: "prt-k7m2qx9d", slot_id: loc.slot_id, par_qty: 120, version: loc.version },
    });
    expect(ok.status).toBe(200);
    const body = ok.body as { event_id: string; part: { locations: { slot_id: string; par_qty: number }[] } };
    expect(body.part.locations.find((l) => l.slot_id === loc.slot_id)!.par_qty).toBe(120);
    const undo = handleSync({ method: "POST", path: `/events/${body.event_id}/undo` });
    expect(undo.status).toBe(200);
    const after = get("/parts/prt-k7m2qx9d") as typeof part;
    expect(after.locations.find((l) => l.slot_id === loc.slot_id)!.par_qty).toBe(loc.par_qty);
  });
  it("refuses negative par and viewers", () => {
    const part = get("/parts/prt-k7m2qx9d") as { locations: { slot_id: string; version: number }[] };
    const loc = part.locations[0];
    expect(
      handleSync({
        method: "PATCH",
        path: "/locations",
        body: { part_id: "prt-k7m2qx9d", slot_id: loc.slot_id, par_qty: -1, version: loc.version },
      }).status,
    ).toBe(400);
  });
});

describe("mock: redo = undoing the undo event", () => {
  it("move a shelf, undo, redo", () => {
    const layout = get("/layout") as Layout;
    const sh = layout.shelves[0];
    const mv = handleSync({
      method: "PATCH",
      path: `/shelves/${sh.shelf_id}`,
      body: { x_in: sh.x_in + 10, version: sh.version },
    }).body as { event_id: string };
    const u = handleSync({ method: "POST", path: `/events/${mv.event_id}/undo` }).body as { event_id: string };
    expect((get(`/shelves/${sh.shelf_id}`) as Shelf).x_in).toBe(sh.x_in);
    const r = handleSync({ method: "POST", path: `/events/${u.event_id}/undo` });
    expect(r.status).toBe(200);
    expect((get(`/shelves/${sh.shelf_id}`) as Shelf).x_in).toBe(sh.x_in + 10);
  });
});
