import { describe, expect, it } from 'vitest';
import { toNumber } from '../src/mappers.js';
import { isAccessTokenFresh } from '../src/token-cache.js';

describe('toNumber', () => {
  it('passes through finite numbers', () => {
    expect(toNumber(123.45)).toBe(123.45);
    expect(toNumber(0)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(toNumber('123.45')).toBe(123.45);
    expect(toNumber('  42 ')).toBe(42);
  });

  it('falls back on non-numeric / empty / nullish', () => {
    expect(toNumber('abc')).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber('x', 7)).toBe(7);
  });
});

describe('isAccessTokenFresh', () => {
  it('hits cache while expiry is strictly beyond margin', () => {
    const now = 1_000_000;
    expect(isAccessTokenFresh(new Date(now + 61_000), now, 60_000)).toBe(true);
  });

  it('misses cache inside margin window', () => {
    const now = 1_000_000;
    expect(isAccessTokenFresh(new Date(now + 30_000), now, 60_000)).toBe(false);
  });
});
