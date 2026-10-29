import type { Me } from '../../src/shared/contract';
import type { Ctx, Env } from './database';
import { readBoundedText } from './http';

interface AccessConfiguration {
  issuer: string;
  audience: string;
  certificatesUrl: string;
}

/** Configuration is trusted only after validating the fixed certificate host. */
export function accessConfiguration(env: Env): AccessConfiguration | null {
  if (typeof env.CF_ACCESS_TEAM_DOMAIN !== 'string' || typeof env.CF_ACCESS_AUD !== 'string') return null;
  const domain = env.CF_ACCESS_TEAM_DOMAIN.trim()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '');
  const audience = env.CF_ACCESS_AUD.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)) return null;
  if (!audience || audience.length > 512 || /\s/.test(audience)) return null;
  const issuer = `https://${domain}`;
  return { issuer, audience, certificatesUrl: `${issuer}/cdn-cgi/access/certs` };
}

const normalize = (value: string) => value.trim().toLowerCase();
const allowlist = (value?: string) =>
  new Set(
    (value ?? '')
      .split(/[,\s;]+/)
      .map(normalize)
      .filter(Boolean),
  );
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const numericDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function decode(segment: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw new Error('Invalid JWT encoding');
  return Uint8Array.from(
    atob(
      segment
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(segment.length / 4) * 4, '='),
    ),
    (character) => character.charCodeAt(0),
  );
}

function parse(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(segment)));
  if (!isObject(value)) throw new Error('Invalid JWT claims');
  return value;
}

interface SigningKeys {
  fetchedAt: number;
  expiresAt: number;
  keys: Map<string, CryptoKey>;
}
const signingKeys = new Map<string, SigningKeys>();
const pendingFetches = new Map<string, Promise<SigningKeys>>();
const failedFetches = new Map<string, number>();
const KEY_TTL_MS = 5 * 60_000;
const KEY_REFRESH_COOLDOWN_MS = 30_000;

async function fetchKeys(config: AccessConfiguration): Promise<SigningKeys> {
  const pending = pendingFetches.get(config.issuer);
  if (pending) return pending;
  if ((failedFetches.get(config.issuer) ?? 0) > Date.now())
    throw new Error('Signing keys temporarily unavailable');
  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(config.certificatesUrl, {
        // Workers supports only follow/manual. Reject every redirect via !ok below.
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Signing keys unavailable');
      const body: unknown = JSON.parse(await readBoundedText(response, 65_536));
      if (!isObject(body) || !Array.isArray(body.keys) || body.keys.length > 20)
        throw new Error('Invalid signing keys');
      const keys = new Map<string, CryptoKey>();
      for (const candidate of body.keys) {
        if (
          !isObject(candidate) ||
          candidate.kty !== 'RSA' ||
          typeof candidate.kid !== 'string' ||
          !candidate.kid ||
          candidate.kid.length > 256
        )
          continue;
        if (
          (candidate.alg !== undefined && candidate.alg !== 'RS256') ||
          (candidate.use !== undefined && candidate.use !== 'sig')
        )
          continue;
        if (typeof candidate.n !== 'string' || typeof candidate.e !== 'string') continue;
        if (keys.has(candidate.kid)) throw new Error('Ambiguous signing key');
        try {
          const key = await crypto.subtle.importKey(
            'jwk',
            candidate as JsonWebKey,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
          );
          keys.set(candidate.kid, key);
        } catch {
          // An unsupported key does not invalidate a different, valid rotation key.
        }
      }
      if (!keys.size) throw new Error('No supported signing keys');
      const fetchedAt = Date.now();
      const entry = { keys, fetchedAt, expiresAt: fetchedAt + KEY_TTL_MS };
      if (signingKeys.size >= 16 && !signingKeys.has(config.issuer))
        signingKeys.delete(signingKeys.keys().next().value!);
      signingKeys.set(config.issuer, entry);
      failedFetches.delete(config.issuer);
      return entry;
    } catch (error) {
      if (failedFetches.size >= 16 && !failedFetches.has(config.issuer))
        failedFetches.delete(failedFetches.keys().next().value!);
      failedFetches.set(config.issuer, Date.now() + 10_000);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  pendingFetches.set(config.issuer, task);
  try {
    return await task;
  } finally {
    pendingFetches.delete(config.issuer);
  }
}

async function signingKey(config: AccessConfiguration, kid: string): Promise<CryptoKey | null> {
  const cached = signingKeys.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) {
    const key = cached.keys.get(kid);
    if (key) return key;
    // Unknown, unverified key IDs cannot force an unbounded certificate-fetch loop.
    if (Date.now() - cached.fetchedAt < KEY_REFRESH_COOLDOWN_MS) return null;
  }
  return (await fetchKeys(config)).keys.get(kid) ?? null;
}

/** Only a verified Access assertion establishes employee identity and server-side permissions. */
export async function access({ env, request }: Ctx): Promise<Me | null> {
  const config = accessConfiguration(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!config || !token || token.length > 16_384) return null;
  try {
    const segments = token.split('.');
    if (segments.length !== 3) return null;
    const header = parse(segments[0]);
    const claims = parse(segments[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256)
      return null;
    if (
      (header.typ !== undefined && header.typ !== 'JWT') ||
      header.crit !== undefined ||
      header.b64 !== undefined
    )
      return null;
    if (claims.iss !== config.issuer || (claims.type !== undefined && claims.type !== 'app')) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      !audiences.length ||
      !audiences.every((audience) => typeof audience === 'string') ||
      !audiences.includes(config.audience)
    )
      return null;
    const now = Date.now() / 1000;
    if (!numericDate(claims.exp) || claims.exp <= now) return null;
    if (claims.nbf !== undefined && (!numericDate(claims.nbf) || claims.nbf > now)) return null;
    if (claims.iat !== undefined && (!numericDate(claims.iat) || claims.iat > now + 60)) return null;
    if (
      typeof claims.email !== 'string' ||
      claims.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+$/.test(claims.email)
    )
      return null;
    const key = await signingKey(config, header.kid);
    if (
      !key ||
      !(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        decode(segments[2]),
        new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
      ))
    )
      return null;
    const email = normalize(claims.email);
    return {
      email,
      name:
        typeof claims.name === 'string' && claims.name.trim() && claims.name.length <= 512
          ? claims.name.trim()
          : email,
      role: allowlist(env.WAREHOUSE_ADMINS).has(email)
        ? 'admin'
        : allowlist(env.WAREHOUSE_EDITORS).has(email)
          ? 'editor'
          : 'viewer',
    };
  } catch {
    return null;
  }
}
