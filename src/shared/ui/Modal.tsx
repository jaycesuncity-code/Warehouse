import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Tone of the title bar. */
  tone?: 'default' | 'warn';
  testId?: string;
}

/** Bottom sheet on phones, centered card on larger screens. Esc closes, focus is restored. */
export function Modal({ open, title, onClose, children, tone = 'default', testId }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div
          className={`flex items-center gap-2 px-4 py-3 ${tone === 'warn' ? 'bg-amber-100 text-amber-950' : 'bg-maroon-tint text-maroon-dark'}`}
        >
          <h2 id={titleId} className="flex-1 text-xl font-extrabold leading-tight">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="min-h-touch min-w-touch rounded-xl text-3xl leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="space-y-3 p-4 pb-6">{children}</div>
      </div>
    </div>
  );
}
