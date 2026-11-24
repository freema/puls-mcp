import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken } from '../helpers/mint-token';

const TEST_EMAIL = 'mcp-resources@example.test';

test.describe('MCP resources (puls:// URIs)', () => {
  test('lists eshop-info, categories and warehouses', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listResources();
      const uris = list.resources.map((r) => r.uri);
      expect(uris).toEqual(
        expect.arrayContaining([
          'puls://eshop/info',
          'puls://catalog/categories',
          'puls://catalog/warehouses',
        ])
      );
    } finally {
      await handle.close();
    }
  });

  test('reads puls://eshop/info as application/json', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.readResource({
        uri: 'puls://eshop/info',
      });
      expect(res.contents.length).toBeGreaterThan(0);
      const first = res.contents[0]!;
      expect(first.mimeType).toBe('application/json');
      expect(typeof first.text).toBe('string');
      // Must be parseable JSON.
      expect(() => JSON.parse(first.text as string)).not.toThrow();
    } finally {
      await handle.close();
    }
  });
});

test.describe('MCP prompts (slash-command templates)', () => {
  test('lists weekly_sales_report / inventory_alerts / order_triage', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
    });
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listPrompts();
      const names = list.prompts.map((p) => p.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'weekly_sales_report',
          'inventory_alerts',
          'order_triage',
        ])
      );
    } finally {
      await handle.close();
    }
  });

  test('weekly_sales_report renders a non-empty user message', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, domain } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
    });
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.getPrompt({
        name: 'weekly_sales_report',
        arguments: { include_top_customers: 'yes' },
      });
      expect(res.messages.length).toBeGreaterThan(0);
      const msg = res.messages[0]!;
      expect(msg.role).toBe('user');
      const text =
        msg.content.type === 'text' ? msg.content.text : '';
      // Prompt should mention the eshop and steer toward the insights tools.
      expect(text).toContain(domain);
      expect(text).toContain('sales_summary');
      expect(text).toContain('top_customers');
    } finally {
      await handle.close();
    }
  });

  test('inventory_alerts respects threshold argument', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
    });
    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.getPrompt({
        name: 'inventory_alerts',
        arguments: { threshold: '12' },
      });
      const text =
        res.messages[0]?.content.type === 'text'
          ? res.messages[0].content.text
          : '';
      expect(text).toContain('threshold: 12');
    } finally {
      await handle.close();
    }
  });
});
