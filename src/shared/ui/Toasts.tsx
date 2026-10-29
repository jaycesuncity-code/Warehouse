import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, isApiError } from '../api';

export interface ToastOptions {
  message: string;
  tone?: 'ok' | 'warn' | 'error' | 'info';
  /** Event ids to undo, in the order they should be undone (latest change first). */
  undoEventIds?: string[];
  durationMs?: number;
  onUndone?: () => void;
  /** Same key replaces the previous toast (for rapid +1 taps). */
  key?: string;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (t: ToastOptions) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({
  children,
  bottomOffset = 16,
}: {
  children: ReactNode;
  bottomOffset?: number;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (t: ToastOptions) => {
      const id = nextId.current++;
      setItems((xs) => {
        const kept = t.key ? xs.filter((x) => x.key !== t.key) : xs;
        return [...kept.slice(-2), { ...t, id }];
      });
      const ms = t.durationMs ?? (t.undoEventIds?.length ? 10_000 : 4_000);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const api2 = useMemo(() => ({ show }), [show]);

  async function undo(item: ToastItem) {
    dismiss(item.id);
    try {
      for (const eventId of item.undoEventIds ?? []) await api.undoEvent(eventId);
      show({ message: 'Undone.', tone: 'info' });
      item.onUndone?.();
    } catch (e) {
      const msg = isApiError(e) ? e.message : 'Could not undo that.';
      show({ message: `Couldn't undo: ${msg}`, tone: 'error', durationMs: 6000 });
    }
  }

  const tone = (t: ToastItem['tone']) =>
    t === 'error' ? 'bg-red-800' : t === 'warn' ? 'bg-amber-700' : t === 'ok' ? 'bg-emerald-800' : 'bg-ink';

  return (
    <Ctx.Provider value={api2}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3"
        style={{ bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom))` }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-2 text-white shadow-lg ${tone(t.tone)}`}
          >
            <span className="flex-1 text-base font-semibold">{t.message}</span>
            {t.undoEventIds?.length ? (
              <button
                type="button"
                className="min-h-touch min-w-touch rounded-xl bg-white/15 px-4 text-lg font-extrabold underline"
                onClick={() => void undo(t)}
              >
                Undo
              </button>
            ) : (
              <button
                type="button"
                aria-label="Dismiss"
                className="min-h-touch min-w-touch text-2xl"
                onClick={() => dismiss(t.id)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
