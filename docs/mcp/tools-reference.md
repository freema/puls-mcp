# MCP tools — kompletní reference

Všechny tooly jsou registrované v [`apps/mcp-server/src/tools/`](../../apps/mcp-server/src/tools/). Každý tool je gated **kategorií** — pokud user nepovolil tu kategorii v consent UI, tool se nezaregistruje a `tools/list` ho nevrátí.

> **Jména nástrojů jsou neutrální (bez `shoptet_` prefixu)** a **sdílená napříč platformami** — `list_orders`, `update_product`, … fungují stejně pro Shoptet i Upgates (migrace `0011_prompt_tools_neutral`). Connector-driven registrace přitom gracefully degraduje: pokud platforma nějakou kategorii/akci neumí, příslušné tooly se nezaregistrují (např. Upgates dnes nemá plnou write sadu).

## Přehled

| Kategorie | Tooly | Soubor |
|---|---|---|
| `orders` | `list_orders`, `get_order`, `list_order_changes` | `tools/orders.ts` |
| `products` | `list_products`, `get_product` | `tools/products.ts` |
| `customers` | `list_customers`, `get_customer` | `tools/customers.ts` |
| `catalog` | `list_stocks`, `list_categories`, `eshop_info` | `tools/catalog.ts` |
| `insights` | `sales_summary`, `low_stock`, `top_customers` | `tools/insights.ts` |
| `write` ⚠️ | 7 mutating tools + `revert_write`, viz [write-tools-and-audit.md](write-tools-and-audit.md) | `tools/writes.ts`, `tools/revert.ts` |
| `memory` | `memory_get`, `memory_set`, `memory_forget` | `tools/memory.ts` |

**Celkem:** 20 toolů (13 read + 7 write — `update_order_status`, `create_customer_note`, `update_product`, `set_action_price`, `create_voucher`, `update_stock`, `bulk_update_products` — plus `revert_write` a 3 memory; přesný počet závisí na platformě a povoleném consentu).

> ⚠️ **Trial tier nemá `write` tools** vůbec — i když uživatel zaškrtne `write` v consentu, factory write nástroje nezaregistruje (`trialBlocksWrites` v `puls-mcp.ts`). Anti-freeride.

## Read tools

### `list_orders`
```
List recent orders for the shop. Returns a slim row per order (code, status, total).
For totals/trends use sales_summary instead — it does the aggregation server-side.
```
**Args:** `status?: string`, `limit: int (1-250, default 50)`, `page: int (>=1, default 1)`
**Returns:** `{ count, page, limit, has_more, orders: [{ code, status, total }] }`

### `get_order`
**Args:** `code: string` (e.g. "MOCK-ORDER-001")
**Returns:** Full Shoptet order detail (items, customer, addresses, payments).

### `list_order_changes`
**Args:** `from?: string (ISO 8601)`, `limit: int (1-500, default 100)`
**Returns:** `{ cursor, count, changes: [...] }` — delta endpoint, alternativa webhooks.

### `list_products`
**Args:** `limit: int (1-250, default 50)`, `page: int (>=1, default 1)`
**Returns:** `{ count, page, limit, has_more, products: [{ guid, name, code, price, currency, visible }] }`

### `get_product`
**Args:** `guid: string`
**Returns:** Full product detail.

### `list_customers`
**Args:** `limit`, `page`
**Returns:** `{ count, page, limit, has_more, customers: [{ guid, email, name }] }`

### `get_customer`
**Args:** `guid: string`
**Returns:** Full customer detail (phone, orders count, ...).

### `list_stocks`
**Args:** `{}` (none)
**Returns:** `{ count, warehouses: [{ id, name }] }` — také jako resource `shoptet://catalog/warehouses`.

### `list_categories`
**Args:** `{}` (none)
**Returns:** `{ count, categories: [...] }` — také jako resource `shoptet://catalog/categories`.

### `eshop_info`
**Args:** `{}` (none)
**Returns:** Eshop metadata (name, url, currency, language, VAT) — také jako resource `shoptet://eshop/info`.

## Insight tools (agregace)

> Tyto tooly tahají data z více endpointů a vracejí **business-relevant summary** místo raw payloadů, takže LLM nemusí reasonovat nad desítkami polí.

### `sales_summary`
```
Aggregate sales for a period: revenue, order count, average order value,
status breakdown and top products.
Prefer this over calling list_orders + summing manually.
```
**Args:**
- `period: 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month'` (default `last_7_days`)
- `top_products_limit: int (1-20, default 5)`

**Returns:**
```json
{
  "period": "last 7 days",
  "from": "2026-05-01T00:00:00.000Z",
  "to": "2026-05-08T23:59:59.999Z",
  "currency": "CZK",
  "orders": 42,
  "revenue": 89450.50,
  "average_order_value": 2129.77,
  "status_breakdown": { "paid": 30, "shipped": 10, "cancelled": 2 },
  "top_products": [{ "name": "...", "quantity": 18, "revenue": 12345.00 }]
}
```

**Implementační detaily:**
- Volá `listOrders(limit:250)` → pak `getOrder(code)` paralelně pro prvních 100, filtruje podle `creationTime` v okně.
- Když `orders.length > 100`, vrací `note: "Truncated to first 100 orders fetched from Shoptet."`.

### `low_stock`
```
List products that are out of stock or below a threshold.
Returns name, code, current stock, and price.
```
**Args:** `threshold: int (0-1000, default 5)`, `limit: int (1-100, default 25)`
**Returns:** `{ threshold, total_products_checked, products_with_stock_data, warehouses: [...], flagged_count, flagged: [{ guid, name, code, price, currency, stock }] }`

**Pozn.:** mock Shoptet payload neobsahuje `stockAmount` per variant — degraduje gracefully a vrací `note: "No products in this catalog expose stockAmount."`.

### `top_customers`
```
Rank customers by total spend in the given period.
Returns email, name, order count and total revenue per customer.
```
**Args:** `period` (jako sales_summary), `limit: int (1-50, default 10)`
**Returns:** `{ period, from, to, currency, total_unique_customers, top: [{ email, name, orders, revenue, customer_guid }] }`

Cross-reference s `listCustomers(250)` pro `customer_guid`, takže LLM může pak zavolat `get_customer`.

## Write tools

> ⚠️ Mutující nástroje — gated `write` consentem, **ne-trial tierem** a **platformou** (capability-driven). Každý vyžaduje `confirm: "yes"`, zapisuje **okamžitě** a loguje do `write_log` (audit). Většina zápisů je revertovatelná nástrojem `revert_write`.

`update_order_status`, `create_customer_note`, `update_product`, `set_action_price`, `create_voucher`, `update_stock`, `bulk_update_products`, `revert_write` — kompletní reference (args, response shape, reverzibilita, `mapBeforeToPatch`) v [write-tools-and-audit.md](write-tools-and-audit.md).

## Memory tools

> Vyžaduje povolený `memory` consent **a** `shop_memory` row (memory enabled v dashboardu). Pokud chybí jedno z toho, tooly se nezaregistrují / vrátí error.

### `memory_get`
List remembered preferences and learned context. Doporučeno volat **jednou na začátku session**, aby AI klient nasal kontext bez znovu-ptaní uživatele.

**Returns:**
```json
{
  "enabled": true,
  "systemContext": "User prefers to confirm price changes in CZK with VAT, ...",
  "items": [
    { "id": "...", "category": "preference", "source": "user", "label": "default report period", "content": "always last_30_days", "appliesToTools": ["sales_summary"], "priority": 5, "createdAt": "..." }
  ]
}
```

### `memory_set`
**Args:**
- `content: string (1-1000)` — fakta nebo preference, 1-2 věty, specifické
- `label?: string (max 120)` — krátký titul
- `category?: 'preference' | 'context' | 'learned' | 'instruction'` (default `context`)
- `appliesToTools?: string[]` — omezit na konkrétní tool names; omit = global
- `priority?: int (-10..10)` — vyšší se renderují první

**Returns:** `{ id, saved: true }`

LLM by měl volat `memory_set` když uživatel:
- explicitně řekne preferenci ("always show me last 7 days")
- potvrdí non-obvious fakt ("our XML feed is on Heureka, not Zboží")
- dá instrukci pro recurring decision

**NE volat:** transient session state, sensitive data (passwords, full PII), guesses.

### `memory_forget`
**Args:** `id?: string` nebo `all: boolean`
**Returns:** `{ deleted: N }`

## Logging

Každé volání se zaloguje do `mcp_tool_calls` (Postgres) **a** do Redis daily counters (`puls:mcp:calls:global`, `puls:mcp:shop:<shopId>:calls:<YYYY-MM-DD>`, `puls:mcp:shop:<shopId>:activity` ZSET).

Sloupce `mcp_tool_calls`:
- `shop_id` — kdo
- `tool` — název
- `status` — `'ok' | 'error'`
- `duration_ms` — wall-clock
- `args` — sanitized JSONB (truncated note bodies, žádné Bearer/secret tokeny)
- `error_message` — pokud error

Retence per tier: `pricing_tiers.activity_retention_days` (cron `log-retention`).
