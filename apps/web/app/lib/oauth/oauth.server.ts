import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex of a token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** PKCE S256 verify: SHA256(verifier).base64url === challenge. */
export function verifyPkceS256(
  verifier: string,
  challenge: string
): boolean {
  const expected = createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return expected === challenge;
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateClientId(): string {
  return randomBytes(16).toString('hex');
}

/** Token TTL: 180 days. */
export const ACCESS_TOKEN_TTL_SEC = 180 * 24 * 60 * 60;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const PENDING_TTL_MS = 10 * 60 * 1000;
