import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken, parseJsonText } from '../helpers/mint-token';
import { setShopTier } from '../helpers/write-log';

const TEST_EMAIL = 'mcp-writes@example.test';

test.describe('Write tools (gated, opt-in)', () => {
  test('default consent (no enabledTools override) hides write tools', async ({
    browser,
    request,
  }) => {
    // No `enabledTools` → keep the consent UI defaults: read-only on, write off.
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-default@example.test',
    });
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toContain('list_orders');
      expect(names).not.toContain('update_order_status');
      expect(names).not.toContain('create_customer_note');
    } finally {
      await handle.close();
    }
  });

  test('write category surfaces update_order_status + create_customer_note', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: [
        'orders',
        'products',
        'customers',
        'catalog',
        'insights',
        'write',
      ],
    });
    // Trial tier write nástroje vůbec neregistruje (anti-freeride) → placený tier.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'pro');
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'update_order_status',
          'create_customer_note',
        ])
      );
      // Description should warn the model this is a mutation.
      const tool = list.tools.find((t) => t.name === 'update_order_status');
      expect(tool?.description ?? '').toMatch(/WRITE/);
    } finally {
      await handle.close();
    }
  });

  test('confirm guard rejects write without confirm:"yes"', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'write'],
    });
    // Placený tier, aby byl write nástroj registrovaný a guard se reálně spustil.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'pro');
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      // Using the SDK's strict schema would reject this client-side. We hit
      // the JSON-RPC endpoint directly so the server's runtime guard is what
      // we actually exercise.
      const initRes = await request.post(`${process.env.BASE_URL_MCP}/mcp`, {
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-write-guard', version: '1.0.0' },
          },
        },
      });
      const sessionId = initRes.headers()['mcp-session-id'];
      expect(sessionId).toBeTruthy();

      const callRes = await request.post(`${process.env.BASE_URL_MCP}/mcp`, {
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          'mcp-session-id': sessionId!,
        },
        data: {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'update_order_status',
            // Intentionally omit `confirm` to trigger the Zod guard.
            arguments: { code: 'MOCK-ORDER-001', status: 'paid' },
          },
        },
      });
      const body = await callRes.text();
      // Either Zod-level validation rejects it, or our literal('yes') guard
      // returns isError. Both outcomes are acceptable — the only failure
      // mode is silently mutating data.
      expect(body.toLowerCase()).toMatch(/confirm|invalid|error/);
    } finally {
      await handle.close();
    }
  });

  test('confirm:"yes" routes through to the write helper (writes get logged)', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      enabledTools: ['orders', 'write'],
    });
    // Placený tier — jinak se write nástroje neregistrují (anti-freeride).
    await setShopTier(process.env.DATABASE_URL!, shopId, 'pro');
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      // The mock-shoptet stub doesn't model PATCH /api/orders/{code} so the
      // call may legitimately fail at the HTTP layer. What matters for the
      // E2E is that the tool was *invoked* (i.e. confirm guard passed) and
      // therefore audited in mcp_tool_calls.
      await handle.client
        .callTool({
          name: 'update_order_status',
          arguments: {
            code: 'MOCK-ORDER-001',
            status: 'paid',
            confirm: 'yes',
          },
        })
        .catch(() => undefined);

      // Verify the audit row exists in DB. We can't import @puls/db directly
      // from tests-e2e (no workspace alias), so use raw pg.
      const { Client } = await import('pg');
      const pgc = new Client({ connectionString: process.env.DATABASE_URL });
      await pgc.connect();
      try {
        const r = await pgc.query<{ status: string; args: unknown }>(
          `select status, args
             from mcp_tool_calls
            where shop_id = $1 and tool = 'update_order_status'
            order by created_at desc
            limit 1`,
          [shopId]
        );
        expect(r.rowCount).toBeGreaterThan(0);
        const args = r.rows[0]?.args as Record<string, unknown> | null;
        expect(args).toBeTruthy();
        expect(args?.code).toBe('MOCK-ORDER-001');
        expect(args?.status).toBe('paid');
        // The audit must NOT include the confirm flag — it's a guard, not data.
        expect(args).not.toHaveProperty('confirm');
      } finally {
        await pgc.end();
      }
    } finally {
      await handle.close();
    }
  });

  test('legacy access token (disabled_tools=null) cannot reach write tools', async ({
    browser,
    request,
  }) => {
    // Mint a token through the normal flow, then mutate the row to look
    // legacy (null disabled_tools, as if it predated the consent UI rev).
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-legacy@example.test',
      enabledTools: [
        'orders',
        'products',
        'customers',
        'catalog',
        'insights',
        'write',
      ],
    });

    const { Client } = await import('pg');
    const pgc = new Client({ connectionString: process.env.DATABASE_URL });
    await pgc.connect();
    try {
      await pgc.query(
        `update oauth_access_tokens set disabled_tools = NULL where shop_id = $1`,
        [shopId]
      );
    } finally {
      await pgc.end();
    }

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      // Read tools still work (legacy compat), write tools are off.
      expect(names).toContain('list_orders');
      expect(names).not.toContain('update_order_status');
      expect(names).not.toContain('create_customer_note');
    } finally {
      await handle.close();
    }
  });
});
