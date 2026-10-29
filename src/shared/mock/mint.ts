/**
 * Server-style ID minting for the mock: prefix + 8 characters from the contract alphabet,
 * crypto.getRandomValues with rejection sampling (no modulo bias), retry on collision.
 */
import type { IdPrefix } from '../contract';
import { ID_ALPHABET, ID_BODY_LENGTH } from '../ids';

const ALPHABET_SIZE = ID_ALPHABET.length; // 31
// Largest multiple of 31 below 256: bytes at or above this are rejected.
const LIMIT = 256 - (256 % ALPHABET_SIZE);

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export function randomBody(length = ID_BODY_LENGTH): string {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b >= LIMIT) continue;
      out += ID_ALPHABET[b % ALPHABET_SIZE];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Mint a new id that is not in `taken`. */
export function mintId(prefix: IdPrefix, taken: Set<string> | ((id: string) => boolean)): string {
  const exists = typeof taken === 'function' ? taken : (id: string) => taken.has(id);
  for (let i = 0; i < 50; i++) {
    const id = `${prefix}-${randomBody()}`;
    if (!exists(id)) return id;
  }
  throw new Error('Could not mint a unique id');
}
