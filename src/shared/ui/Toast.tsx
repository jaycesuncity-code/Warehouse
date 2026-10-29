import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastOptions {
  kind?: "info" | "success" | "error" | "warn";
  undo?: () => void | Promise<void>;
  undoLabel?: string;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  text: string;
}

interface ToastApi {
  show: (text: string, opts?: ToastOptions) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

const STYLE = {
  info: "bg-gray-900 text-white",
  success: "bg-emerald-800 text-white",
  error: "bg-red-800 text-white",
  warn: "bg-amber-500 text-ink",
};
const ICON = { info: "ℹ", success: "✓", error: "⚠", warn: "!" };

/** Toasts with optional Undo (about 10 s). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (text: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, text, ...opts }]);
      setTimeout(() => dismiss(id), opts.durationMs ?? (opts.undo ? 10000 : 4500));
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg px-4 py-2 shadow-xl text-sm ${STYLE[t.kind ?? "info"]}`}>
            <span aria-hidden>{ICON[t.kind ?? "info"]}</span>
            <span>{t.text}</span>
            {t.undo && (
              <button
                className="ml-2 rounded bg-white/20 px-2 py-1 font-bold underline-offset-2 hover:bg-white/30"
                onClick={() => {
                  dismiss(t.id);
                  void t.undo!();
                }}
              >
                {t.undoLabel ?? "Undo"}
              </button>
            )}
            <button className="ml-1 opacity-70 hover:opacity-100" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
