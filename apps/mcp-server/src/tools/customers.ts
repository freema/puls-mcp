import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { toolError, toolOk, withRequestLogging } from './usage.js';

export function registerCustomersTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'list_customers',
    'List customers (slim rows: identifier, email, name). For "best customers by spend" use top_customers — it does the ranking for you.',
    {
      limit: z.coerce.number().int().positive().max(250).default(50),
      page: z.coerce.number().int().positive().default(1),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'list_customers',
        { limit: args.limit, page: args.page },
        async () => {
          try {
            const data = await connector.customers.list(shop, db, {
              limit: args.limit,
            });
            const rows = (data.data ?? []).map((c) => ({
              guid: c.guid,
              email: c.email,
              name: c.name ?? null,
            }));
            return toolOk({
              count: rows.length,
              page: args.page,
              limit: args.limit,
              has_more: rows.length === args.limit,
              customers: rows,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'listCustomers failed'
            );
          }
        }
      )
  );

  server.tool(
    'get_customer',
    'Get full customer detail by identifier (incl. phone, orders count).',
    {
      guid: z.string().min(1).describe('Customer identifier'),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'get_customer',
        { guid: args.guid },
        async () => {
          try {
            const data = await connector.customers.get(shop, db, args.guid);
            return toolOk(data.data);
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'getCustomer failed'
            );
          }
        }
      )
  );
}
