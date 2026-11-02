// Generates the D1 console SQL, its rollback, the shelf table and the overlay data for the
// bottom-half layout traced from Jayce's pencil sketch (2026-11-02).
// Run: node scripts/bottom-half-layout.mjs
//
// RENAMING: edit one line in NAMES below and rerun. Shelf IDs never change with the name.
// After the SQL has run, rename in the map's Inspector instead (no SQL rerun needed).
import { mkdirSync, writeFileSync } from "node:fs";

// ---------------- Names (one line per shelf) ----------------
const NAMES = {
  A1: "A1", // 120 north wall, small unit west of the 121 opening
  B1: "B1", B2: "B2", B3: "B3", B4: "B4", B5: "B5", // 120 north wall
  C1: "C1", C2: "C2", C3: "C3", C4: "C4", C5: "C5", C6: "C6", // 120 south wall
  D1: "D1", D2: "D2", D3: "D3", D4: "D4", // 120 island, north side
  E1: "E1", E2: "E2", E3: "E3", E4: "E4", // 120 island, south side
  F1: "F1", // 120 island, west end cap
  G1: "G1", G2: "G2", G3: "G3", G4: "G4", G5: "G5", G6: "G6", G7: "G7", G8: "G8", G9: "G9", // 121 south wall (G8, G9 in 123)
  H1: "H1", H2: "H2", H3: "H3", H4: "H4", H5: "H5", H6: "H6", H7: "H7", H8: "H8", H9: "H9", // along 122 south wall (H8, H9 in 123)
  J1: "J1", J2: "J2", // 123, east of 122, back to back with H8/H9
  K1: "K1", // 123, beside the east-wall unit
  L1: "L1", // 123, along the east wall
  SALT: "SALT", // salt pallet
  E4H: "E4H", // hanging storage over E4
  C6H: "C6H", // hanging storage over the aisle beside C6 (no shelf below it on the sketch)
};

// ---------------- Fixed IDs ----------------
const ZONE_IDS = { TOOLS: "zon-4zbmay56", PACKOUTS: "zon-edscmkeq" };
const SALT_SLOT_ID = "slt-hrhtdd9f";
const SHELF_IDS = {
  A1: "shf-zarhssgs", B1: "shf-kpb33bdc", B2: "shf-w44rvf79", B3: "shf-g6f3ts2y", B4: "shf-g73jsysr", B5: "shf-3wd9ra3c",
  C1: "shf-6grqk32t", C2: "shf-p8y59sb3", C3: "shf-pezwrw2e", C4: "shf-8cs68ecm", C5: "shf-fx9snavs", C6: "shf-vzbrvbmr",
  D1: "shf-j2hdazen", D2: "shf-hh44pduh", D3: "shf-bxyhncyj", D4: "shf-tpw8qcht",
  E1: "shf-sr6hb86u", E2: "shf-rz5tf279", E3: "shf-6yvsrqv4", E4: "shf-ucpq4ddw", F1: "shf-ssj7pzad",
  G1: "shf-c8rtwvsp", G2: "shf-k9apv9ey", G3: "shf-hg9jrqbw", G4: "shf-wae33vdw", G5: "shf-gbwab54y", G6: "shf-zwfuh796",
  G7: "shf-397rnced", G8: "shf-6ggm3xpw", G9: "shf-fd5hsa7w",
  H1: "shf-reg3b6uv", H2: "shf-t8fgk96d", H3: "shf-hcgq5uyr", H4: "shf-sev7w8bz", H5: "shf-n9r4z5vq", H6: "shf-tqqn988n",
  H7: "shf-sc6fj2x4", H8: "shf-xyrpvcve", H9: "shf-azr3n64x",
  J1: "shf-2gh32dg9", J2: "shf-3z3avbrq", K1: "shf-h723tzrj", L1: "shf-3hxyvexp",
  SALT: "shf-jtrzp46u", E4H: "shf-caackbzb", C6H: "shf-evcrk8xe",
};

// ---------------- Geometry (map inches; traced from the sketch) ----------------
// rot: 0 = front faces south, 90 = west, 180 = north, 270 = east.
// [key, room_no, rot, X0, X1, Y0, Y1, profile, extra note]
const run = (prefix, room, rot, xs, y0, y1, profile = "std", note = "") =>
  xs.slice(0, -1).map((x, i) => [`${prefix}${i + 1}`, room, rot, x, xs[i + 1], y0, y1, profile, note]);
const SHELVES = [
  ["A1", "120", 0, 8, 53.5, 1685, 1701.5, "std", ""],
  ...run("B", "120", 0, [119, 182, 245.5, 310.5, 383, 470], 1685, 1737),
  ...run("C", "120", 180, [8.5, 78, 156, 236, 325, 402.5, 470.5], 1899.5, 1945),
  ...run("D", "120", 180, [166.5, 254.5, 330.5, 411, 470], 1772.5, 1806.5),
  ...run("E", "120", 0, [166.5, 254.5, 330.5, 411, 470], 1806.5, 1851.5),
  ["F1", "120", 90, 131, 166.5, 1772.5, 1851.5, "std", ""],
  ...run("G", "121", 180, [217, 302.5, 386.5, 468.5, 550.5, 633, 720.5, 819.5, 919, 1017.5], 1629, 1681),
  ["H1", "121", 0, 320, 361, 1491, 1504, "std", ""],
  ["H2", "121", 0, 410, 442.5, 1491, 1504, "std", ""],
  ["H3", "121", 90, 451.5, 467.5, 1491, 1532, "std", "Drawn as a boxed S with its long side running north-south; front assumed to face west, confirm."],
  ...run("H", "121", 0, [525, 611, 691, 772.5, 853.5, 938.5, 1016.5], 1491, 1547).map((r, i) => [`H${i + 4}`, ...r.slice(1)]),
  // J is numbered from its east end, nearest door 33 and overhead door 34.
  ["J1", "123", 180, 971.5, 1018, 1439, 1491, "std", ""],
  ["J2", "123", 180, 924, 971.5, 1439, 1491, "std", ""],
  ["K1", "123", 90, 1135.5, 1173.5, 1406.5, 1434, "std", "Facing direction not shown on the sketch; assumed west, confirm."],
  ["L1", "123", 90, 1173.5, 1199, 1205, 1434, "std", "One S on a single long pencil strip along the east wall; may be several units, confirm."],
  ["SALT", "121", 0, 471.5, 525, 1491, 1549.5, "salt", "Salt pallet (dashed outline on the sketch)."],
  ["E4H", "120", 0, 427.5, 470, 1806.5, 1851.5, "hang", "Hanging storage above E4 (hatched on the sketch)."],
  ["C6H", "120", 180, 428, 470, 1851.5, 1899.5, "hang", "Hatched block sits over the aisle between E4 and C6, not over a traced shelf: needs confirmation."],
];
// Zones from room_no (production IDs are looked up, not assumed).
const ZONE_OF = (shelfZoneHint, key) => {
  // Shelves east of X 862.5 sit in FABRICATION 123 even when their run starts in 121.
  if (["G8", "G9", "H8", "H9"].includes(key)) return "123";
  return shelfZoneHint;
};

const AREAS = [
  { key: "TOOLS", name: "TOOLS", kind: "tools", poly: [[1018, 1436], [1201, 1436], [1201, 1683], [1018, 1683]],
    notes: "Clickable floor area inside FABRICATION 123. Traced from a sketch, UNVERIFIED." },
  { key: "PACKOUTS", name: "PACKOUTS", kind: "packouts", poly: [[0, 1467], [61, 1467], [61, 1648], [0, 1648]],
    notes: "Clickable floor area inside STORAGE - PARTS & TOOLS 121. Traced from a sketch, UNVERIFIED." },
];

// Wall corrections from white tape / pencil fill on the sketch (originals as seeded by 0003).
const OPENING_EDITS = [
  { id: "opn-gqgjbhh4", tag: "121-120",
    from: { x1_in: 381.5, y1_in: 1683, x2_in: 421.5, y2_in: 1683, notes: "About 3'-4\" between 121 and 120. Position UNVERIFIED" },
    to: { x1_in: 60.5, y1_in: 1683, x2_in: 111.5, y2_in: 1683,
      notes: "Moved to the west end: on the sketch the printed opening (X 381.5-421.5) is filled in and the wall at X 60.5-111.5 is taped out. Position UNVERIFIED" } },
  { id: "opn-zh5zkdtw", tag: "8'",
    from: { x1_in: 218.5, y1_in: 1443, x2_in: 314.5, y2_in: 1443, notes: "Printed 8' at the stub wall" },
    to: { x1_in: 110.5, y1_in: 1443, x2_in: 279, y2_in: 1443,
      notes: "Widened from the sketch: the stub wall is taped out from X 110.5, and a short wall is drawn at X 279-314.5 against 122. Printed 8' at the stub wall. Position UNVERIFIED" } },
];

// ---------------- derived ----------------
const NOTE = "traced from sketch, dimensions unverified";
const r16 = (x) => Math.round(x * 16) / 16;
function evenRows(count, height, ground = 4) {
  const spacing = Math.max(1, Math.floor((height - ground + 1) / count));
  return Array.from({ length: count }, (_, i) => {
    const e = ground + i * spacing;
    const clear = i < count - 1 ? spacing - 1 : Math.max(1, height - e);
    return { row_index: i, row_label: i === 0 ? "G" : String(i), elevation_in: r16(e), clear_height_in: r16(clear) };
  });
}
const PROFILES = {
  std: { kind: "shelving", height: 84, rows: evenRows(5, 84) },
  salt: { kind: "floor_area", height: 48, rows: [{ row_index: 0, row_label: "G", elevation_in: 0, clear_height_in: 48 }] },
  // Placeholder elevation: lowest row at 72 in, two rows, labelled 1 and 2.
  hang: { kind: "shelving", height: 96, rows: [
    { row_index: 0, row_label: "1", elevation_in: 72, clear_height_in: 11 },
    { row_index: 1, row_label: "2", elevation_in: 84, clear_height_in: 12 },
  ] },
};
function placement(rot, X0, X1, Y0, Y1) {
  const alongX = rot === 0 || rot === 180;
  const width = alongX ? X1 - X0 : Y1 - Y0;
  const depth = alongX ? Y1 - Y0 : X1 - X0;
  const corner = { 0: [X0, Y1], 180: [X1, Y0], 90: [X0, Y0], 270: [X1, Y1] }[rot];
  return { x_in: corner[0], y_in: corner[1], width_in: width, depth_in: depth };
}
export const shelves = SHELVES.map(([key, room, rot, X0, X1, Y0, Y1, profile, extra]) => {
  const p = PROFILES[profile];
  const g = placement(rot, X0, X1, Y0, Y1);
  const notes = [NOTE, profile === "hang" ? "placeholder elevation, measure" : "", extra].filter(Boolean).join(". ");
  return {
    key, shelf_id: SHELF_IDS[key], name: NAMES[key], room_no: ZONE_OF(room, key), kind: p.kind,
    rotation_deg: rot, ...g, height_in: p.height, cols: Math.max(1, Math.round(g.width_in / 4)), rows: p.rows,
    notes, bbox: [X0, X1, Y0, Y1],
  };
});

const ID_RE = { zon: /^zon-[2-9a-hj-km-np-z]{8}$/, shf: /^shf-[2-9a-hj-km-np-z]{8}$/, slt: /^slt-[2-9a-hj-km-np-z]{8}$/ };
for (const s of shelves) if (!ID_RE.shf.test(s.shelf_id)) throw new Error(`bad id ${s.shelf_id}`);
for (const id of Object.values(ZONE_IDS)) if (!ID_RE.zon.test(id)) throw new Error(`bad id ${id}`);
if (!ID_RE.slt.test(SALT_SLOT_ID)) throw new Error("bad slot id");
if (new Set(shelves.map((s) => s.name.toLowerCase())).size !== shelves.length) throw new Error("duplicate names");
if (shelves.some((s) => /-/.test(s.name))) throw new Error("names must not contain hyphens");
if (new Set(Object.values(SHELF_IDS)).size !== Object.keys(SHELF_IDS).length) throw new Error("duplicate ids");

// ---------------- SQL ----------------
const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const BUMP = "UPDATE warehouse_meta SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1;";
const zoneLookup = (room) => `(SELECT zone_id FROM zones WHERE room_no=${q(room)} AND active=1 AND area_kind IS NULL)`;
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const nameTable = shelves.map((s) => `--   ${s.name.padEnd(5)} ${s.shelf_id}  zone ${s.room_no}  ${s.kind}${s.key !== s.name ? `  (sketch key ${s.key})` : ""}`).join("\n");
const header = (title) => `-- ${title}
-- Generated by scripts/bottom-half-layout.mjs. To rename, edit NAMES at the top of that script and rerun,
-- or rename in the map's Inspector after running (no SQL rerun needed).
-- Paste ONE batch at a time into the Cloudflare D1 console. Plain SQL, no transactions.
-- Every geometry value below was traced from a photo of a pencil sketch and is UNVERIFIED (about +/- 4 in).
--
-- Shelves (name, id, zone, kind):
${nameTable}
`;

const batches = [];
batches.push({ title: "0. Read-only pre-checks (change nothing)", changes: false, sql: [
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
  "PRAGMA table_info(zones); -- before batch 1 there is no area_kind column; after it there is",
  "PRAGMA table_info(shelves); -- must list location_type (migration 0004)",
  "SELECT zone_id, name, room_no, version, active FROM zones WHERE room_no IN ('120','121','122','123') ORDER BY room_no; -- expect exactly one active row per room",
  "SELECT count(*) AS active_shelves FROM shelves WHERE active=1; -- expect 0 real shelves",
  `SELECT s.shelf_id, s.name FROM shelves s WHERE s.active=1 AND lower(s.name) IN (${shelves.map((s) => q(s.name.toLowerCase())).join(",")}); -- expect no rows`,
  `SELECT shelf_id FROM shelves WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")}) UNION ALL SELECT zone_id FROM zones WHERE zone_id IN (${Object.values(ZONE_IDS).map(q).join(",")}) UNION ALL SELECT slot_id FROM slots WHERE slot_id=${q(SALT_SLOT_ID)}; -- expect no rows (or all rows on a rerun)`,
  `SELECT opening_id, tag, x1_in, y1_in, x2_in, y2_in, version, notes FROM openings WHERE opening_id IN (${OPENING_EDITS.map((o) => q(o.id)).join(",")}); -- expect version 1 and the original X values in the rollback file`,
  "SELECT revision, updated_at FROM warehouse_meta WHERE id=1;",
] });
batches.push({ title: "1. Schema: add zones.area_kind (same as migrations/0005_zone_area_kind.sql). Run once; a rerun fails with 'duplicate column name', which is harmless.", changes: false, sql: [
  "ALTER TABLE zones ADD COLUMN area_kind TEXT CHECK(area_kind IN ('tools','packouts'));",
] });
batches.push({ title: "2. Wall corrections (openings). Each UPDATE only matches the original row at version 1, so a rerun changes nothing.", changes: true, sql: [
  ...OPENING_EDITS.map((o) =>
    `UPDATE openings SET x1_in=${q(o.to.x1_in)}, y1_in=${q(o.to.y1_in)}, x2_in=${q(o.to.x2_in)}, y2_in=${q(o.to.y2_in)}, notes=${q(o.to.notes)}, version=version+1 WHERE opening_id=${q(o.id)} AND version=1 AND x1_in=${q(o.from.x1_in)} AND x2_in=${q(o.from.x2_in)} AND active=1;`),
  BUMP,
] });
batches.push({ title: "3. Tools and Packouts floor areas (every edge open, so no walls).", changes: true, sql: [
  ...AREAS.map((a) =>
    `INSERT INTO zones (zone_id,name,room_no,polygon_in,open_edges,wall_height_in,notes,verified,version,active,area_kind) SELECT ${q(ZONE_IDS[a.key])},${q(a.name)},NULL,${q(JSON.stringify(a.poly))},${q(JSON.stringify(a.poly.map((_, i) => i)))},NULL,${q(a.notes)},0,1,1,${q(a.kind)} WHERE NOT EXISTS (SELECT 1 FROM zones WHERE zone_id=${q(ZONE_IDS[a.key])});`),
  BUMP,
] });
const shelfSql = shelves.map((s) =>
  `INSERT INTO shelves (shelf_id,name,zone_id,kind,x_in,y_in,rotation_deg,width_in,depth_in,height_in,cols,wall_ref,notes,version,active,location_type) SELECT ${q(s.shelf_id)},${q(s.name)},${zoneLookup(s.room_no)},${q(s.kind)},${s.x_in},${s.y_in},${s.rotation_deg},${s.width_in},${s.depth_in},${s.height_in},${s.cols},NULL,${q(s.notes)},1,1,'primary' WHERE NOT EXISTS (SELECT 1 FROM shelves WHERE shelf_id=${q(s.shelf_id)});`);
chunks(shelfSql, 14).forEach((sql, i, all) =>
  batches.push({ title: `4${String.fromCharCode(97 + i)}. Shelves, part ${i + 1} of ${all.length}`, changes: true, sql: [...sql, BUMP] }));
const rowSql = shelves.map((s) =>
  `INSERT OR IGNORE INTO shelf_rows (shelf_id,row_index,row_label,elevation_in,clear_height_in) VALUES ${s.rows.map((r) => `(${q(s.shelf_id)},${r.row_index},${q(r.row_label)},${r.elevation_in},${r.clear_height_in})`).join(",")};`);
chunks(rowSql, 14).forEach((sql, i, all) =>
  batches.push({ title: `5${String.fromCharCode(97 + i)}. Shelf rows, part ${i + 1} of ${all.length}`, changes: true, sql: [...sql, BUMP] }));
const salt = shelves.find((s) => s.key === "SALT");
batches.push({ title: "6. The salt slot: one slot spanning every column of SALT. No part or stock (create the part in the app).", changes: true, sql: [
  `INSERT OR IGNORE INTO slots (slot_id,shelf_id,slot_no,row_index,col_start,width_span,height_span,bin_type,bin_width_in,bin_height_in,bin_depth_in,bin_color,version,active) VALUES (${q(SALT_SLOT_ID)},${q(salt.shelf_id)},1,0,1,${salt.cols},1,NULL,NULL,NULL,NULL,NULL,1,1);`,
  BUMP,
] });
batches.push({ title: "7. Final revision bump, then the checks below (read-only).", changes: true, sql: [
  BUMP,
  `SELECT count(*) AS new_shelves FROM shelves WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")}); -- expect ${shelves.length}`,
  `SELECT count(*) AS new_rows FROM shelf_rows WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")}); -- expect ${shelves.reduce((n, s) => n + s.rows.length, 0)}`,
  "PRAGMA foreign_key_check;",
] });
for (const b of batches) if (b.sql.length > 15) throw new Error(`batch ${b.title} has ${b.sql.length} statements`);

const forward = [header("2026-11-02 bottom-half layout: shelves, salt pallet, hanging storage, Tools/Packouts areas, wall corrections"),
  "-- Order: batch 0, then 1, then 2 ... 7. Run batch 1 BEFORE deploying the code from this PR",
  "-- (the new code's health check expects zones.area_kind). Each later batch is safe to paste on its own,",
  "-- parents before children, and ends with the layout revision bump the map needs to show changes.",
  "-- These rows are written without events, so the app's Undo cannot remove them: use the rollback file.",
  "",
  ...batches.map((b) => `-- ===== Batch ${b.title} (${b.sql.length} statement${b.sql.length === 1 ? "" : "s"}) =====\n${b.sql.join("\n")}\n`),
].join("\n");

const rb = [];
rb.push({ title: "R0. Read-only: what will be removed. Stop if any bin, part or kit uses these shelves except the salt slot", sql: [
  `SELECT slot_id, shelf_id FROM slots WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")}) AND slot_id<>${q(SALT_SLOT_ID)}; -- expect no rows`,
  `SELECT part_id, slot_id FROM stock WHERE slot_id IN (SELECT slot_id FROM slots WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")})); -- expect no rows`,
  `SELECT kit_id FROM packouts WHERE slot_id IN (SELECT slot_id FROM slots WHERE shelf_id IN (${shelves.map((s) => q(s.shelf_id)).join(",")})); -- expect no rows`,
] });
rb.push({ title: "R1. Remove the salt slot, shelf rows and shelves this change created", sql: [
  `DELETE FROM slots WHERE slot_id=${q(SALT_SLOT_ID)};`,
  ...chunks(shelves, 25).map((c) => `DELETE FROM shelf_rows WHERE shelf_id IN (${c.map((s) => q(s.shelf_id)).join(",")});`),
  ...chunks(shelves, 25).map((c) => `DELETE FROM shelves WHERE shelf_id IN (${c.map((s) => q(s.shelf_id)).join(",")});`),
  BUMP,
] });
rb.push({ title: "R2. Remove the Tools and Packouts areas", sql: [
  `DELETE FROM zones WHERE zone_id IN (${Object.values(ZONE_IDS).map(q).join(",")});`,
  BUMP,
] });
const origLines = OPENING_EDITS.map((o) => `--   ${o.id} (tag ${o.tag}): x1 ${o.from.x1_in}, y1 ${o.from.y1_in}, x2 ${o.from.x2_in}, y2 ${o.from.y2_in}, notes "${o.from.notes}"`).join("\n");
rb.push({ title: "R3. Restore the two openings to their original values (only if they still hold this change's values)", pre: `-- Original values (from migrations/0003_unverified_building.sql, version 1):\n${origLines}`, sql: [
  ...OPENING_EDITS.map((o) =>
    `UPDATE openings SET x1_in=${q(o.from.x1_in)}, y1_in=${q(o.from.y1_in)}, x2_in=${q(o.from.x2_in)}, y2_in=${q(o.from.y2_in)}, notes=${q(o.from.notes)}, version=version+1 WHERE opening_id=${q(o.id)} AND x1_in=${q(o.to.x1_in)} AND x2_in=${q(o.to.x2_in)} AND notes=${q(o.to.notes)};`),
  BUMP,
] });
const rollback = [header("ROLLBACK for 2026-11-02 bottom-half layout"),
  "-- Removes exactly the rows the forward SQL created and restores the edited openings. Run R0 first.",
  "-- If bins, parts or kits were added on these shelves in the app, delete those in the app first",
  "-- (the D1 foreign keys will refuse the DELETEs otherwise, which is the safe outcome).",
  "",
  ...rb.map((b) => `-- ===== ${b.title} (${b.sql.length} statement${b.sql.length === 1 ? "" : "s"}) =====\n${b.pre ? b.pre + "\n" : ""}${b.sql.join("\n")}\n`),
  "-- Not part of the rollback: the zones.area_kind column stays. The app code from this PR needs it",
  "-- (its health check looks for it), and it is harmless to older code. Only if the code is reverted too",
  "-- and you want the old schema back: ALTER TABLE zones DROP COLUMN area_kind;",
  "",
].join("\n");

// ---------------- shelf table + overlay data ----------------
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const ZN = { "120": "STORAGE - FILTERS 120", "121": "STORAGE - PARTS & TOOLS 121", "123": "FABRICATION 123" };
const table = [
  "# Bottom-half shelves traced from the sketch (2026-11-02)",
  "",
  "Generated by `scripts/bottom-half-layout.mjs`. Map inches: origin at the north-west corner of WAREHOUSE 126, X east, Y south. `x`, `y` is the front-left corner seen standing in the aisle facing the shelf. Rotation: 0 = front faces south, 90 = west, 180 = north, 270 = east.",
  "",
  "**Every value is traced from a photo of a pencil sketch and is unverified (about ±4 in).** Rename by editing one line in `NAMES` in the script, or in the map's Inspector after the SQL has run.",
  "",
  "| Name | Zone | Kind | x | y | Rotation | Width | Depth | Height | Cols | Rows | Notes |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...shelves.map((s) => `| ${s.name} | ${ZN[s.room_no]} | ${s.kind} | ${fmt(s.x_in)} | ${fmt(s.y_in)} | ${s.rotation_deg} | ${fmt(s.width_in)} | ${fmt(s.depth_in)} | ${s.height_in} | ${s.cols} | ${s.rows.map((r) => `${r.row_label}@${r.elevation_in}`).join(" ")} | ${s.notes.replace(NOTE, "").replace(/^\.\s*/, "") || ""} |`),
  "",
  "Areas (zones with every edge open, `area_kind` set):",
  "",
  "| Name | area_kind | Polygon |",
  "| --- | --- | --- |",
  ...AREAS.map((a) => `| ${a.name} | ${a.kind} | ${JSON.stringify(a.poly)} |`),
  "",
].join("\n");

mkdirSync("docs/console-sql", { recursive: true });
mkdirSync("docs/overlays", { recursive: true });
writeFileSync("docs/console-sql/2026-11-02-bottom-half-layout.sql", forward);
writeFileSync("docs/console-sql/2026-11-02-bottom-half-layout-rollback.sql", rollback);
writeFileSync("docs/bottom-half-shelves.md", table);
writeFileSync("docs/overlays/bottom-half-layout.json", JSON.stringify({ shelves, areas: AREAS, openings: OPENING_EDITS, saltSlot: SALT_SLOT_ID, zoneIds: ZONE_IDS }, null, 1) + "\n");
console.log(`${shelves.length} shelves, ${batches.length} forward batches, ${rb.length} rollback batches`);
