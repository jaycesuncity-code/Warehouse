import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { IS_MOCK } from '../config';
import type { Me, Role } from '../contract';
import { resetDemoData, setMockRole } from '../mock';

export interface SessionValue {
  me: Me | null;
  /** Safe default (viewer) until /api/me answers. */
  role: Role;
  canEdit: boolean;
  isAdmin: boolean;
  isMock: boolean;
  /** Bumps when the demo role changes or demo data is reset; screens refetch on change. */
  epoch: number;
  changeRole: (role: Role) => Promise<void>;
  resetDemo: () => void;
  /** Tell every screen the data changed behind its back (e.g. after Undo): they refetch. */
  invalidate: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [epoch, setEpoch] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeRole = useCallback(
    async (role: Role) => {
      if (!IS_MOCK) return;
      setMockRole(role);
      await refresh();
      setEpoch((e) => e + 1);
    },
    [refresh],
  );

  const resetDemo = useCallback(() => {
    if (!IS_MOCK) return;
    resetDemoData();
    setEpoch((e) => e + 1);
  }, []);

  const invalidate = useCallback(() => setEpoch((e) => e + 1), []);

  const value = useMemo<SessionValue>(() => {
    const role = me?.role ?? 'viewer';
    return {
      me,
      role,
      canEdit: role !== 'viewer',
      isAdmin: role === 'admin',
      isMock: IS_MOCK,
      epoch,
      changeRole,
      resetDemo,
      invalidate,
    };
  }, [me, epoch, changeRole, resetDemo, invalidate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
