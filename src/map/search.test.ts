import { describe, expect, it } from "vitest";
import { groupResults, searchFocus, type SearchItemLike } from "./search";

const part = (id: string, locs: [string, string][]): SearchItemLike => ({
  part_id: id,
  part_name: `Part ${id}`,
  part_code: id.toUpperCase(),
  locations: locs.map(([shelf_id, slot_id]) => ({ shelf_id, slot_id, location_code: `${shelf_id}-G-${slot_id}` })),
});

describe("search -> zoom level (many shelves -> one shelf -> one slot -> none)", () => {
  const live = new Set(["A1", "B1"]);
  it("empty query = idle (zoom back out)", () =>
    expect(searchFocus("  ", [part("p", [["A1", "1"]])], live).level).toBe("idle"));
  it("matches on several shelves = floor, with a dot per shelf", () => {
    const f = searchFocus("elbow", [part("p", [["A1", "1"]]), part("q", [["B1", "2"]])], live);
    expect(f.level).toBe("floor");
    expect(f.shelfIds.sort()).toEqual(["A1", "B1"]);
    expect(f.partId).toBeNull();
  });
  it("all matches on one shelf = shelf (open its front view)", () => {
    const f = searchFocus("copper", [part("p", [["A1", "1"]]), part("q", [["A1", "2"]])], live);
    expect(f).toMatchObject({ level: "shelf", shelfIds: ["A1"] });
    expect(f.slotIds.sort()).toEqual(["1", "2"]);
  });
  it("one part in two slots on one shelf = shelf, and opens the part card", () => {
    expect(
      searchFocus(
        "x",
        [
          part("p", [
            ["A1", "1"],
            ["A1", "3"],
          ]),
        ],
        live,
      ),
    ).toMatchObject({ level: "shelf", partId: "p" });
  });
  it("one match in one slot = slot", () => {
    expect(searchFocus("cu-34-90", [part("p", [["A1", "4"]])], live)).toMatchObject({
      level: "slot",
      slotIds: ["4"],
      partId: "p",
    });
  });
  it("two parts sharing one slot = slot (no single part card)", () => {
    expect(searchFocus("x", [part("p", [["A1", "4"]]), part("q", [["A1", "4"]])], live)).toMatchObject({
      level: "slot",
      partId: null,
    });
  });
  it("no results = none", () => expect(searchFocus("zzz", [], live).level).toBe("none"));
  it("results with no location on the map = unplaced", () => {
    expect(searchFocus("x", [part("p", [])], live).level).toBe("unplaced");
    expect(searchFocus("x", [part("p", [["GONE", "9"]])], live).level).toBe("unplaced");
  });
  it("narrowing step by step", () => {
    const all = [part("a", [["A1", "1"]]), part("b", [["A1", "2"]]), part("c", [["B1", "5"]])];
    expect(searchFocus("p", all, live).level).toBe("floor");
    expect(searchFocus("pa", all.slice(0, 2), live).level).toBe("shelf");
    expect(searchFocus("pa a", all.slice(0, 1), live).level).toBe("slot");
    expect(searchFocus("pa aq", [], live).level).toBe("none");
  });
});

describe("result list grouping", () => {
  it("groups by zone, then shelf; unplaced parts listed separately", () => {
    const info = new Map([
      ["A1", { name: "A1", zoneName: "WAREHOUSE 126" }],
      ["A2", { name: "A2", zoneName: "WAREHOUSE 126" }],
      ["F1", { name: "F1", zoneName: "STORAGE - FILTERS 120" }],
    ]);
    const { groups, unplaced } = groupResults(
      [
        part("p", [
          ["A2", "1"],
          ["F1", "2"],
        ]),
        part("q", [["A1", "3"]]),
        part("r", []),
      ],
      info,
    );
    expect(groups.map((g) => g.zoneName)).toEqual(["STORAGE - FILTERS 120", "WAREHOUSE 126"]);
    expect(groups[1].shelves.map((s) => s.shelfName)).toEqual(["A1", "A2"]);
    expect(unplaced.map((u) => u.part_id)).toEqual(["r"]);
  });
});
