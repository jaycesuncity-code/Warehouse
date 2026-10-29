import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  /** Replace the data locally (optimistic / from a mutation response). */
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/** Tiny data loader: re-runs when `deps` change, ignores out-of-date answers. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (id !== latest.current) return;
        setDataState(d);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (u: T | null | ((prev: T | null) => T | null)) =>
      setDataState((prev) => (typeof u === 'function' ? (u as (p: T | null) => T | null)(prev) : u)),
    [],
  );
  return { data, error, loading, reload, setData };
}
