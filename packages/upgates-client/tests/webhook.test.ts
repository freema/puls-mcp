import { describe, expect, it } from 'vitest';
import { verifyUpgatesWebhook, parseUpgatesWebhook } from '../src/webhook.js';

const EMPTY = Buffer.from('');

describe('verifyUpgatesWebhook', () => {
  it('accepts a matching per-shop secret', () => {
    expect(verifyUpgatesWebhook(EMPTY, 'secret-123', 'secret-123')).toBe(true);
  });

  it('trims whitespace from the presented secret', () => {
    expect(verifyUpgatesWebhook(EMPTY, 'secret-123', '  secret-123 ')).toBe(
      true
    );
  });

  it('rejects a mismatched secret', () => {
    expect(verifyUpgatesWebhook(EMPTY, 'secret-123', 'nope')).toBe(false);
  });

  it('rejects empty key or signature', () => {
    expect(verifyUpgatesWebhook(EMPTY, '', 'x')).toBe(false);
    expect(verifyUpgatesWebhook(EMPTY, 'x', '')).toBe(false);
  });
});

describe('parseUpgatesWebhook', () => {
  it('extracts eshop, event and id list', () => {
    const parsed = parseUpgatesWebhook({
      eshop: 'demo-eshop',
      orders: [123, '124'],
    });
    expect(parsed.externalId).toBe('demo-eshop');
    expect(parsed.event).toBe('orders');
    expect(parsed.ids).toEqual(['123', '124']);
  });

  it('throws on a non-object payload', () => {
    expect(() => parseUpgatesWebhook('nope')).toThrow(/Invalid Upgates webhook/);
  });
});
