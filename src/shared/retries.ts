/** Keep ambiguous mutations attached to one receipt across retries and page refreshes. */
const STORAGE_KEY = 'sc.pending-mutations.v1';
const pending = new Map<string, string>();

function restore(): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [hash, key] of Object.entries(value)) {
        if (/^[a-f0-9]{64}$/.test(hash) && typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key)) pending.set(hash, key);
      }
    }
  } catch { /* Restricted storage: the in-memory queue still protects in-page retries. */ }
}
function save(): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(pending))); }
  catch { /* Restricted storage. */ }
}

export async function mutationReceipt(method: string, path: string, body: string | undefined) {
  restore();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${method}\n${path}\n${body ?? ''}`));
  const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let key = pending.get(hash);
  if (!key) { key = crypto.randomUUID(); pending.set(hash, key); save(); }
  return { key, settle() { pending.delete(hash); save(); } };
}
