import { expect, test } from '@playwright/test';
import { getLatestShop } from '../helpers/db';

test('install creates shop row via mock Shoptet', async () => {
  const base = process.env.BASE_URL_WEB;
  if (!base) throw new Error('BASE_URL_WEB missing');

  const code = `mock_${Date.now()}`;
  const res = await fetch(
    `${base.replace(/\/$/, '')}/api/install?code=${encodeURIComponent(code)}`,
    {
      method: 'POST',
    }
  );

  expect(res.ok).toBeTruthy();

  const body = (await res.json()) as { ok: boolean; shopId: string };
  expect(body.ok).toBe(true);
  expect(typeof body.shopId).toBe('string');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL missing');
  const shop = await getLatestShop(dbUrl);
  expect(shop?.id).toBe(body.shopId);
});
