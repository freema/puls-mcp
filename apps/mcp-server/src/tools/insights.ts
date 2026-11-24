import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { toolError, toolOk, withRequestLogging } from './usage.js';

/**
 * "Business question" tools — they answer what an e-shop owner actually asks
 * ("how were sales this week?", "what's running out?") instead of just
 * exposing raw platform endpoints. Each tool fans out to the connector and
 * returns a *summarized* payload so the LLM doesn't have to reason over
 * dozens of fields per row.
 */
export function registerInsightsTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  registerSalesSummary(server, shop, connector, db);
  registerLowStock(server, shop, connector, db);
  registerTopCustomers(server, shop, connector, db);
}

// ============================================================
// sales_summary
// ============================================================

const PERIODS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'] as const;
type Period = (typeof PERIODS)[number];

function periodWindow(period: Period): { from: Date; to: Date; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  switch (period) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), label: 'today' };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y), label: 'yesterday' };
    }
    case 'last_7_days': {
      const f = new Date(now);
      f.setDate(f.getDate() - 6);
      return { from: startOfDay(f), to: endOfDay(now), label: 'last 7 days' };
    }
    case 'last_30_days': {
      const f = new Date(now);
      f.setDate(f.getDate() - 29);
      return { from: startOfDay(f), to: endOfDay(now), label: 'last 30 days' };
    }
    case 'this_month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: f, to: endOfDay(now), label: 'this month' };
    }
  }
}

// POZOR: záměrně lokální, EU-aware parser — zvládá český formát cen z API
// ("1 234,56" → 1234.56, mezery jako oddělovač tisíců, čárka jako desetinná).
// NENAHRAZUJ exportem `toNumber` z @puls/ecommerce-common — ten dělá jen
// `.trim()`, takže by comma-formátované ceny tiše vynuloval → špatné
// revenue/AOV v insightech (Shoptet posílá nenormalizovaná data).
function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function registerSalesSummary(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'sales_summary',
    'Aggregate sales for a period: revenue, order count, average order value, status breakdown and top products. Prefer this over calling list_orders + summing manually.',
    {
      period: z
        .enum(PERIODS)
        .default('last_7_days')
        .describe('Reporting window'),
      top_products_limit: z.coerce.number().int().min(1).max(20).default(5),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'sales_summary',
        { period: args.period, top_products_limit: args.top_products_limit },
        async () => {
          try {
            const { from, to, label } = periodWindow(args.period);
            const list = await connector.orders.list(shop, db, { limit: 250 });
            const orders = list.data ?? [];

            // Pull details in parallel for items + creationTime. Cap to avoid
            // hammering the API on huge windows.
            const detailed = await Promise.all(
              orders.slice(0, 100).map(async (o) => {
                try {
                  const d = await connector.orders.get(shop, db, o.code);
                  return d.data;
                } catch {
                  return null;
                }
              })
            );

            const inWindow = detailed.filter((d): d is NonNullable<typeof d> => {
              if (!d?.creationTime) return false;
              const t = new Date(d.creationTime).getTime();
              return t >= from.getTime() && t <= to.getTime();
            });

            const revenue = inWindow.reduce(
              (sum, o) => sum + toNumber(o.totalPrice),
              0
            );
            const count = inWindow.length;
            const aov = count > 0 ? revenue / count : 0;

            const statusBreakdown: Record<string, number> = {};
            for (const o of inWindow) {
              statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1;
            }

            const productCounts = new Map<
              string,
              { name: string; quantity: number; revenue: number }
            >();
            for (const o of inWindow) {
              for (const it of o.items ?? []) {
                const cur = productCounts.get(it.name) ?? {
                  name: it.name,
                  quantity: 0,
                  revenue: 0,
                };
                cur.quantity += it.amount ?? 1;
                cur.revenue += toNumber(it.unitPrice) * (it.amount ?? 1);
                productCounts.set(it.name, cur);
              }
            }
            const topProducts = Array.from(productCounts.values())
              .sort((a, b) => b.revenue - a.revenue)
              .slice(0, args.top_products_limit);

            const currency = inWindow[0]?.currency ?? null;

            return toolOk({
              period: label,
              from: from.toISOString(),
              to: to.toISOString(),
              currency,
              orders: count,
              revenue: Math.round(revenue * 100) / 100,
              average_order_value: Math.round(aov * 100) / 100,
              status_breakdown: statusBreakdown,
              top_products: topProducts.map((p) => ({
                name: p.name,
                quantity: p.quantity,
                revenue: Math.round(p.revenue * 100) / 100,
              })),
              note:
                count === 0
                  ? orders.length === 0
                    ? 'The shop has no orders yet.'
                    : `No orders fall within ${label}.`
                  : orders.length > 100
                    ? 'Truncated to first 100 orders fetched from the platform.'
                    : undefined,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'sales_summary failed'
            );
          }
        }
      )
  );
}

// ============================================================
// low_stock
// ============================================================

function registerLowStock(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'low_stock',
    'List products that are out of stock or below a threshold. Use to surface restock alerts. Returns name, code, current stock, and price.',
    {
      threshold: z.coerce.number().int().min(0).max(1000).default(5),
      limit: z.coerce.number().int().positive().max(100).default(25),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'low_stock',
        { threshold: args.threshold, limit: args.limit },
        async () => {
          try {
            const [products, stocks] = await Promise.all([
              connector.products.list(shop, db, { limit: 250 }),
              connector.catalog
                .stocks(shop, db)
                .catch(() => ({ data: [] as never[] })),
            ]);

            // Neutrální pole je `stock` (Upgates ho plní z top-level stock na
            // produktu — dřív se tu četl jen Shoptet `stockAmount`, takže
            // low_stock na Upgatesu vracel prázdno i pro skladové produkty).
            // `stockAmount` zůstává jako fallback pro Shoptet raw řádky.
            const rows = (products.data ?? []).map((p) => {
              const stockAmount =
                (p as unknown as { stockAmount?: number | string }).stockAmount;
              return {
                guid: p.guid,
                name: p.name,
                code: p.code ?? null,
                price: p.price ?? null,
                currency: p.currency ?? null,
                stock:
                  p.stock != null
                    ? toNumber(p.stock)
                    : stockAmount != null
                      ? toNumber(stockAmount)
                      : null,
              };
            });

            const withStock = rows.filter((r) => r.stock != null);
            const flagged = withStock
              .filter((r) => (r.stock as number) <= args.threshold)
              .sort((a, b) => (a.stock as number) - (b.stock as number))
              .slice(0, args.limit);

            return toolOk({
              threshold: args.threshold,
              total_products_checked: rows.length,
              products_with_stock_data: withStock.length,
              warehouses: (stocks.data ?? []).map((s) => ({
                id: s.id,
                name: s.name,
              })),
              flagged_count: flagged.length,
              flagged,
              note:
                withStock.length === 0
                  ? 'No products in this catalog expose stock data. Returning empty result.'
                  : undefined,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'low_stock failed'
            );
          }
        }
      )
  );
}

// ============================================================
// top_customers
// ============================================================

function registerTopCustomers(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'top_customers',
    'Rank customers by total spend in the given period. Returns email, name, order count and total revenue per customer.',
    {
      period: z.enum(PERIODS).default('last_30_days'),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'top_customers',
        { period: args.period, limit: args.limit },
        async () => {
          try {
            const { from, to, label } = periodWindow(args.period);
            const list = await connector.orders.list(shop, db, { limit: 250 });
            const orders = list.data ?? [];

            const detailed = await Promise.all(
              orders.slice(0, 100).map(async (o) => {
                try {
                  const d = await connector.orders.get(shop, db, o.code);
                  return d.data;
                } catch {
                  return null;
                }
              })
            );

            const inWindow = detailed.filter((d): d is NonNullable<typeof d> => {
              if (!d?.creationTime) return false;
              const t = new Date(d.creationTime).getTime();
              return t >= from.getTime() && t <= to.getTime();
            });

            const buckets = new Map<
              string,
              { email: string; name: string | null; orders: number; revenue: number }
            >();
            for (const o of inWindow) {
              const email = o.customer?.email?.toLowerCase().trim();
              if (!email) continue;
              const cur = buckets.get(email) ?? {
                email,
                name: o.customer?.name ?? null,
                orders: 0,
                revenue: 0,
              };
              cur.orders += 1;
              cur.revenue += toNumber(o.totalPrice);
              if (!cur.name && o.customer?.name) cur.name = o.customer.name;
              buckets.set(email, cur);
            }

            const ranked = Array.from(buckets.values())
              .sort((a, b) => b.revenue - a.revenue)
              .slice(0, args.limit)
              .map((c) => ({
                email: c.email,
                name: c.name,
                orders: c.orders,
                revenue: Math.round(c.revenue * 100) / 100,
              }));

            // Cross-reference with the customer directory so the LLM can ask
            // for full detail later via get_customer.
            const directory = await connector.customers
              .list(shop, db, { limit: 250 })
              .catch(() => ({ data: [] as never[] }));
            const guidByEmail = new Map(
              (directory.data ?? []).map((c) => [c.email.toLowerCase(), c.guid])
            );
            const enriched = ranked.map((r) => ({
              ...r,
              customer_guid: guidByEmail.get(r.email) ?? null,
            }));

            const currency = inWindow[0]?.currency ?? null;
            return toolOk({
              period: label,
              from: from.toISOString(),
              to: to.toISOString(),
              currency,
              total_unique_customers: buckets.size,
              top: enriched,
              // Explicitní důvod prázdna, ať si LLM klient nedomýšlí data.
              note:
                enriched.length === 0
                  ? orders.length === 0
                    ? 'The shop has no orders yet.'
                    : inWindow.length === 0
                      ? `No orders fall within ${label}.`
                      : 'Orders in this period carry no customer email, so customers cannot be ranked.'
                  : undefined,
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'top_customers failed'
            );
          }
        }
      )
  );
}
