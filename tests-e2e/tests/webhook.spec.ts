import { expect, test } from '@playwright/test';
import {
  countWebhookRows,
  getLatestShop,
  getWebhookPayloadByInstance,
} from '../helpers/db';
import { signWebhook } from '../helpers/hmac';

test.describe('POST /api/webhooks', () => {
  test('valid HMAC stores row', async ({ request }) => {
    await request.post(`/api/install?code=mock_wh_${Date.now()}`);

    const dbUrl = process.env.DATABASE_URL!;
    const shop = await getLatestShop(dbUrl);
    if (!shop) throw new Error('shop missing');

    const payload = {
      eshopId: 123,
      event: 'order:create',
      eventCreated: new Date().toISOString(),
      eventInstance: `ORDER-${Date.now()}`,
      extraVendorField: { orderNumericId: 42, tags: ['a', 'b'] },
    };

    const body = JSON.stringify(payload);
    const sig = signWebhook(body, shop.webhookSignatureKey);

    const res = await request.post('/api/webhooks', {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'Shoptet-Webhook-Signature': sig,
      },
    });

    expect(res.ok()).toBeTruthy();
    expect(await countWebhookRows(dbUrl, payload.eventInstance)).toBe(1);

    const stored = await getWebhookPayloadByInstance(dbUrl, payload.eventInstance);
    expect(stored?.extraVendorField).toEqual(payload.extraVendorField);
  });

  test('invalid HMAC yields 401', async ({ request }) => {
    await request.post(`/api/install?code=mock_wh_bad_${Date.now()}`);
    const dbUrl = process.env.DATABASE_URL!;
    const shop = await getLatestShop(dbUrl);
    if (!shop) throw new Error('shop missing');

    const payload = {
      eshopId: 123,
      event: 'order:create',
      eventCreated: new Date().toISOString(),
      eventInstance: `ORDER-BAD-${Date.now()}`,
    };

    const body = JSON.stringify(payload);

    const res = await request.post('/api/webhooks', {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'Shoptet-Webhook-Signature': 'not-a-real-hmac-signature-at-all',
      },
    });

    expect(res.status()).toBe(401);
    expect(await countWebhookRows(dbUrl, payload.eventInstance)).toBe(0);
  });

  test('duplicate eventInstance is idempotent', async ({ request }) => {
    await request.post(`/api/install?code=mock_wh_dup_${Date.now()}`);
    const dbUrl = process.env.DATABASE_URL!;
    const shop = await getLatestShop(dbUrl);
    if (!shop) throw new Error('shop missing');

    const payload = {
      eshopId: 123,
      event: 'order:create',
      eventCreated: new Date().toISOString(),
      eventInstance: `ORDER-DUP-${Date.now()}`,
    };

    const body = JSON.stringify(payload);
    const sig = signWebhook(body, shop.webhookSignatureKey);

    const first = await request.post('/api/webhooks', {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'Shoptet-Webhook-Signature': sig,
      },
    });
    expect(first.ok()).toBeTruthy();

    const second = await request.post('/api/webhooks', {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'Shoptet-Webhook-Signature': sig,
      },
    });
    expect(second.ok()).toBeTruthy();

    expect(await countWebhookRows(dbUrl, payload.eventInstance)).toBe(1);
  });
});
