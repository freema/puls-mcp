import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken } from '../helpers/mint-token';

const TEST_EMAIL = 'mcp-memory@example.test';

async function setMemoryEnabled(shopId: string, enabled: boolean) {
  const { Client } = await import('pg');
  const pgc = new Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  try {
    await pgc.query(`update shops set memory_enabled = $1 where id = $2`, [
      enabled,
      shopId,
    ]);
  } finally {
    await pgc.end();
  }
}

test.describe('Memory tools (gated by category + shop flag)', () => {
  test('memory tools hidden when shops.memory_enabled = false (default)', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      // Memory is in defaults so it's "enabled" at consent level…
    });

    // …but shops.memory_enabled defaults to false → no memory tools.
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).not.toContain('memory_get');
      expect(names).not.toContain('memory_set');
      expect(names).not.toContain('memory_forget');
    } finally {
      await handle.close();
    }
  });

  test('memory tools surface when shops.memory_enabled = true', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-memory-on@example.test',
    });

    await setMemoryEnabled(shopId, true);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(['memory_get', 'memory_set', 'memory_forget'])
      );
    } finally {
      await handle.close();
    }
  });

  test('memory category off in consent token wins over shops.memory_enabled', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-memory-consent-off@example.test',
      // Explicit list without memory.
      enabledTools: ['orders', 'products', 'customers', 'catalog', 'insights'],
    });

    await setMemoryEnabled(shopId, true);

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).not.toContain('memory_get');
    } finally {
      await handle.close();
    }
  });
});
