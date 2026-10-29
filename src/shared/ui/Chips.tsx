import type { Role } from '../contract';
import { deptStyle } from './theme';

export function DepartmentChip({ dept }: { dept: string | null | undefined }) {
  if (!dept) return null;
  const s = deptStyle(dept);
  return (
    <span
      data-testid="dept-chip"
      className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold"
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
    >
      {dept}
    </span>
  );
}

export type StockStatusKey = 'out' | 'low' | 'ok' | 'full';

const STATUS: Record<StockStatusKey, { label: string; icon: string; cls: string }> = {
  out: { label: 'Out', icon: '✕', cls: 'bg-red-100 text-red-900 border-red-600' },
  low: { label: 'Low', icon: '▲', cls: 'bg-amber-100 text-amber-950 border-amber-600' },
  ok: { label: 'OK', icon: '●', cls: 'bg-surface text-ink border-ink-soft' },
  full: { label: 'Full', icon: '✔', cls: 'bg-emerald-100 text-emerald-950 border-emerald-700' },
};

export function StatusChip({ status }: { status: StockStatusKey }) {
  const s = STATUS[status];
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-base font-extrabold ${s.cls}`}
    >
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const label = role === 'viewer' ? 'Viewer' : role === 'editor' ? 'Editor' : 'Admin';
  return (
    <span
      data-testid="role-badge"
      className="rounded-full border border-gold bg-white/10 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-gold"
    >
      {label}
    </span>
  );
}
