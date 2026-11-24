import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { toolError, toolOk, withRequestLogging } from './usage.js';

export function registerOrdersTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'list_orders',
    'List recent orders for the shop. Returns a slim row per order (code, status, total). For totals/trends use sales_summary instead — it does the aggregation server-side.',
    {
      status: z
        .string()
        .optional()
        .describe('Optional status filter (e.g. "new", "paid").'),
      limit: z.coerce.number().int().positive().max(250).default(50),
      page: z.coerce.number().int().positive().default(1),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'list_orders',
        { status: args.status, limit: args.limit, page: args.page },
        async () => {
          try {
            const data = await connector.orders.list(shop, db, {
              status: args.status,
              limit: args.limit,
            });
            const rows = (data.data ?? []).map((o) => ({
              code: o.code,
              status: o.status,
              total: o.totalPrice ?? null,
            }));
            return toolOk({
              count: rows.length,
              page: args.page,
              limit: args.limit,
              has_more: rows.length === args.limit,
              orders: rows,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'listOrders failed'
            );
          }
        }
      )
  );

  server.tool(
    'get_order',
    'Get a single order detail by order identifier. Use after list_orders identifies an order of interest.',
    {
      code: z.string().min(1).describe('Order identifier'),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'get_order',
        { code: args.code },
        async () => {
          try {
            const data = await connector.orders.get(shop, db, args.code);
            return toolOk(data.data);
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'getOrder failed'
            );
          }
        }
      )
  );

  server.tool(
    'list_order_changes',
    'Delta endpoint — list order changes since the given timestamp. Use for incremental sync (webhooks alternative), not for browsing.',
    {
      from: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp; if omitted, returns recent changes.'),
      limit: z.coerce.number().int().positive().max(500).default(100),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'list_order_changes',
        { from: args.from, limit: args.limit },
        async () => {
          try {
            const data = await connector.orders.changes(shop, db, {
              from: args.from,
              limit: args.limit,
            });
            return toolOk({
              cursor: data.data?.cursor ?? null,
              count: data.data?.changes?.length ?? 0,
              changes: data.data?.changes ?? [],
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'listOrderChanges failed'
            );
          }
        }
      )
  );
}
