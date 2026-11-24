import { expect, test } from '@playwright/test';

test('admin redirects anonymous users to login', async ({ page }) => {
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: /Vítejte zpět/i })
  ).toBeVisible();
});
