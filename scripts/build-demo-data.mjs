// Regenerates src/shared/mock/demo-data.ts (plain data, fixed IDs) from the definitions below.
// Run: node scripts/build-demo-data.mjs
// Workstream A generates seed/demo.sql from the resulting file, so keep the output plain data.
import { writeFileSync } from "node:fs";

const ALPHA = "23456789abcdefghjkmnpqrstuvwxyz";
let seed = 0x5c17c1;
function rand() {
  // mulberry32 — deterministic so the IDs never change between runs
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const used = new Set();
function id(prefix) {
  for (;;) {
    let s = "";
    for (let i = 0; i < 8; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
    const full = `${prefix}-${s}`;
    if (!used.has(full)) {
      used.add(full);
      return full;
    }
  }
}

// ---------------- Zones (contract §9) ----------------
const zoneDefs = [
  ["WAREHOUSE 126", "126", [[0, 0], [483, 0], [483, 1203], [0, 1203]], [], "No high-pile storage allowed"],
  ["STORAGE 125", "125", [[483, 958], [637, 958], [637, 1203], [483, 1203]], [], "Plan callout says 12'-11 1/2\" wide; chain says 12'-10\" (UNVERIFIED)"],
  ["ROOM (NO LABEL)", "", [[483, 775], [637, 775], [637, 958], [483, 958]], [], "Reached by door 40. Name UNVERIFIED"],
  ["FABRICATION 124", "124", [[637, 775], [997, 775], [997, 1203], [637, 1203]], [2], "South side open to 123"],
  ["LOADING DOCK", "DOCK", [[997, 775], [1201, 775], [1201, 1203], [997, 1203]], [0, 1], "Exterior. Open sides UNVERIFIED"],
  ["FABRICATION 123", "123", [[0, 1443], [314.5, 1443], [314.5, 1397], [862.5, 1397], [862.5, 1489], [862.5, 1683], [1201, 1683], [1201, 1203], [997, 1203], [637, 1203], [0, 1203]], [4, 8], "One open floor shared with 121. Edge 0 is a stub wall with an 8' opening"],
  ["STORAGE 122", "122", [[314.5, 1397], [862.5, 1397], [862.5, 1489], [314.5, 1489]], [], "Walled enclosure inside 123"],
  ["STORAGE - PARTS & TOOLS 121", "121", [[0, 1683], [862.5, 1683], [862.5, 1489], [314.5, 1489], [314.5, 1443], [0, 1443]], [1], "L-shape. East side and stub-wall position UNVERIFIED"],
  ["STORAGE - FILTERS 120", "120", [[0, 1683], [479.5, 1683], [479.5, 1947], [0, 1947]], [], ""],
];
const zones = zoneDefs.map(([name, room_no, polygon_in, open_edges, notes]) => ({
  zone_id: id("zon"), name, room_no, polygon_in, open_edges, wall_height_in: null, notes, verified: false, version: 1,
  area_kind: null,
}));
const zoneByRoom = Object.fromEntries(zones.map((z) => [z.room_no || "NOLABEL", z]));
// Clickable floor areas (no walls). Fixed IDs, minted outside id() so the generated sequence is unchanged.
zones.push(
  { zone_id: "zon-4zbmay56", name: "TOOLS", room_no: null, polygon_in: [[1018, 1436], [1201, 1436], [1201, 1683], [1018, 1683]],
    open_edges: [0, 1, 2, 3], wall_height_in: null, notes: "Clickable floor area inside FABRICATION 123. Traced from a sketch, UNVERIFIED.",
    verified: false, version: 1, area_kind: "tools" },
  { zone_id: "zon-edscmkeq", name: "PACKOUTS", room_no: null, polygon_in: [[0, 1467], [61, 1467], [61, 1648], [0, 1648]],
    open_edges: [0, 1, 2, 3], wall_height_in: null, notes: "Clickable floor area inside STORAGE - PARTS & TOOLS 121. Traced from a sketch, UNVERIFIED.",
    verified: false, version: 1, area_kind: "packouts" },
);

// ---------------- Openings (contract §9) ----------------
const W = zoneByRoom["126"].zone_id;
const openingDefs = [
  ["overhead", "37", 0, 121.5, 0, 289.5, W, "Position from printed chain"],
  ["overhead", "38", 483, 121.5, 483, 289.5, W, "Position from printed chain"],
  ["overhead", "36", 0, 529.5, 0, 697.5, W, "Position from printed chain"],
  ["overhead", "39", 483, 529.5, 483, 697.5, W, "Position from printed chain"],
  ["overhead", "34", 1027, 1203, 1147, 1203, zoneByRoom["DOCK"].zone_id, "10' door. Position from drawing (UNVERIFIED)"],
  ["door", "40", 483, 858, 483, 898, zoneByRoom["NOLABEL"].zone_id, "UNVERIFIED (±2\")"],
  ["door", "33", 1112.5, 1683, 1151, 1683, zoneByRoom["123"].zone_id, "UNVERIFIED (±2\")"],
  ["door", "31", 366.5, 1397, 402.5, 1397, zoneByRoom["122"].zone_id, "UNVERIFIED (±2\")"],
  ["door", "32", 774.5, 1397, 810.5, 1397, zoneByRoom["122"].zone_id, "UNVERIFIED (±2\")"],
  ["opening", "7'", 483, 1088.5, 483, 1172.5, zoneByRoom["125"].zone_id, "UNVERIFIED (±2\")"],
  ["opening", "dashed wall", 637, 1087, 637, 1170.5, zoneByRoom["124"].zone_id, "Dashed section of the 124 west wall. UNVERIFIED"],
  ["opening", "12'", 39, 1203, 183.5, 1203, W, "UNVERIFIED (±2\")"],
  ["opening", "121-120", 381.5, 1683, 421.5, 1683, zoneByRoom["120"].zone_id, "UNVERIFIED (±2\")"],
  ["opening", "8'", 218.5, 1443, 314.5, 1443, zoneByRoom["121"].zone_id, "Printed 8' at the stub wall"],
  ["door", "35", 0, 1021.5, 0, 1061.5, W, "To the office side. UNVERIFIED"],
  ["door", "27", 0, 1337.5, 0, 1373.5, zoneByRoom["123"].zone_id, "To the office side. UNVERIFIED"],
  ["door", "29", 0, 1687, 0, 1727, zoneByRoom["120"].zone_id, "To the office side. UNVERIFIED"],
  ["door", "30", 0, 1812, 0, 1852, zoneByRoom["120"].zone_id, "To the office side. UNVERIFIED"],
];
const openings = openingDefs.map(([kind, tag, x1_in, y1_in, x2_in, y2_in, zone_id, notes]) => ({
  opening_id: id("opn"), kind, tag, x1_in, y1_in, x2_in, y2_in,
  height_in: kind === "door" ? 84 : kind === "overhead" ? 168 : 120,
  zone_id, notes, verified: false, version: 1,
}));

// ---------------- Shelves (contract §9; positions made up) ----------------
function rows(n, height = 84, ground = 4) {
  const spacing = Math.floor((height - ground + 1) / n);
  return Array.from({ length: n }, (_, i) => {
    const elevation_in = ground + i * spacing;
    const clear_height_in = i < n - 1 ? spacing - 1 : height - elevation_in;
    return { row_index: i, row_label: i === 0 ? "G" : String(i), elevation_in, clear_height_in };
  });
}

// slot spec: [row, colStart, widthSpan, heightSpan?, bin?] ; bin = [type, w, h, d, color?]
const shelfDefs = [
  {
    name: "A1", room: "126", x_in: 24, y_in: 960, rotation_deg: 270, cols: 12, nrows: 5,
    wall_ref: "WAREHOUSE 126 west wall, 20'-3\" from S end, against the wall",
    slots: [
      [0, 1, 2, 1, ["bin", 15, 7, 18]], [0, 3, 2, 1, ["bin", 15, 7, 18]], [0, 5, 3, 2, ["tote", 22, 26, 20, "#1E88E5"]], [0, 8, 2], [0, 10, 3],
      [1, 1, 2, 1, ["bin", 15, 7, 18]], [1, 3, 2], [1, 8, 3], [1, 11, 2],
      [2, 1, 3, 1, ["bin", 22, 9, 18]], [2, 4, 3], [2, 7, 3], [2, 10, 3],
      [3, 1, 4, 1, ["box", 12, 8, 16]], [3, 5, 4], [3, 9, 4],
      [4, 1, 6], [4, 7, 6, 1, ["tote", 40, 14, 20, "#C9A84C"]],
    ],
  },
  {
    name: "A2", room: "126", x_in: 24, y_in: 840, rotation_deg: 270, cols: 12, nrows: 4,
    wall_ref: "WAREHOUSE 126 west wall, 30'-3\" from S end, against the wall",
    slots: [
      [0, 1, 3, 1, ["bin", 22, 10, 18]], [0, 4, 3], [0, 7, 3], [0, 10, 3],
      [1, 1, 2], [1, 3, 2], [1, 5, 2], [1, 7, 2], [1, 9, 2], [1, 11, 2],
      [2, 1, 4], [2, 5, 4], [2, 9, 4],
      [3, 1, 12, 1, ["loose", null, null, null]],
    ],
  },
  {
    name: "B1", room: "121", x_in: 240, y_in: 1651, rotation_deg: 180, cols: 12, nrows: 5,
    wall_ref: "STORAGE - PARTS & TOOLS 121 south wall, against the wall",
    slots: [
      [0, 1, 2], [0, 3, 2], [0, 5, 2], [0, 7, 2, 1, ["bin", 15, 7, 18]], [0, 9, 4, 2, ["tote", 30, 24, 20, "#6B1A2C"]],
      [1, 1, 4], [1, 5, 4],
      [2, 1, 3], [2, 4, 3], [2, 7, 3, 1, ["drawer", 22, 6, 20]], [2, 10, 3],
      [3, 1, 6], [3, 7, 6],
      [4, 1, 12],
    ],
  },
  {
    name: "F1", room: "120", x_in: 447.5, y_in: 1728, rotation_deg: 90, cols: 8, nrows: 4,
    wall_ref: "STORAGE - FILTERS 120 east wall, against the wall",
    slots: [
      [0, 1, 4, 1, ["box", 46, 18, 22]], [0, 5, 4],
      [1, 1, 2], [1, 3, 2], [1, 5, 2], [1, 7, 2],
      [2, 1, 4], [2, 5, 4],
      [3, 1, 8],
    ],
  },
];

const shelves = [];
const slots = [];
const slotByCode = {};
for (const d of shelfDefs) {
  const zone = zoneByRoom[d.room];
  const shelf = {
    shelf_id: id("shf"), name: d.name, zone_id: zone.zone_id, kind: "shelving",
    x_in: d.x_in, y_in: d.y_in, rotation_deg: d.rotation_deg, width_in: 96, depth_in: 24, height_in: 84,
    cols: d.cols, rows: rows(d.nrows), wall_ref: d.wall_ref, notes: "Demo shelf — position made up", version: 1, active: true,
  };
  shelves.push(shelf);
  const perRow = {};
  for (const [row_index, col_start, width_span, height_span = 1, bin] of d.slots) {
    perRow[row_index] = (perRow[row_index] || 0) + 1;
    const slot_no = perRow[row_index];
    const s = {
      slot_id: id("slt"), shelf_id: shelf.shelf_id, slot_no, row_index, col_start, width_span, height_span,
      bin_type: bin ? bin[0] : "bin", bin_width_in: bin ? bin[1] : null, bin_height_in: bin ? bin[2] : null,
      bin_depth_in: bin ? bin[3] : null, bin_color: bin && bin[4] ? bin[4] : null, version: 1, active: true,
    };
    slots.push(s);
    slotByCode[`${d.name}-${row_index === 0 ? "G" : row_index}-${slot_no}`] = s;
  }
}

// ---------------- Parts ----------------
// [part_id, code, name, category, department, unit, cost, sale, reorder, w, h, d, lb, description]
const partDefs = [
  ["prt-k7m2qx9d", "CU-34-90", '3/4" Copper 90° Elbow', "Plumbing Fittings", "Plumbing Install", "each", 1.85, 4.25, 20, 1.25, 1.25, 1, 0.05, "Wrot copper, C x C"],
  ["prt-c4wz8hn3", "CU-12-90", '1/2" Copper 90° Elbow', "Plumbing Fittings", "Plumbing Install", "each", 0.95, 2.4, 40, 0.9, 0.9, 0.75, 0.03, "Wrot copper, C x C"],
  ["prt-r9tq6vbe", "CU-34-TEE", '3/4" Copper Tee', "Plumbing Fittings", "Plumbing Install", "each", 2.6, 5.95, 15, 1.6, 1.25, 1, 0.07, ""],
  ["prt-h2xk5mpa", "PX-12-100", '1/2" PEX-A Tubing, 100 ft coil', "PEX", "Plumbing Install", "coil", 38.5, 79, 4, 20, 20, 5, 4.2, "Red. Coil does not fit a standard bin"],
  ["prt-v6np3jtw", "PB-34-CPL", '3/4" Push-to-Connect Coupling', "Plumbing Fittings", "Plumbing Service", "each", 7.9, 16.5, 10, 1.5, 1.5, 3.2, 0.2, ""],
  ["prt-g8bd4srk", "BV-12-SWT", '1/2" Brass Ball Valve, Sweat', "Valves", "Plumbing Service", "each", 8.25, 18.95, 10, 2.5, 2.25, 1.5, 0.35, "Full port"],
  ["prt-w3fy7cqe", "WH-FLEX-18", '18" Water Heater Flex Connector', "Water Heater", "Plumbing Service", "each", 6.4, 14.5, 8, 2, 18, 1, 0.4, "3/4 FIP x 3/4 FIP"],
  ["prt-m5ja9xud", "ABS-3-CPLG", '3" ABS Coupling', "DWV", "Plumbing Install", "each", 2.15, 4.95, 10, 3.6, 3.6, 3, 0.15, ""],
  ["prt-t7ke2nzg", "PVC-112-PT", '1-1/2" PVC P-Trap', "DWV", "Plumbing Service", "each", 3.4, 8.75, 10, 6, 4, 2, 0.25, ""],
  ["prt-q2sv8dhf", "TS-WAX-FL", "Toilet Wax Ring with Flange", "Toilet Repair", "Plumbing Service", "each", 2.95, 9.5, 12, 5, 2, 5, 0.6, ""],
  ["prt-e9cu3wkm", "FV-FLAP-2", '2" Universal Toilet Flapper', "Toilet Repair", "Plumbing Service", "each", 3.1, 11.25, 12, 3, 1.5, 3, 0.1, ""],
  ["prt-n4hr6yaj", "AS-12-38", '1/2" x 3/8" Angle Stop Valve', "Valves", "Plumbing Service", "each", 5.6, 13.75, 20, 2, 3, 2, 0.3, "Quarter turn"],
  ["prt-x8gp2tmc", "SL-38-20", '20" Faucet Supply Line', "Supply Lines", "Plumbing Service", "each", 3.25, 8.95, 15, 1, 20, 1, 0.15, "Braided stainless"],
  ["prt-b6zw9fkr", "HV-CAP-4555", "45/5 µF Dual Run Capacitor", "Capacitors", "HVAC Service", "each", 11.8, 39, 6, 2, 4.25, 2, 0.4, "440 V, round"],
  ["prt-y3mt7pdv", "HV-CON-30-2", "30 A 2-Pole Contactor", "Electrical", "HVAC Service", "each", 14.2, 45, 4, 2.5, 3, 2.25, 0.5, "24 V coil"],
  ["prt-f5kd8nbx", "FLT-16255-M11", "16x25x5 Pleated Filter, MERV 11", "Filters", "HVAC Service", "each", 18.5, 42, 6, 16, 25, 5, 2.5, ""],
  ["prt-j7qa4egs", "HV-TSTAT-NP", "Non-Programmable Thermostat", "Controls", "HVAC Install", "each", 32, 89, 3, 4.5, 4, 1.5, 0.4, "1H/1C"],
  ["prt-s2bn6rhu", "HV-IGN-HSI", "Hot Surface Igniter", "Furnace Parts", "HVAC Service", "each", 16.75, 64, 4, 1.5, 5, 1, 0.1, "Silicon nitride"],
  ["prt-p9vx3tka", "HV-FLM-SNS", "Universal Flame Sensor", "Furnace Parts", "HVAC Service", "each", 6.9, 32, 6, 1, 5, 1, 0.05, ""],
  ["prt-a4hu8zqm", "LS-38-34-50", '3/8" x 3/4" Line Set, 50 ft', "Line Sets", "HVAC Install", "each", 162, 310, 2, 22, 22, 7, 14, "Insulated copper"],
  ["prt-d6ry2wcx", "DCT-6-90", '6" Adjustable Duct Elbow 90°', "Ductwork", "HVAC New Construction", "each", 4.4, 9.9, 10, 7, 7, 7, 0.4, "Galvanized, 26 ga"],
  ["prt-u8ec5mjp", "PAD-2436", '24" x 36" Condenser Pad', "Equipment Pads", "HVAC Install", "each", 21, 48, 2, 24, 3, 36, 18, "Plastic composite"],
  ["prt-z3ft9gkn", "R410A-25", "R-410A Refrigerant, 25 lb", "Refrigerant", "HVAC Service", "cylinder", 225, 450, 2, 10, 14, 10, 27, "Store upright"],
  ["prt-k2wd7xhe", "GAS-FLX-48", '48" Gas Appliance Connector', "Gas", "Plumbing Service", "each", 17.5, 39.5, 4, 3, 48, 3, 0.8, "1/2 MIP x 1/2 FIP"],
  ["prt-h9ms4bqy", "00731", '1/2" PTFE Thread Seal Tape', "Sealants", "Plumbing Service", "roll", 0.55, 1.95, 30, 1.75, 0.5, 1.75, 0.02, "Code has leading zeros"],
  ["prt-c7tn2vrd", "FLT-20201-M8", "20x20x1 Pleated Filter, MERV 8", "Filters", "HVAC Service", "each", 4.2, 12, 12, 20, 20, 1, 0.6, "Not assigned to a slot yet"],
];
const parts = partDefs.map(([part_id, part_code, part_name, category, department, unit, cost, sale_price, reorder_point, width_in, height_in, depth_in, weight_lb, description]) => ({
  part_id, part_code, part_name, category, description, department, unit, cost, sale_price, reorder_point,
  width_in, height_in, depth_in, weight_lb, active: true, version: 1, aliases: [],
}));

// ---------------- Locations ----------------
// [part_id, location code, par, on hand]
const locDefs = [
  ["prt-k7m2qx9d", "B1-G-4", 100, 62], // part in two slots (1/2)
  ["prt-k7m2qx9d", "A1-1-2", 50, 40], //  part in two slots (2/2)
  ["prt-c4wz8hn3", "A1-G-2", 80, 55], // slot holding two parts (1/2)
  ["prt-r9tq6vbe", "A1-G-2", 30, 22], // slot holding two parts (2/2)
  ["prt-v6np3jtw", "A1-G-1", 20, 14],
  ["prt-g8bd4srk", "A1-1-1", 15, 9],
  ["prt-w3fy7cqe", "A1-G-3", 12, 7],
  ["prt-m5ja9xud", "A1-2-2", 20, 18],
  ["prt-h2xk5mpa", "A1-3-1", 4, 2], // dimensions don't fit the bin
  ["prt-h9ms4bqy", "A1-2-1", 60, 48], // leading zeros
  ["prt-t7ke2nzg", "A1-2-3", 15, 6],
  ["prt-q2sv8dhf", "A1-G-4", 12, 10],
  ["prt-e9cu3wkm", "A2-G-1", 12, 0], // 0 on hand
  ["prt-n4hr6yaj", "A2-1-1", 20, 26], // over par
  ["prt-x8gp2tmc", "A2-1-2", 24, 19],
  ["prt-k2wd7xhe", "A2-3-1", 6, 4],
  ["prt-b6zw9fkr", "B1-G-1", 8, 5],
  ["prt-y3mt7pdv", "B1-G-2", 6, 6],
  ["prt-s2bn6rhu", "B1-1-1", 6, 3],
  ["prt-p9vx3tka", "B1-1-2", 10, 8],
  ["prt-j7qa4egs", "B1-2-3", 4, 2],
  ["prt-a4hu8zqm", "B1-G-5", 3, 2],
  ["prt-d6ry2wcx", "B1-3-1", 20, 12],
  ["prt-u8ec5mjp", "B1-4-1", 4, 3],
  ["prt-z3ft9gkn", "A2-2-1", 3, 1],
  ["prt-f5kd8nbx", "F1-G-1", 12, 9],
];
const locations = locDefs.map(([part_id, code, par_qty, on_hand_qty]) => {
  const s = slotByCode[code];
  if (!s) throw new Error(`No slot ${code}`);
  return { part_id, slot_id: s.slot_id, par_qty, on_hand_qty, counted_at: "2026-10-28T15:00:00Z", counted_by: "demo@suncity.local", version: 1, active: true };
});

const out = `// GENERATED by scripts/build-demo-data.mjs — plain data, fixed IDs. Do not hand-edit.
// THE demo dataset (contract §9). The scan app, the map and seed/demo.sql (workstream A) all use it.
// Building geometry is from plan A-1 (all verified=false). Shelf positions are made up.
/* eslint-disable */
import type { Zone, Opening, Row, ShelfKind, BinType } from "../contract";

export interface DemoShelf { shelf_id: string; name: string; zone_id: string | null; kind: ShelfKind; x_in: number; y_in: number; rotation_deg: number; width_in: number; depth_in: number; height_in: number; cols: number; rows: Row[]; wall_ref: string | null; notes: string; version: number; active: boolean; }
export interface DemoSlot { slot_id: string; shelf_id: string; slot_no: number; row_index: number; col_start: number; width_span: number; height_span: number; bin_type: BinType; bin_width_in: number | null; bin_height_in: number | null; bin_depth_in: number | null; bin_color: string | null; version: number; active: boolean; }
export interface DemoPart { part_id: string; part_code: string; part_name: string; category: string; description: string; department: string; unit: string; cost: number | null; sale_price: number | null; reorder_point: number | null; width_in: number | null; height_in: number | null; depth_in: number | null; weight_lb: number | null; active: boolean; version: number; aliases: string[]; }
export interface DemoLocation { part_id: string; slot_id: string; par_qty: number; on_hand_qty: number; counted_at: string | null; counted_by: string | null; version: number; active: boolean; }

export const DEMO_ZONES: Zone[] = ${JSON.stringify(zones, null, 1)};

export const DEMO_OPENINGS: Opening[] = ${JSON.stringify(openings, null, 1)};

export const DEMO_SHELVES: DemoShelf[] = ${JSON.stringify(shelves, null, 1)};

export const DEMO_SLOTS: DemoSlot[] = ${JSON.stringify(slots)};

export const DEMO_PARTS: DemoPart[] = ${JSON.stringify(parts, null, 1)};

export const DEMO_LOCATIONS: DemoLocation[] = ${JSON.stringify(locations, null, 1)};
`;
writeFileSync(new URL("../src/shared/mock/demo-data.ts", import.meta.url), out.replace(/\n {1,}/g, (m) => m));
console.log(`zones ${zones.length}, openings ${openings.length}, shelves ${shelves.length}, slots ${slots.length}, parts ${parts.length}, locations ${locations.length}`);
