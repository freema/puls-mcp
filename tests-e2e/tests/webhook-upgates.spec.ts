import { expect, test } from '@playwright/test';
import { countWebhookRowsForShop } from '../helpers/db';
import { seedUpgatesShop } from '../helpers/upgates-seed';

const SECRET_HEADER = 'X-Upgates-Webhook-Secret';

test.describe('POST /api/webhooks/upgates', () => {
  test('valid secret stores a row and is idempotent on retry', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const shop = await seedUpgatesShop({
      databaseUrl: dbUrl,
      adminEmail: `wh-upg-${Date.now()}@example.test`,
    });

    const body = JSON.stringify({
      eshop: shop.platformAccountId,
      orders: [101, 102],
    });
    const headers = {
      'Content-Type': 'application/json',
      [SECRET_HEADER]: shop.webhookSecret,
    };

    const first = await request.post('/api/webhooks/upgates', { data: body, headers });
    expect(first.ok()).toBeTruthy();
    expect(await countWebhookRowsForShop(dbUrl, shop.shopId)).toBe(1);

    // Same id list → same idempotency key → no second row.
    const second = await request.post('/api/webhooks/upgates', { data: body, headers });
    expect(second.ok()).toBeTruthy();
    expect(await countWebhookRowsForShop(dbUrl, shop.shopId)).toBe(1);
  });

  test('two distinct shops with identical event+ids each get their own row', async ({
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const shopA = await seedUpgatesShop({
      databaseUrl: dbUrl,
      adminEmail: `wh-upg-a-${Date.now()}@example.test`,
    });
    const shopB = await seedUpgatesShop({
      databaseUrl: dbUrl,
      adminEmail: `wh-upg-b-${Date.now()}@example.test`,
    });

    // Identical event + ids (Upgates ids are per-eshop, so 101 means different
    // orders for A and B). The idempotency key must be shop-scoped, else B's row
    // collides with A's and is silently dropped.
    const idList = { orders: [101] };

    const resA = await request.post('/api/webhooks/upgates', {
      data: JSON.stringify({ eshop: shopA.platformAccountId, ...idList }),
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: shopA.webhookSecret,
      },
    });
    const resB = await request.post('/api/webhooks/upgates', {
      data: JSON.stringify({ eshop: shopB.platformAccountId, ...idList }),
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: shopB.webhookSecret,
      },
    });
    expect(resA.ok()).toBeTruthy();
    expect(resB.ok()).toBeTruthy();
    expect(await countWebhookRowsForShop(dbUrl, shopA.shopId)).toBe(1);
    expect(await countWebhookRowsForShop(dbUrl, shopB.shopId)).toBe(1);
  });

  test('wrong secret yields 401 and stores nothing', async ({ request }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const shop = await seedUpgatesShop({
      databaseUrl: dbUrl,
      adminEmail: `wh-upg-bad-${Date.now()}@example.test`,
    });

    const res = await request.post('/api/webhooks/upgates', {
      data: JSON.stringify({ eshop: shop.platformAccountId, orders: [1] }),
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: 'totally-wrong-secret',
      },
    });
    expect(res.status()).toBe(401);
    expect(await countWebhookRowsForShop(dbUrl, shop.shopId)).toBe(0);
  });

  test('unknown shop yields 401', async ({ request }) => {
    const res = await request.post('/api/webhooks/upgates', {
      data: JSON.stringify({ eshop: 'no-such-eshop', orders: [1] }),
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: 'whatever',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('invalid JSON yields 400', async ({ request }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const shop = await seedUpgatesShop({
      databaseUrl: dbUrl,
      adminEmail: `wh-upg-json-${Date.now()}@example.test`,
    });

    const res = await request.post('/api/webhooks/upgates', {
      data: 'not-json{',
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: shop.webhookSecret,
      },
    });
    expect(res.status()).toBe(400);
  });
});
