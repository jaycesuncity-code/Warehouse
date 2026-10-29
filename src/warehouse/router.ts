/** A tiny hash router so the browser Back button works inside the Warehouse app: #/part/prt-abc?slot=slt-xyz */
import { useEffect, useState } from 'react';

export interface Route {
  segments: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = h.split('?');
  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  return { segments, query: new URLSearchParams(queryPart) };
}

export function href(path: string, query?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`;
}

export function navigate(
  path: string,
  query?: Record<string, string | null | undefined>,
  replace = false,
): void {
  const target = href(path, query);
  if (replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

/** Back one step if we have somewhere to go in this app, otherwise to `fallback`. */
export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const partPath = (partId: string) => `/part/${encodeURIComponent(partId)}`;
