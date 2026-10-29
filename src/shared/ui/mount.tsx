import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api } from '../api';
import { IS_MOCK } from '../config';
import { getMockRole, resetDemoData, setMockLatency, setMockRole } from '../mock';
import { SessionProvider } from './Session';
import { ToastProvider } from './Toasts';

interface MountOptions {
  /** Lift toasts above a bottom tab bar. */
  toastBottomOffset?: number;
}

/**
 * Mounts a page: session (role) + toasts around the app. In mock mode it also exposes `window.__sc`,
 * a small handle for demos and tests (call the API as "someone else", switch role, reset data).
 */
export function mountApp(app: ReactNode, opts: MountOptions = {}): void {
  if (IS_MOCK) {
    (window as unknown as { __sc: unknown }).__sc = {
      api,
      getMockRole,
      setMockRole,
      resetDemoData,
      setMockLatency,
    };
    // ?latency=0 makes the mock answer instantly (tests); the default pretends to be a network.
    const lat = new URLSearchParams(window.location.search).get('latency');
    if (lat !== null && Number.isFinite(Number(lat))) setMockLatency(Number(lat));
  }
  const el = document.getElementById('root');
  if (!el) throw new Error('Missing #root');
  createRoot(el).render(
    <StrictMode>
      <SessionProvider>
        <ToastProvider bottomOffset={opts.toastBottomOffset}>{app}</ToastProvider>
      </SessionProvider>
    </StrictMode>,
  );
}
