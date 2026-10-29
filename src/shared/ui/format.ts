export const money = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function whenText(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);
