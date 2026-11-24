import { expect, test } from '@playwright/test';
import { loginViaSeed } from '../helpers/seed-session-cookie';
import {
  clearHealthData,
  clearIncidents,
  countPings,
  getIncident,
} from '../helpers/health-pings';

const ADMIN_EMAIL = 'admin@example.com';

function cronUrl(job: string): string {
  const base = process.env.BASE_URL_WEB!.replace(/\/$/, '');
  return `${base}/api/cron?job=${job}`;
}

function cronAuthHeader(): string {
  const secret = process.env.CRON_SECRET ?? 'puls-cron-test-secret';
  return `Bearer ${secret}`;
}

test.describe('Admin incidents (/admin/status)', () => {
  test('admin can create + resolve an incident', async ({
    browser,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    await clearIncidents(dbUrl);

    const ctx = await browser.newContext();
    try {
      await loginViaSeed({
        context: ctx,
        databaseUrl: dbUrl,
        baseUrlWeb: process.env.BASE_URL_WEB!,
        email: ADMIN_EMAIL,
      });

      const createRes = await ctx.request.post(
        `${process.env.BASE_URL_WEB}/admin/status/new`,
        {
          form: {
            title: 'E2E test incident',
            component: 'web',
            status: 'investigating',
            message: 'První update',
          },
        }
      );
      expect([200, 302, 303]).toContain(createRes.status());

      // Find the freshly inserted row.
      const conn = await import('pg').then((m) => new m.Client({ connectionString: dbUrl }));
      await conn.connect();
      const idRow = await conn.query<{ id: string }>(
        `select id from incidents where title = 'E2E test incident' order by created_at desc limit 1`
      );
      await conn.end();
      const id = idRow.rows[0]?.id;
      expect(id).toBeTruthy();

      // Resolve via admin form.
      const resolveRes = await ctx.request.post(
        `${process.env.BASE_URL_WEB}/admin/status/${id}`,
        { form: { intent: 'resolve' } }
      );
      expect([200, 302, 303]).toContain(resolveRes.status());

      const after = await getIncident(dbUrl, id!);
      expect(after?.status).toBe('resolved');
      expect(after?.resolved_at).not.toBeNull();
    } finally {
      await ctx.close();
    }
  });

  test('non-admin cannot reach /admin/status', async ({ browser }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const ctx = await browser.newContext();
    try {
      await loginViaSeed({
        context: ctx,
        databaseUrl: dbUrl,
        baseUrlWeb: process.env.BASE_URL_WEB!,
        email: 'mcp-status-non-admin@example.test',
      });
      const page = await ctx.newPage();
      await page.goto('/admin/status');
      // Either redirected to /dashboard or 403 page — assert we're NOT on
      // the admin-status page anymore.
      await expect(page).not.toHaveURL(/\/admin\/status$/);
    } finally {
      await ctx.close();
    }
  });

  test('cron tick writes health_pings rows', async ({ request }) => {
    const dbUrl = process.env.DATABASE_URL!;
    await clearHealthData(dbUrl);
    const before = await countPings(dbUrl);
    expect(before).toBe(0);

    const res = await request.post(cronUrl('status-pinger'), {
      headers: { Authorization: cronAuthHeader() },
    });
    expect(res.status()).toBe(200);

    const after = await countPings(dbUrl);
    // 3 components × 1 row each.
    expect(after).toBeGreaterThanOrEqual(3);
  });
});
