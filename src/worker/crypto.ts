import { CODE_ALPHABET, CODE_LENGTH } from '../shared/api.ts';
import type { Rng } from '../shared/quiz.ts';

/** Uniform float in [0, 1) from the platform CSPRNG. */
export const cryptoRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** A 6-character quiz code. The alphabet has 32 symbols, so `byte & 31` is unbiased. */
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
}

/** Random URL-safe id (base64url of `bytes` random bytes). */
export function newId(bytes = 12): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
