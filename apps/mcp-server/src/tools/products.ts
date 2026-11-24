import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { toolError, toolOk, withRequestLogging } from './usage.js';

export function registerProductsTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'list_products',
    'List products from the catalog (paged). For stock alerts use low_stock instead — it filters and sorts in one call.',
    {
      limit: z.coerce.number().int().positive().max(250).default(50),
      page: z.coerce.number().int().positive().default(1),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'list_products',
        { limit: args.limit, page: args.page },
        async () => {
          try {
            const data = await connector.products.list(shop, db, {
              limit: args.limit,
              page: args.page,
            });
            const rows = (data.data ?? []).map((p) => ({
              guid: p.guid,
              name: p.name,
              code: p.code ?? null,
              price: p.price ?? null,
              currency: p.currency ?? null,
              visible: p.visible ?? null,
            }));
            return toolOk({
              count: rows.length,
              page: args.page,
              limit: args.limit,
              has_more: rows.length === args.limit,
              products: rows,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'listProducts failed'
            );
          }
        }
      )
  );

  server.tool(
    'get_product',
    'Get full product detail by identifier. Use after list_products or low_stock identifies a product of interest.',
    {
      guid: z.string().min(1).describe('Product identifier'),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'get_product',
        { guid: args.guid },
        async () => {
          try {
            const data = await connector.products.get(shop, db, args.guid);
            return toolOk(data.data);
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'getProduct failed'
            );
          }
        }
      )
  );
}
