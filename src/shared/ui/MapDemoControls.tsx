import { useState } from "react";
import type { Role } from "../contract";
import { MODE } from "../config";

/** Mock-mode only: role switcher (viewer / editor / admin) and "Reset demo data". */
export function DemoControls({ role, onRoleChange, compact }: { role: Role; onRoleChange: (r: Role) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (MODE !== "mock") return null;
  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="demo-role">
        Demo role
      </label>
      <select
        id="demo-role"
        data-testid="role-switcher"
        className="rounded-md border border-white/30 bg-maroon-dark px-1.5 py-1 text-xs text-white"
        value={role}
        onChange={async (e) => {
          const r = e.target.value as Role;
          const mock = await import("../mock");
          mock.setMockRole(r);
          onRoleChange(r);
        }}
      >
        <option value="viewer">viewer</option>
        <option value="editor">editor</option>
        <option value="admin">admin</option>
      </select>
      {!compact && (
        <button
          className="rounded-md border border-white/30 px-2 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Reset all demo data? Your demo edits will be lost.")) return;
            setBusy(true);
            const mock = await import("../mock");
            mock.resetDemoData();
            window.location.reload();
          }}
        >
          Reset demo data
        </button>
      )}
    </div>
  );
}
