import { describe, expect, it } from 'vitest';
import {
  hashToken,
  extractBearer,
  parseDisabledTools,
} from '../src/oauth/middleware.js';

describe('oauth/middleware helpers', () => {
  it('parseDisabledTools treats null as legacy (force-disable write)', () => {
    const legacy = parseDisabledTools(null);
    expect(legacy.has('write')).toBe(true);
    expect(legacy.size).toBe(1);
  });

  it('parseDisabledTools treats empty string as modern "nothing disabled"', () => {
    const fresh = parseDisabledTools('');
    expect(fresh.size).toBe(0);
    expect(fresh.has('write')).toBe(false);
  });

  it('parseDisabledTools parses a CSV', () => {
    const set = parseDisabledTools('orders, customers ,');
    expect(set.has('orders')).toBe(true);
    expect(set.has('customers')).toBe(true);
    expect(set.has('')).toBe(false);
    expect(set.size).toBe(2);
  });


  it('hashToken matches Node SHA-256 hex output', () => {
    const h = hashToken('opaque-token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extractBearer reads Authorization header', () => {
    const req = {
      headers: { authorization: 'Bearer abc.def' },
    } as unknown as Parameters<typeof extractBearer>[0];
    expect(extractBearer(req)).toBe('abc.def');
  });

  it('extractBearer returns null without bearer prefix', () => {
    const req = {
      headers: { authorization: 'Basic abc' },
    } as unknown as Parameters<typeof extractBearer>[0];
    expect(extractBearer(req)).toBeNull();
  });

  it('extractBearer returns null when no Authorization header', () => {
    const req = { headers: {} } as unknown as Parameters<
      typeof extractBearer
    >[0];
    expect(extractBearer(req)).toBeNull();
  });
});
