/** The last few scanned parts, kept in localStorage (works without it, just forgets on reload). */
const KEY = 'sc.warehouse.recent';
const MAX = 6;

export interface RecentScan {
  part_id: string;
  part_code: string;
  part_name: string;
}

let memory: RecentScan[] = [];

export function loadRecent(): RecentScan[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RecentScan[];
      if (Array.isArray(parsed))
        return parsed.filter((x) => x && typeof x.part_id === 'string').slice(0, MAX);
    }
  } catch {
    /* fall back to memory */
  }
  return memory;
}

export function pushRecent(p: RecentScan): RecentScan[] {
  const next = [p, ...loadRecent().filter((x) => x.part_id !== p.part_id)].slice(0, MAX);
  memory = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
