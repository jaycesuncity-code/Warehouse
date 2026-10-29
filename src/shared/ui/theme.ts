/** Sun City brand + department colors. Chips always carry a text label, never color alone. */
export const BRAND = { maroon: '#6B1A2C', gold: '#C9A84C', ink: '#262626' } as const;

export interface DeptStyle {
  bg: string;
  fg: string;
  border: string;
}

// HVAC Service red / light red, HVAC Install dark / deep red, HVAC New Construction deep orange,
// Plumbing Service blue / light blue, Plumbing Install navy / deep blue.
export const DEPT_STYLES: Record<string, DeptStyle> = {
  'HVAC Service': { bg: '#FDDCDC', fg: '#8E1414', border: '#E04848' },
  'HVAC Install': { bg: '#7A1616', fg: '#FFFFFF', border: '#5C0E0E' },
  'HVAC New Construction': { bg: '#D9480F', fg: '#FFFFFF', border: '#A63A0B' },
  'Plumbing Service': { bg: '#D6E8FB', fg: '#0B4A99', border: '#3B82D6' },
  'Plumbing Install': { bg: '#10295A', fg: '#FFFFFF', border: '#0A1B3D' },
};

export const deptStyle = (dept: string | null | undefined): DeptStyle =>
  (dept && DEPT_STYLES[dept]) || { bg: '#E5E5E5', fg: '#262626', border: '#A3A3A3' };
