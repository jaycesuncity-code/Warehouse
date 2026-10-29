// Color-by options (handoff): zone, department / category of contents, fill state, unverified.

import type { LayoutSlot, Zone } from "../shared/contract";
import { departmentColor, GOLD, MAROON } from "../shared/ui/brand";

export type ColorBy = "zone" | "department" | "fill" | "unverified";

export const COLOR_BY_LABEL: Record<ColorBy, string> = {
  zone: "Zone",
  department: "Department",
  fill: "Fill state",
  unverified: "Unverified",
};

export const BRAND = { maroon: MAROON, gold: GOLD };

const ZONE_PALETTE = [
  "#8DA9C4",
  "#B8C99D",
  "#D9B8C4",
  "#C9B79C",
  "#9CC9C2",
  "#C4B8D9",
  "#D9CF9C",
  "#A3B8A0",
  "#C2A3A3",
  "#A0B4C8",
];

export function zoneColor(zones: Zone[], zoneId: string | null): string {
  if (!zoneId) return "#BDBDBD";
  const i = zones.findIndex((z) => z.zone_id === zoneId);
  return i < 0 ? "#BDBDBD" : ZONE_PALETTE[i % ZONE_PALETTE.length];
}

export const FILL = {
  empty: "#D7D7D7",
  stock: "#2E7D32",
  low: "#F9A825",
  out: "#C62828",
};

export const UNVERIFIED = "#F59E0B";
export const SHELF_STEEL = "#5F6B78";
export const DECK = "#9AA5B1";
export const GLOW = "#B0213F";

export type FillState = keyof typeof FILL;

export function fillState(s: Pick<LayoutSlot, "part_count" | "on_hand_total" | "par_total">): FillState {
  if (!s.part_count) return "empty";
  if (s.on_hand_total <= 0) return "out";
  if (s.on_hand_total < s.par_total) return "low";
  return "stock";
}

export function slotColor(s: LayoutSlot, colorBy: ColorBy, ctx: { zoneColor: string; zoneVerified: boolean }): string {
  switch (colorBy) {
    case "fill":
      return FILL[fillState(s)];
    case "department":
      if (!s.part_count) return FILL.empty;
      return s.departments.length === 1
        ? departmentColor(s.departments[0])
        : s.departments.length > 1
          ? "#7E57C2"
          : "#9E9E9E";
    case "zone":
      return s.bin_color ?? ctx.zoneColor;
    case "unverified":
      return ctx.zoneVerified ? "#CFCFCF" : UNVERIFIED;
  }
}

export const LEGENDS: Record<ColorBy, { color: string; label: string }[]> = {
  fill: [
    { color: FILL.empty, label: "Empty" },
    { color: FILL.stock, label: "Has stock" },
    { color: FILL.low, label: "Below par" },
    { color: FILL.out, label: "Out" },
  ],
  department: [
    { color: departmentColor("HVAC Service"), label: "HVAC Service" },
    { color: departmentColor("HVAC Install"), label: "HVAC Install" },
    { color: departmentColor("HVAC New Construction"), label: "HVAC New Constr." },
    { color: departmentColor("Plumbing Service"), label: "Plumbing Service" },
    { color: departmentColor("Plumbing Install"), label: "Plumbing Install" },
    { color: "#7E57C2", label: "Mixed" },
    { color: FILL.empty, label: "Empty" },
  ],
  zone: [{ color: "#8DA9C4", label: "Bins colored by zone (or bin color)" }],
  unverified: [
    { color: UNVERIFIED, label: "In an unverified zone" },
    { color: "#CFCFCF", label: "Verified" },
  ],
};
