import { describe, expect, it } from 'vitest';
import { isAccessTokenFresh } from '../src/token-cache.js';

describe('token cache margin', () => {
  it('hits cache while expiry is strictly beyond margin', () => {
    const now = 1_000_000;
    const expiresAt = new Date(now + 61_000);
    expect(isAccessTokenFresh(expiresAt, now, 60_000)).toBe(true);
  });

  it('misses cache when inside margin window', () => {
    const now = 1_000_000;
    const expiresAt = new Date(now + 30_000);
    expect(isAccessTokenFresh(expiresAt, now, 60_000)).toBe(false);
  });

  it('misses expired tokens', () => {
    const now = 2_000_000;
    const expiresAt = new Date(now - 1);
    expect(isAccessTokenFresh(expiresAt, now, 60_000)).toBe(false);
  });
});
