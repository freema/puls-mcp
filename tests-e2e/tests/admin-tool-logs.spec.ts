import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken } from '../helpers/mint-token';
import { seedBrowserSession } from '../helpers/session';

const ADMIN_EMAIL = 'admin@example.com';
const TEST_EMAIL = 'admin-logs-shop@example.test';

test('tool calls are persisted to mcp_tool_calls and visible in /admin/logs', async ({
  browser,
  request,
  context,
  page,
}) => {
  const dbUrl = process.env.DATABASE_URL!;
  const baseUrl = process.env.BASE_URL_WEB!;

  // 1. Mint a token, fire two distinct tool calls.
  const { accessToken, mcpUrl, shopId, domain } = await mintAccessToken({
    browser,
    request,
    email: TEST_EMAIL,
    enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
  });
  const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
  try {
    await handle.client.callTool({
      name: 'list_orders',
      arguments: { limit: 3 },
    });
    await handle.client.callTool({
      name: 'sales_summary',
      arguments: { period: 'last_7_days' },
    });
  } finally {
    await handle.close();
  }

  // 2. Verify rows landed in the DB (audit log is the source of truth).
  const { Client } = await import('pg');
  const pgc = new Client({ connectionString: dbUrl });
  await pgc.connect();
  let dbToolNames: string[] = [];
  try {
    const r = await pgc.query<{
      tool: string;
      status: string;
      duration_ms: number | null;
    }>(
      `select tool, status, duration_ms
         from mcp_tool_calls
        where shop_id = $1
        order by created_at desc`,
      [shopId]
    );
    dbToolNames = r.rows.map((row) => row.tool);
    expect(dbToolNames).toEqual(
      expect.arrayContaining(['list_orders', 'sales_summary'])
    );
    for (const row of r.rows) {
      expect(row.status).toMatch(/^(ok|error)$/);
      // duration_ms is nullable but should be set for normal calls.
      expect(typeof row.duration_ms).toBe('number');
    }
  } finally {
    await pgc.end();
  }

  // 3. Log in as admin and load the logs UI.
  const { token } = await seedBrowserSession({
    databaseUrl: dbUrl,
    email: ADMIN_EMAIL,
  });
  const host = new URL(baseUrl).hostname;
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

  await page.goto('/admin/logs');
  await expect(
    page.getByRole('heading', { name: /Logy MCP volání/i })
  ).toBeVisible();

  // 4. The shop's domain must appear at least once, and so must each tool name.
  await expect(page.getByText(domain).first()).toBeVisible();
  await expect(page.getByText('list_orders').first()).toBeVisible();
  await expect(page.getByText('sales_summary').first()).toBeVisible();
});

test('admin/logs filter by tool narrows the table', async ({
  browser,
  request,
  context,
  page,
}) => {
  const dbUrl = process.env.DATABASE_URL!;
  const baseUrl = process.env.BASE_URL_WEB!;

  const { accessToken, mcpUrl } = await mintAccessToken({
    browser,
    request,
    email: 'admin-logs-filter@example.test',
    enabledTools: ['orders', 'catalog'],
  });
  const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
  try {
    await handle.client.callTool({
      name: 'list_orders',
      arguments: { limit: 1 },
    });
    await handle.client.callTool({
      name: 'eshop_info',
      arguments: {},
    });
  } finally {
    await handle.close();
  }

  const { token } = await seedBrowserSession({
    databaseUrl: dbUrl,
    email: ADMIN_EMAIL,
  });
  const host = new URL(baseUrl).hostname;
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

  await page.goto('/admin/logs?tool=eshop_info');
  await expect(page.getByText('eshop_info').first()).toBeVisible();
  // list_orders rows must NOT be visible when filtered to eshop_info.
  expect(await page.getByText('list_orders').count()).toBe(0);
});
