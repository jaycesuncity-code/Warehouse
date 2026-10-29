import { useState } from 'react';
import type { Role } from '../contract';
import { Button } from './Button';
import { Modal } from './Modal';
import { useSession } from './Session';
import { useToast } from './Toasts';

const ROLES: { role: Role; label: string; help: string }[] = [
  { role: 'viewer', label: 'Viewer', help: 'look up and scan only' },
  { role: 'editor', label: 'Editor', help: 'change counts and places' },
  { role: 'admin', label: 'Admin', help: 'also overwrite conflicts' },
];

/** The "DEMO DATA" badge. Tapping it opens the demo tools: role switcher and Reset demo data. */
export function DemoBadge() {
  const { isMock, role, changeRole, resetDemo } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!isMock) return null;
  return (
    <>
      <button
        type="button"
        data-testid="demo-badge"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="min-h-[44px] rounded-lg border-2 border-gold bg-gold px-2.5 text-xs font-extrabold uppercase leading-none tracking-wide text-ink"
      >
        Demo data
      </button>
      <Modal open={open} title="Demo tools" onClose={() => setOpen(false)} testId="demo-tools">
        <p className="text-sm text-ink-soft">
          Nothing here touches real data. Everything is saved only in this browser.
        </p>
        <fieldset>
          <legend className="label-xs mb-1">Pretend to be</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => (
              <button
                key={r.role}
                type="button"
                role="radio"
                aria-checked={role === r.role}
                data-testid={`role-${r.role}`}
                onClick={() => void changeRole(r.role)}
                className={`min-h-touch rounded-xl border-2 px-1 text-base font-bold ${role === r.role ? 'border-maroon bg-maroon text-white' : 'border-surface-line bg-white'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-ink-soft">{ROLES.find((r) => r.role === role)?.help}</p>
        </fieldset>
        <Button
          block
          variant="secondary"
          data-testid="reset-demo"
          onClick={() => {
            resetDemo();
            toast.show({ message: 'Demo data reset.', tone: 'info' });
            setOpen(false);
          }}
        >
          Reset demo data
        </Button>
      </Modal>
    </>
  );
}
