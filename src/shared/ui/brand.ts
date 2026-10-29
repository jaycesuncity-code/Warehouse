// Sun City brand + department colors (project brand system).
export const MAROON = "#6B1A2C";
export const GOLD = "#C9A84C";

export const DEPARTMENT_COLORS: Record<string, { main: string; light: string }> = {
  "HVAC Service": { main: "#D32F2F", light: "#EF9A9A" },
  "HVAC Install": { main: "#8E1B1B", light: "#5C0F0F" },
  "HVAC New Construction": { main: "#E65100", light: "#FFB74D" },
  "Plumbing Service": { main: "#1E88E5", light: "#90CAF9" },
  "Plumbing Install": { main: "#1A237E", light: "#3949AB" },
};

export function departmentColor(dept: string | null | undefined): string {
  return (dept && DEPARTMENT_COLORS[dept]?.main) || "#9E9E9E";
}
