import { expect, test } from '@playwright/test';

test.describe('archived homepage', () => {
  test('renders the archived project overview', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBeLessThan(400);
    await expect(page.getByRole('status')).toContainText('2026-07-23');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: 'Sign in', exact: true })
    ).toHaveAttribute('href', '/login');
    await expect(
      page.getByRole('link', { name: 'GitHub repository' })
    ).toHaveAttribute('href', 'https://github.com/freema/puls-mcp');
  });

  test('robots.txt disallows everything', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.ok()).toBeTruthy();
    expect(await r.text()).toContain('Disallow: /');
  });
});
