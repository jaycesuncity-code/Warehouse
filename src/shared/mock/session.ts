/** Who the mock thinks you are. The demo role switcher changes this; live mode uses GET /api/me instead. */
import type { Me, Role } from '../contract';
import { DEMO_STAFF } from './demo-data';

const ROLE_KEY = 'sc.mock.role';

let memoryRole: Role = 'editor';

export function getMockRole(): Role {
  try {
    const v = globalThis.localStorage?.getItem(ROLE_KEY);
    if (v === 'viewer' || v === 'editor' || v === 'admin') return v;
  } catch {
    /* fall through */
  }
  return memoryRole;
}

export function setMockRole(role: Role): void {
  memoryRole = role;
  try {
    globalThis.localStorage?.setItem(ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

const NAMES: Record<Role, string> = { viewer: 'Demo Viewer', editor: DEMO_STAFF.name, admin: 'Demo Admin' };

export function getMockMe(role: Role = getMockRole()): Me {
  const email = role === 'editor' ? DEMO_STAFF.email : `demo.${role}@suncity.example`;
  return { email, name: NAMES[role], role };
}
