import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src/webhook.js';

describe('verifyWebhookSignature', () => {
  const key = 'test-webhook-secret';
  const payload = '{"eshopId":123,"event":"order:create"}';
  const raw = Buffer.from(payload, 'utf8');

  it('accepts matching HMAC-SHA1 hex', () => {
    const sig = createHmac('sha1', key).update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, key, sig)).toBe(true);
  });

  it('rejects bad signature', () => {
    expect(verifyWebhookSignature(raw, key, 'deadbeef')).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(verifyWebhookSignature(raw, key, 'abc')).toBe(false);
  });
});
