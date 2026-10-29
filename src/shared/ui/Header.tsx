import type { ReactNode } from "react";
import type { Role } from "../contract";
import { MODE } from "../config";

/** Maroon header with the gold rule (matches the label generator). */
export function Header({ title, subtitle, back, children }: { title: string; subtitle?: string; back?: string; children?: ReactNode }) {
  return (
    <header className="bg-maroon text-white border-b-4 border-gold">
      <div className="flex items-center gap-3 px-3 py-2 min-h-[52px]">
        {back && (
          <a href={back} className="text-white/90 hover:text-white text-sm font-semibold" aria-label="Back to home">
            ← Home
          </a>
        )}
        <div className="min-w-0">
          <div className="font-bold leading-tight truncate">{title}</div>
          {subtitle && <div className="text-xs text-gold-light leading-tight truncate">{subtitle}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

export function DemoBadge() {
  if (MODE !== "mock") return null;
  return (
    <span className="chip bg-gold text-ink" title="Running on the in-browser demo data (mock API)">
      DEMO DATA
    </span>
  );
}

const ROLE_STYLE: Record<Role, string> = {
  viewer: "bg-gray-200 text-gray-800",
  editor: "bg-blue-100 text-blue-900",
  admin: "bg-amber-100 text-amber-900",
};

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`chip ${ROLE_STYLE[role]}`}>{role}</span>;
}
