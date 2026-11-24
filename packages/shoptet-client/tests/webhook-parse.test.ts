import { describe, expect, it } from 'vitest';
import { parseShoptetWebhook } from '../src/webhook.js';

describe('parseShoptetWebhook', () => {
  it('keeps extra top-level JSON fields and maps eshopId → externalId (string)', () => {
    const body = JSON.stringify({
      eshopId: 1,
      event: 'order:create',
      eventCreated: new Date().toISOString(),
      eventInstance: 'INST-1',
      orderDetails: { id: 999, nested: [{ a: 1 }] },
      extraFlag: true,
    });

    const r = parseShoptetWebhook(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.payload.orderDetails).toEqual({
      id: 999,
      nested: [{ a: 1 }],
    });
    expect(r.value.payload.extraFlag).toBe(true);
    expect(r.value.payload.eshopId).toBe(1);
    expect(r.value.event).toBe('order:create');
    expect(r.value.externalId).toBe('1');
    expect(r.value.eventInstance).toBe('INST-1');
  });

  it('rejects malformed JSON / non-object payloads', () => {
    expect(parseShoptetWebhook('not-json').ok).toBe(false);
    expect(parseShoptetWebhook('"string"').ok).toBe(false);
    expect(parseShoptetWebhook('[]').ok).toBe(false);
  });

  it('rejects payloads missing required fields', () => {
    const sparse = JSON.stringify({ eshopId: 1, event: 'x', eventCreated: '' });
    const r = parseShoptetWebhook(sparse);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_shape');
  });
});
