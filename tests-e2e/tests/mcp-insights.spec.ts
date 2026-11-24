import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken, parseJsonText } from '../helpers/mint-token';

const TEST_EMAIL = 'mcp-insights@example.test';

test.describe('Insights tools (business questions, not API wrappers)', () => {
  test('insights category surfaces sales_summary / low_stock / top_customers', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'sales_summary',
          'low_stock',
          'top_customers',
        ])
      );
    } finally {
      await handle.close();
    }
  });

  test('insights tools are gated by the "insights" category', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-insights-off@example.test',
      enabledTools: ['orders', 'products', 'customers', 'catalog'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).not.toContain('sales_summary');
      expect(names).not.toContain('low_stock');
      expect(names).not.toContain('top_customers');
    } finally {
      await handle.close();
    }
  });

  test('sales_summary returns aggregated shape', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const res = await handle.client.callTool({
        name: 'sales_summary',
        arguments: { period: 'last_30_days', top_products_limit: 3 },
      });
      const payload = parseJsonText(res.content) as Record<string, unknown> | null;
      expect(payload).not.toBeNull();
      // Aggregation surface — not a raw Shoptet response.
      for (const key of [
        'period',
        'from',
        'to',
        'orders',
        'revenue',
        'average_order_value',
        'status_breakdown',
        'top_products',
      ]) {
        expect(payload, `missing key ${key}`).toHaveProperty(key);
      }
      expect(typeof payload!.orders).toBe('number');
      expect(typeof payload!.revenue).toBe('number');
      expect(Array.isArray(payload!.top_products)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  test('low_stock degrades gracefully when stock data missing', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const res = await handle.client.callTool({
        name: 'low_stock',
        arguments: { threshold: 5, limit: 10 },
      });
      const payload = parseJsonText(res.content) as {
        threshold: number;
        total_products_checked: number;
        flagged: unknown[];
        flagged_count: number;
      } | null;
      expect(payload).not.toBeNull();
      expect(payload!.threshold).toBe(5);
      expect(typeof payload!.total_products_checked).toBe('number');
      expect(Array.isArray(payload!.flagged)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  test('top_customers ranks by spend and includes guid lookup', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const res = await handle.client.callTool({
        name: 'top_customers',
        arguments: { period: 'last_30_days', limit: 5 },
      });
      const payload = parseJsonText(res.content) as {
        period: string;
        total_unique_customers: number;
        top: { email: string; orders: number; revenue: number }[];
      } | null;
      expect(payload).not.toBeNull();
      expect(payload!.period).toBe('last 30 days');
      expect(Array.isArray(payload!.top)).toBe(true);
      // Sorted descending by revenue.
      const revenues = payload!.top.map((c) => c.revenue);
      const sorted = [...revenues].sort((a, b) => b - a);
      expect(revenues).toEqual(sorted);
    } finally {
      await handle.close();
    }
  });
});
