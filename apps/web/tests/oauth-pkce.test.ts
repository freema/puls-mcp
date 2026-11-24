import { describe, expect, it } from 'vitest';
import {
  generateClientId,
  generateOpaqueToken,
  hashToken,
  verifyPkceS256,
} from '~/lib/oauth/oauth.server';
import { createHash } from 'node:crypto';

describe('oauth helpers', () => {
  it('hashToken returns deterministic SHA-256 hex', () => {
    expect(hashToken('hello')).toBe(
      createHash('sha256').update('hello').digest('hex')
    );
  });

  it('verifyPkceS256 accepts a valid (verifier, challenge) pair', () => {
    const verifier = 'test-verifier-' + 'x'.repeat(64);
    const challenge = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('verifyPkceS256 rejects mismatched verifier', () => {
    expect(verifyPkceS256('a', 'b')).toBe(false);
  });

  it('generateOpaqueToken returns base64url, no padding', () => {
    const t = generateOpaqueToken(32);
    expect(t).not.toContain('=');
    expect(t).not.toContain('+');
    expect(t).not.toContain('/');
    expect(t.length).toBeGreaterThan(40);
  });

  it('generateClientId returns 32-char hex', () => {
    expect(generateClientId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
