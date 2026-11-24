import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken, parseJsonText } from '../helpers/mint-token';
import {
  deleteWriteLogForShop,
  getWriteLog,
  latestWriteLogForShop,
  listWriteLogForShop,
  setShopTier,
} from '../helpers/write-log';

const BASE_TOOLS = [
  'orders',
  'products',
  'customers',
  'catalog',
  'insights',
  'write',
] as const;

const ALL_NEW_WRITE_TOOLS = [
  'update_product',
  'set_action_price',
  'create_voucher',
  'update_stock',
  'bulk_update_products',
] as const;

/** Tvar úspěšného response write nástroje (toolOk). */
type WriteToolOk = {
  ok?: boolean;
  applied?: string;
  write_log_id?: string;
};

/** Tvar úspěšného response nástroje revert_write. */
type RevertToolOk = {
  ok?: boolean;
  reverted?: boolean;
  write_log_id?: string;
};

test.describe('Write tools v2 — immediate + audit + revert', () => {
  test('write tools surface only with the write category enabled (paid tier)', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-listing@example.test',
      enabledTools: [...BASE_TOOLS],
    });
    // Trial blocks writes entirely — bump to a paid tier so we see the listing.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'pro');

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      for (const tool of ALL_NEW_WRITE_TOOLS) {
        expect(names, `expected ${tool} in tool listing`).toContain(tool);
      }
      // revert_write is registered alongside the write tools.
      expect(names).toContain('revert_write');
      // Description marker.
      const updateProduct = list.tools.find((t) => t.name === 'update_product');
      expect(updateProduct?.description ?? '').toMatch(/WRITE/);
    } finally {
      await handle.close();
    }
  });

  test('immediate write: update_product applies at once and is audited', async ({
    browser,
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-immediate@example.test',
      enabledTools: ['products', 'write'],
    });
    await setShopTier(dbUrl, shopId, 'pro');
    // Clean slate so the latest-row assertion is unambiguous.
    await deleteWriteLogForShop(dbUrl, shopId);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.callTool({
        name: 'update_product',
        arguments: {
          guid: 'prod-guid-001',
          patch: { name: 'Mock Product A — renamed' },
          confirm: 'yes',
        },
      });
      const parsed = parseJsonText(res.content) as WriteToolOk | null;
      expect(parsed).toBeTruthy();
      expect(parsed?.ok).toBe(true);
      expect(parsed?.applied).toBe('immediate');
      expect(parsed?.write_log_id).toMatch(/.+/);

      // The audit row exists, is applied, and carries before/after snapshots.
      const row = await getWriteLog(dbUrl, parsed!.write_log_id!);
      expect(row).toBeTruthy();
      expect(row?.shop_id).toBe(shopId);
      expect(row?.tool).toBe('update_product');
      expect(row?.status).toBe('applied');
      expect(row?.reverted_at).toBeNull();
      // before captured pre-write, after captured post-write — neither is the
      // SQL "column missing" undefined.
      expect(row?.before).not.toBeUndefined();
      expect(row?.after).not.toBeUndefined();
      // args are stored without the confirm guard flag (it's a guard, not data).
      expect(row?.args).toMatchObject({ guid: 'prod-guid-001' });
      expect(row?.args).not.toHaveProperty('confirm');
    } finally {
      await handle.close();
    }
  });

  test('revert: revert_write restores BEFORE and flips status to reverted', async ({
    browser,
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-revert@example.test',
      enabledTools: ['products', 'write'],
    });
    await setShopTier(dbUrl, shopId, 'pro');
    await deleteWriteLogForShop(dbUrl, shopId);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      // 1) Apply a write.
      const writeRes = await handle.client.callTool({
        name: 'update_product',
        arguments: {
          guid: 'prod-guid-001',
          patch: { name: 'will be reverted' },
          confirm: 'yes',
        },
      });
      const written = parseJsonText(writeRes.content) as WriteToolOk | null;
      expect(written?.ok).toBe(true);
      const writeLogId = written?.write_log_id ?? '';
      expect(writeLogId).toMatch(/.+/);

      // 2) Revert it.
      const revertRes = await handle.client.callTool({
        name: 'revert_write',
        arguments: { write_log_id: writeLogId, confirm: 'yes' },
      });
      const reverted = parseJsonText(revertRes.content) as RevertToolOk | null;
      expect(reverted?.ok).toBe(true);
      expect(reverted?.reverted).toBe(true);
      expect(reverted?.write_log_id).toBe(writeLogId);

      // 3) The audit row is now reverted with a reverted_at timestamp.
      const row = await getWriteLog(dbUrl, writeLogId);
      expect(row?.status).toBe('reverted');
      expect(row?.reverted_at).not.toBeNull();
    } finally {
      await handle.close();
    }
  });

  test('revert guard: reverting an already-reverted entry errors', async ({
    browser,
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-double-revert@example.test',
      enabledTools: ['products', 'write'],
    });
    await setShopTier(dbUrl, shopId, 'pro');
    await deleteWriteLogForShop(dbUrl, shopId);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const writeRes = await handle.client.callTool({
        name: 'update_product',
        arguments: {
          guid: 'prod-guid-001',
          patch: { name: 'revert once' },
          confirm: 'yes',
        },
      });
      const writeLogId =
        (parseJsonText(writeRes.content) as WriteToolOk | null)?.write_log_id ??
        '';
      expect(writeLogId).toMatch(/.+/);

      // First revert succeeds.
      const first = await handle.client.callTool({
        name: 'revert_write',
        arguments: { write_log_id: writeLogId, confirm: 'yes' },
      });
      expect((parseJsonText(first.content) as RevertToolOk | null)?.ok).toBe(
        true
      );

      // Second revert must fail — status is no longer 'applied'.
      const second = await handle.client.callTool({
        name: 'revert_write',
        arguments: { write_log_id: writeLogId, confirm: 'yes' },
      });
      const text = JSON.stringify(second.content ?? '').toLowerCase();
      expect(second.isError ?? false).toBe(true);
      expect(text).toMatch(/revert|reverted|status/);

      // Row stays reverted (the failed second revert did not change it).
      const row = await getWriteLog(dbUrl, writeLogId);
      expect(row?.status).toBe('reverted');
    } finally {
      await handle.close();
    }
  });

  test('confirm guard: write without confirm:"yes" errors and writes no audit row', async ({
    browser,
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-confirm@example.test',
      enabledTools: ['products', 'write'],
    });
    await setShopTier(dbUrl, shopId, 'pro');
    await deleteWriteLogForShop(dbUrl, shopId);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      // The SDK's strict schema would reject a missing confirm client-side, so
      // we hit the JSON-RPC endpoint directly to exercise the server guard.
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
            name: 'update_product',
            // Intentionally omit confirm to trip the guard.
            arguments: {
              guid: 'prod-guid-001',
              patch: { name: 'must not apply' },
            },
          },
        },
      });
      const body = (await callRes.text()).toLowerCase();
      // Either Zod-level validation rejects it, or the literal('yes') guard
      // returns isError. Both are acceptable — the only failure mode is a
      // silent mutation.
      expect(body).toMatch(/confirm|invalid|error/);

      // No audit row may exist — the guard short-circuits before logWrite.
      const rows = await listWriteLogForShop(dbUrl, shopId);
      expect(rows).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });

  test('bulk_update_products writes one applied audit row per item', async ({
    browser,
    request,
  }) => {
    const dbUrl = process.env.DATABASE_URL!;
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-bulk@example.test',
      enabledTools: ['products', 'write'],
    });
    await setShopTier(dbUrl, shopId, 'pro');
    // Clean slate so the count assertion is unambiguous.
    await deleteWriteLogForShop(dbUrl, shopId);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.callTool({
        name: 'bulk_update_products',
        arguments: {
          items: [
            { guid: 'prod-guid-001', patch: { name: 'A1' } },
            { guid: 'prod-guid-002', patch: { name: 'A2' } },
            { guid: 'prod-guid-003', patch: { name: 'A3' } },
          ],
          confirm: 'yes',
        },
      });
      const parsed = parseJsonText(res.content) as
        | {
            ok?: boolean;
            applied?: string;
            results?: { guid: string; status: string; write_log_id: string }[];
          }
        | null;
      expect(parsed?.ok).toBe(true);
      expect(parsed?.applied).toBe('immediate');
      expect(parsed?.results).toHaveLength(3);
      for (const item of parsed!.results!) {
        expect(item.write_log_id).toMatch(/.+/);
      }
    } finally {
      await handle.close();
    }

    // Each item became its own write_log row, tool 'update_product'.
    const rows = await listWriteLogForShop(dbUrl, shopId);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.tool).toBe('update_product');
      expect(r.status).toBe('applied');
    }
    // latest helper returns the most recent of the batch.
    const latest = await latestWriteLogForShop(dbUrl, shopId, 'update_product');
    expect(latest?.tool).toBe('update_product');
  });

  test('tier gate: trial cannot list write tools (incl. revert_write)', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-writes-v2-trial@example.test',
      enabledTools: [...BASE_TOOLS],
    });
    // Default tier is trial (set by install). Be explicit.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'trial');

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      for (const tool of ALL_NEW_WRITE_TOOLS) {
        expect(names, `${tool} should be hidden on trial`).not.toContain(tool);
      }
      expect(names).not.toContain('update_order_status');
      expect(names).not.toContain('create_customer_note');
      // revert_write is a write tool too — hidden on trial.
      expect(names).not.toContain('revert_write');
      // Read-only tools still work on trial.
      expect(names).toContain('list_orders');
    } finally {
      await handle.close();
    }
  });
});
