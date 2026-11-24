import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';

/**
 * MCP resources — read-only context the client can pin into a conversation.
 * Unlike tools, resources are *passively* available and don't count as a
 * tool call. Use them for slow-changing eshop metadata.
 */
export function registerShopResources(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.resource(
    'eshop-info',
    'puls://eshop/info',
    {
      description: 'Basic eshop metadata (name, url, currency, language, VAT).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const data = await connector.catalog.eshopInfo(shop, db);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'categories',
    'puls://catalog/categories',
    {
      description: 'Full category tree of the shop catalog.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const data = await connector.catalog.categories(shop, db);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'warehouses',
    'puls://catalog/warehouses',
    {
      description: 'Configured stocks / warehouses for the shop.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const data = await connector.catalog.stocks(shop, db);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}
