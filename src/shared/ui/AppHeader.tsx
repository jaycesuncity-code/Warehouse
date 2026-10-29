import type { ReactNode } from 'react';
import { DemoBadge } from './DemoControls';
import { RoleBadge } from './Chips';
import { useSession } from './Session';

interface Props {
  title: string;
  subtitle?: string;
  /** Show a back arrow. href wins over onBack. */
  backHref?: string;
  onBack?: () => void;
  right?: ReactNode;
}

/** Maroon bar with a gold rule, as on the label generator. */
export function AppHeader({ title, subtitle, backHref, onBack, right }: Props) {
  const { role } = useSession();
  const backClass =
    'flex min-h-touch min-w-touch items-center justify-center rounded-xl text-3xl font-bold text-white';
  return (
    <header className="sticky top-0 z-40 border-b-4 border-gold bg-maroon text-white">
      <div className="mx-auto flex min-h-[64px] w-full max-w-3xl items-center gap-1 px-2">
        {backHref ? (
          <a href={backHref} aria-label="Back" className={backClass}>
            ‹
          </a>
        ) : onBack ? (
          <button type="button" aria-label="Back" onClick={onBack} className={backClass}>
            ‹
          </button>
        ) : null}
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-xl font-extrabold leading-tight" data-testid="page-title">
            {title}
          </h1>
          {subtitle ? <p className="truncate text-sm font-medium text-white/80">{subtitle}</p> : null}
        </div>
        {right}
        <RoleBadge role={role} />
        <DemoBadge />
      </div>
    </header>
  );
}
