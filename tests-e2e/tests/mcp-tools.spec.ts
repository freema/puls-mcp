import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken, parseJsonText } from '../helpers/mint-token';
import { setShopTier } from '../helpers/write-log';

const TEST_EMAIL = 'mcp-tools@example.test';

test.describe('MCP tool execution via Streamable HTTP + Bearer', () => {
  test('tools/list reflects scopes from token', async ({ browser, request }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'catalog'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);

      expect(names).toEqual(expect.arrayContaining(['list_orders']));
      expect(names.find((n) => n.includes('product'))).toBeUndefined();
      expect(names.find((n) => n.includes('customer'))).toBeUndefined();
      // Insights piggyback on orders/products data — they're a separate
      // category so they should also be hidden when not enabled.
      expect(names.find((n) => n.includes('sales_summary'))).toBeUndefined();
      // Write tools must be hidden unless explicitly opted in.
      expect(names.find((n) => n.includes('update_order_status'))).toBeUndefined();
      // No tool name nor description may leak a platform prefix/word.
      for (const tool of list.tools) {
        expect(tool.name.toLowerCase()).not.toContain('shoptet');
        expect(tool.name.toLowerCase()).not.toContain('upgates');
        expect((tool.description ?? '').toLowerCase()).not.toContain('shoptet');
      }
    } finally {
      await handle.close();
    }
  });

  test('Shoptet shop with write consent surfaces update_order_status', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-tools-write@example.test',
      enabledTools: ['orders', 'write'],
    });
    // Trial blocks writes — bump to starter so the write tool surfaces.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'starter');

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      // Shoptet supports write → tool is present (asymmetry vs Upgates).
      expect(names).toContain('update_order_status');
      expect(names).toContain('list_orders');
    } finally {
      await handle.close();
    }
  });

  test('tools/call list_orders returns slim rows', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'products', 'customers', 'catalog'],
    });

    const handle = await connectMcpClient({
      url: mcpUrl,
      bearer: accessToken,
    });
    try {
      const res = await handle.client.callTool({
        name: 'list_orders',
        arguments: { limit: 5 },
      });
      const payload = parseJsonText(res.content) as {
        count?: number;
        orders?: { code: string; status: string; total: unknown }[];
        has_more?: boolean;
      } | null;
      expect(payload).not.toBeNull();
      expect(typeof payload!.count).toBe('number');
      expect(Array.isArray(payload!.orders)).toBe(true);
      expect(payload!.orders!.length).toBeGreaterThan(0);
      const first = payload!.orders![0]!;
      expect(typeof first.code).toBe('string');
      expect(typeof first.status).toBe('string');
      // Slim shape — make sure raw Shoptet noise didn't leak.
      expect(Object.keys(first).sort()).toEqual(['code', 'status', 'total']);
    } finally {
      await handle.close();
    }
  });

  test('rejects request without bearer (401)', async ({ request }) => {
    const mcpUrl = process.env.BASE_URL_MCP!;
    const res = await request.post(`${mcpUrl}/mcp`, {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-anon', version: '1.0.0' },
        },
      },
    });
    expect(res.status()).toBe(401);
    const wwwAuth = res.headers()['www-authenticate'] ?? '';
    expect(wwwAuth.toLowerCase()).toContain('bearer');
  });
});
