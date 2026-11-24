import { expect, test } from '@playwright/test';
import { seedBrowserSession } from '../helpers/session';
import { seedUpgatesShop } from '../helpers/upgates-seed';

test('admin shops table lists installs', async ({ page, context }) => {
  const dbUrl = process.env.DATABASE_URL!;
  const base = process.env.BASE_URL_WEB!;

  const shop = await seedUpgatesShop({
    databaseUrl: dbUrl,
    adminEmail: 'admin@example.com',
  });

  const { token } = await seedBrowserSession({
    databaseUrl: dbUrl,
    email: 'admin@example.com',
  });

  const host = new URL(base).hostname;
  await context.addCookies([
    {
      name: 'puls_session',
      value: token,
      domain: host,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    },
  ]);

  await page.goto('/admin/shops');
  await expect(page.getByRole('heading', { name: /Obchody/i })).toBeVisible();
  await expect(page.getByText(shop.domain).first()).toBeVisible();
});
