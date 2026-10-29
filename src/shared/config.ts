/**
 * App-wide mode switch.
 *
 * "mock": the whole contract runs in the browser (src/shared/mock), state in localStorage.
 * "live": the same client talks to /api (Cloudflare Pages Functions + D1).
 *
 * To go live for everyone, change DEFAULT_MODE below to 'live'.
 * For one-off testing add ?mode=live (or ?mode=mock) to any page URL; the choice is remembered for the tab.
 */
export type Mode = 'mock' | 'live';

export const DEFAULT_MODE: Mode = 'mock';
export const API_BASE = '/api';

const SESSION_KEY = 'sc.mode';

function readOverride(): Mode | null {
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
