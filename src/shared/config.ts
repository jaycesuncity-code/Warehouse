/**
 * App-wide mode switch.
 *
 * "mock": the whole contract runs in the browser (src/shared/mock), state in localStorage.
 * "live": the same client talks to /api (Cloudflare Pages Functions + D1).
 *
 * Production builds use the authenticated API. Demo overrides are accepted only in an explicit
 * demo build or development; a stale browser preference cannot switch production to local inventory.
 */
export type Mode = 'mock' | 'live';

export const DEMO_ENABLED = import.meta.env.VITE_DATA_MODE === 'mock' || import.meta.env.DEV;
export const DEFAULT_MODE: Mode = DEMO_ENABLED ? 'mock' : 'live';
export const API_BASE = '/api';

const SESSION_KEY = 'sc.mode';

function readOverride(): Mode | null {
  if (!DEMO_ENABLED) return null;
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('mode');
    if (fromUrl === 'live' || fromUrl === 'mock') {
      try {
        globalThis.sessionStorage?.setItem(SESSION_KEY, fromUrl);
      } catch {
        /* sessionStorage may be unavailable */
      }
      return fromUrl;
    }
    const remembered = globalThis.sessionStorage?.getItem(SESSION_KEY);
    if (remembered === 'live' || remembered === 'mock') return remembered;
  } catch {
    /* no window / storage: fall through */
  }
  return null;
}

export const MODE: Mode = readOverride() ?? DEFAULT_MODE;
export const IS_MOCK = MODE === 'mock';
