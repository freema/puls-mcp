import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { toolError, toolOk, withRequestLogging } from './usage.js';

export function registerCatalogTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'list_stocks',
    'List configured warehouses for the shop. Same data is also exposed as the resource puls://catalog/warehouses.',
    {},
    async () =>
      withRequestLogging(shop.id, 'list_stocks', {}, async () => {
        try {
          const data = await connector.catalog.stocks(shop, db);
          const warehouses = data.data ?? [];
          return toolOk({
            count: warehouses.length,
            warehouses,
            // Explicitní důvod prázdna (graceful empty — tester feedback).
            ...(warehouses.length === 0
              ? { note: 'No stock locations are configured for this shop.' }
              : {}),
          });
        } catch (err) {
          return toolError(
            err instanceof Error ? err.message : 'listStocks failed'
          );
        }
      })
  );

  server.tool(
    'list_categories',
    'List the category tree for the catalog. Same data is also exposed as the resource puls://catalog/categories.',
    {},
    async () =>
      withRequestLogging(shop.id, 'list_categories', {}, async () => {
        try {
          const data = await connector.catalog.categories(shop, db);
          return toolOk({
            count: data.data?.length ?? 0,
            categories: data.data ?? [],
          });
        } catch (err) {
          return toolError(
            err instanceof Error ? err.message : 'listCategories failed'
          );
        }
      })
  );

  server.tool(
    'eshop_info',
    'Return basic eshop metadata (name, url, currency, language, VAT). Same data is also exposed as the resource puls://eshop/info.',
    {},
    async () =>
      withRequestLogging(shop.id, 'eshop_info', {}, async () => {
        try {
          const data = await connector.catalog.eshopInfo(shop, db);
          return toolOk(data);
        } catch (err) {
          return toolError(
            err instanceof Error ? err.message : 'getEshopInfo failed'
          );
        }
      })
  );

  // list_manufacturers se registruje jen když platforma číselník výrobců umí
  // (graceful degradace). Read helper, který je předpokladem pro create/update
  // produktu s polem `manufacturer`.
  const listManufacturers = connector.catalog.manufacturers;
  if (listManufacturers) {
    server.tool(
      'list_manufacturers',
      'List the manufacturers/brands configured in the shop catalog. Use this to discover valid `manufacturer` values before create_product or update_product.',
      {},
      async () =>
        withRequestLogging(shop.id, 'list_manufacturers', {}, async () => {
          try {
            const data = await listManufacturers(shop, db);
            const manufacturers = data.data ?? [];
            return toolOk({
              count: manufacturers.length,
              manufacturers,
              ...(manufacturers.length === 0
                ? {
                    note: 'The shop catalog has no manufacturers configured yet.',
                  }
                : {}),
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'listManufacturers failed'
            );
          }
        })
    );
  }
}
