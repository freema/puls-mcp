import { describe, expect, it } from 'vitest';
import {
  writeFingerprint,
  extractToolPayload,
} from '../src/tools/idempotency.js';

describe('writeFingerprint', () => {
  it('is stable across object key order', () => {
    const a = writeFingerprint('shop1', 'update_product', {
      guid: 'P1',
      patch: { priceWithVat: 100, availabilityLabel: 'skladem' },
    });
    const b = writeFingerprint('shop1', 'update_product', {
      patch: { availabilityLabel: 'skladem', priceWithVat: 100 },
      guid: 'P1',
    });
    expect(a).toBe(b);
  });

  it('ignores volatile args (confirm, idempotency_key)', () => {
    const withConfirm = writeFingerprint('shop1', 'bulk_set_prices', {
      guids: ['P1', 'P2'],
      op: { mode: 'adjustPercent', value: -10 },
      confirm: 'yes',
      idempotency_key: 'whatever',
    });
    const without = writeFingerprint('shop1', 'bulk_set_prices', {
      guids: ['P1', 'P2'],
      op: { mode: 'adjustPercent', value: -10 },
    });
    expect(withConfirm).toBe(without);
  });

  it('keys on the INPUT op, so an identical bulk retry maps to the same key', () => {
    // Klíčový případ: retry adjustPercent -10 má STEJNÝ vstup → stejný klíč
    // (i když by se mezitím resolved cena změnila). To je důvod, proč
    // fingerprint bereme nad vstupem, ne nad resolved hodnotami.
    const first = writeFingerprint('shop1', 'bulk_set_prices', {
      guids: ['P1', 'P2'],
      op: { mode: 'adjustPercent', value: -10 },
    });
    const retry = writeFingerprint('shop1', 'bulk_set_prices', {
      guids: ['P1', 'P2'],
      op: { mode: 'adjustPercent', value: -10 },
    });
    expect(retry).toBe(first);
  });

  it('differs by shop, tool and meaningful args', () => {
    const base = writeFingerprint('shop1', 'update_product', { guid: 'P1' });
    expect(writeFingerprint('shop2', 'update_product', { guid: 'P1' })).not.toBe(
      base
    );
    expect(writeFingerprint('shop1', 'delete_product', { guid: 'P1' })).not.toBe(
      base
    );
    expect(writeFingerprint('shop1', 'update_product', { guid: 'P2' })).not.toBe(
      base
    );
    // Jiná hodnota relativní operace = jiný klíč (−10 % vs −20 % není dedup).
    expect(
      writeFingerprint('shop1', 'bulk_set_prices', {
        op: { mode: 'adjustPercent', value: -10 },
      })
    ).not.toBe(
      writeFingerprint('shop1', 'bulk_set_prices', {
        op: { mode: 'adjustPercent', value: -20 },
      })
    );
  });
});

describe('extractToolPayload', () => {
  it('parses the JSON payload from a success result', () => {
    const payload = extractToolPayload({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, write_log_id: 'w1' }) }],
    });
    expect(payload).toEqual({ ok: true, write_log_id: 'w1' });
  });

  it('returns null for non-JSON or empty content', () => {
    expect(
      extractToolPayload({ content: [{ type: 'text', text: 'not json' }] })
    ).toBeNull();
    expect(extractToolPayload({ content: [] })).toBeNull();
  });
});
