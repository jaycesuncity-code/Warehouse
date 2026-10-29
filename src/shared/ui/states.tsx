import type { ReactNode } from 'react';
import { Button } from './Button';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 p-8 text-lg font-semibold text-ink-soft"
    >
      <span
        aria-hidden="true"
        className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-surface-line border-t-maroon"
      />
      {label}
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
  children,
}: {
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div role="alert" className="card border-red-300 bg-red-50 text-red-900">
      <p className="text-lg font-bold">Something went wrong</p>
      <p className="mt-1">{message}</p>
      <div className="mt-3 flex gap-2">
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
        {children}
      </div>
    </div>
  );
}

/** The one-liner shown next to disabled edit buttons for viewers. */
export function ViewOnlyNote() {
  return (
    <p
      data-testid="view-only-note"
      className="rounded-xl border-2 border-dashed border-surface-line bg-white p-3 text-base font-semibold text-ink-soft"
    >
      🔒 View only. Ask an editor to change counts or places.
    </p>
  );
}
