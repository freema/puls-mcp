import { expect, test } from '@playwright/test';

test('healthz reports ok dependency checks', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.db).toBe('up');
  expect(body.redis).toBe('up');
});
