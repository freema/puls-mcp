import { expect, test } from '@playwright/test';
import { seedBrowserSession } from '../helpers/session';

test('empty dashboard for unknown shop owner email', async ({
  page,
  context,
}) => {
  const dbUrl = process.env.DATABASE_URL!;
  const base = process.env.BASE_URL_WEB!;
  const { token } = await seedBrowserSession({
    databaseUrl: dbUrl,
    email: 'nobody@example.test',
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

  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: /Vítejte v Puls Dashboardu/i })
  ).toBeVisible();
});
