import { expect, test } from '@playwright/test';
import { loginViaSeed } from '../helpers/seed-session-cookie';
import { clearPromptByTitle, getPromptIdBySlug } from '../helpers/prompts';

const ADMIN_EMAIL = 'admin@example.com';

test.describe('Admin prompt management (/admin/prompts)', () => {
  test('admin CRUD: create + publish + edit + archive', async ({ browser }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const baseUrl = process.env.BASE_URL_WEB!;
    const title = `E2E test prompt ${Date.now()}`;
    const slug = `e2e-test-prompt-${Date.now()}`;

    await clearPromptByTitle(dbUrl, title);

    const ctx = await browser.newContext();
    try {
      await loginViaSeed({
        context: ctx,
        databaseUrl: dbUrl,
        baseUrlWeb: baseUrl,
        email: ADMIN_EMAIL,
      });

      // Create.
      const createRes = await ctx.request.post(
        `${baseUrl}/admin/prompts/new`,
        {
          form: {
            title,
            slug,
            summary: 'E2E created prompt summary',
            body: 'E2E body content for the prompt.',
            category_id: 'cat_sales',
            min_tier: '',
            difficulty: 'easy',
            est_minutes: '5',
            sort_order: '99',
            required_tools: 'list_orders',
            required_consent: 'orders',
            is_published: '1',
          },
        }
      );
      expect([200, 302, 303]).toContain(createRes.status());

      const id = await getPromptIdBySlug(dbUrl, slug);
      expect(id).toBeTruthy();

      // Edit — change title.
      const newTitle = `${title} (renamed)`;
      const editRes = await ctx.request.post(
        `${baseUrl}/admin/prompts/${id}`,
        {
          form: {
            intent: 'save',
            title: newTitle,
            slug,
            summary: 'E2E created prompt summary',
            body: 'E2E body content for the prompt.',
            category_id: 'cat_sales',
            min_tier: '',
            difficulty: 'easy',
            est_minutes: '5',
            sort_order: '99',
            required_tools: 'list_orders',
            required_consent: 'orders',
            is_published: '1',
          },
        }
      );
      expect([200, 302, 303]).toContain(editRes.status());

      // Archive.
      const archiveRes = await ctx.request.post(
        `${baseUrl}/admin/prompts/${id}`,
        { form: { intent: 'archive' } }
      );
      expect([200, 302, 303]).toContain(archiveRes.status());
    } finally {
      await ctx.close();
    }
  });

  test('non-admin cannot reach /admin/prompts', async ({ browser }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const ctx = await browser.newContext();
    try {
      await loginViaSeed({
        context: ctx,
        databaseUrl: dbUrl,
        baseUrlWeb: process.env.BASE_URL_WEB!,
        email: 'prompts-non-admin@example.test',
      });
      const page = await ctx.newPage();
      await page.goto('/admin/prompts');
      await expect(page).not.toHaveURL(/\/admin\/prompts$/);
    } finally {
      await ctx.close();
    }
  });
});
