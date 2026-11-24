# Shoptet API client

`@puls/shoptet-client` (`packages/shoptet-client/`) je sdílený TypeScript klient pro Shoptet REST API. Drží:

- OAuth handshake (install code → permanent token)
- Krátkodobý API token cache (30 min, proactive refresh)
- Axios klient s rate-limit-aware interceptors (refresh on 401, backoff on 429/423)
- Type-safe wrappery pro každý endpoint (orders, products, customers, stocks, categories, ...)

## Architektura

```
┌──────────────────────────────────┐
│  apps/mcp-server/src/tools/*.ts  │  (pro každý MCP tool; write = okamžitý
│                                  │   synchronní zápis, žádný web cron)
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  @puls/shoptet-client                                            │
│  ├─ orders.ts      listOrders, getOrder, listOrderChanges        │
│  ├─ products.ts    listProducts, getProduct                      │
│  ├─ customers.ts   listCustomers, getCustomer                    │
│  ├─ categories.ts  listCategories                                 │
│  ├─ stocks.ts      listStocks                                     │
│  ├─ eshop.ts       getEshopInfo                                   │
│  ├─ writes.ts      updateOrderStatus, updateProduct,             │
│  │                  setActionPrice, createVoucher,               │
│  │                  updateStock, bulkUpdateProducts,             │
│  │                  createCustomerNote                           │
│  ├─ api.ts         createShoptetApiClient (axios + interceptors) │
│  ├─ token-cache.ts getApiAccessToken (DB-cached, 30min, +60s margin)│
│  ├─ auth.ts        exchangeInstallCode, fetchBasicEshop,         │
│  │                  fetchApiAccessToken                          │
│  ├─ webhook.ts     verifyWebhookSignature (HMAC-SHA1, timing-safe)│
│  └─ types.ts                                                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
              ┌────────────────────────────┐
              │  Shoptet REST API          │
              │  - prod: <shop>.myshoptet.com/action/...
              │  - dev:  mock-shoptet (Prism on port 4010)
              └────────────────────────────┘
```

## API Token cache

[`token-cache.ts`](../../packages/shoptet-client/src/token-cache.ts)

```ts
async getApiAccessToken(shop, db): Promise<string> {
  const [cached] = await db.select().from(api_token_cache).where(shop_id = shop.id);

  // Use cached if it's good for at least 60 more seconds
  if (cached && cached.expiresAt.getTime() > Date.now() + 60_000) {
    return cached.accessToken;
  }

  // Fetch fresh from Shoptet (using permanent oauth_access_token)
  const fresh = await fetchApiAccessToken(baseUrl, shop.oauthAccessToken);
  // → GET /action/ApiOAuthServer/getAccessToken
  //   Authorization: Bearer <oauth_access_token>
  // → { access_token, expires_in: 1800 }   (30 min)

  await db.insert(api_token_cache)
    .values({ shopId, accessToken, expiresAt })
    .onConflictDoUpdate({ ... });

  return fresh.access_token;
}
```

**Vlastnosti:**
- 1:1 row per shop v `api_token_cache` (`shop_id` UNIQUE).
- 60s margin = refresh 60s před skutečným expiry → eliminuje race condition kdy aktivní request expiruje v půlce.
- Shoptet umožňuje **max 5 valid API tokenů** současně per OAuth token. Náš cache drží 1 → bezpečně pod limitem.
- Nepouzivame in-memory cache — **DB cache** drží konzistentnost přes oba processes (web + mcp).

## Axios klient

[`api.ts`](../../packages/shoptet-client/src/api.ts) `createShoptetApiClient(shop, db)`:

### Request interceptor
```ts
config.headers.Authorization = `Bearer ${await getApiAccessToken(shop, db)}`;
```

### Response interceptor — retry logic
| Status | Retry | Strategy |
|---|---|---|
| **401 Unauthorized** | 1× | Smaže `api_token_cache` row → `getApiAccessToken` načte fresh → re-request. Důvod: Shoptet token mohl být revoked/rotated mimo náš proces. |
| **423 Locked** | 1× | Wait 5s → re-request. Resource je dočasně locked (např. concurrent edit). |
| **429 Rate Limited** | 1× | Wait `Retry-After` header (default 1s, capped 30s) → re-request. |
| **5xx** | NE | Vrátí response, caller zodpovědný. (Pro write tooly: `callWithRetry` v `writes.ts` retry na 5xx s exponential backoff.) |

### Rate limit awareness
Pokud response obsahuje `X-RateLimit-Bucket-Filling: current/max` header, log message s parsovanou hodnotou. Dnes jen log, future: pre-emptive backoff když `current/max > 0.8`.

## Endpoint helpers

Každý helper:
1. Vyrobí `client = createShoptetApiClient(shop, db)`.
2. Zavolá konkrétní endpoint (např. `client.get('/api/orders')`).
3. Validuje status (4xx/5xx → throw).
4. Vrátí typed response (parsing přes Zod nebo type assertion).

### Read helpers (vrací `data: ...`)
| Helper | Endpoint | Vrátí |
|---|---|---|
| `listOrders(shop, db, { status?, limit? })` | `GET /api/orders` | `{ data: [{ code, status, totalPrice, ... }] }` |
| `getOrder(shop, db, code)` | `GET /api/orders/{code}` | `{ data: { code, status, items, customer, ... } }` |
| `listOrderChanges(shop, db, { from?, limit? })` | `GET /api/orders/changes` | `{ data: { cursor, changes: [...] } }` |
| `listProducts(shop, db, { limit?, page? })` | `GET /api/products` | `{ data: [{ guid, name, price, ... }] }` |
| `getProduct(shop, db, guid)` | `GET /api/products/{guid}` | `{ data: {...} }` |
| `listCustomers(shop, db, { limit? })` | `GET /api/customers` | `{ data: [{ guid, email, name }] }` |
| `getCustomer(shop, db, guid)` | `GET /api/customers/{guid}` | `{ data: {...} }` |
| `listStocks(shop, db)` | `GET /api/stocks` | `{ data: [{ id, name }] }` |
| `listCategories(shop, db)` | `GET /api/categories` | `{ data: [...] }` |
| `getEshopInfo(shop, db)` | `GET /resource?method=getBasicEshop` | `{ project, user, ... }` |

### Write helpers ([`writes.ts`](../../packages/shoptet-client/src/writes.ts))
| Helper | Endpoint |
|---|---|
| `updateOrderStatus(shop, db, { code, status, comment? })` | `PATCH /api/orders/{code}` |
| `updateProduct(shop, db, { guid, patch })` | `PATCH /api/products/{guid}` |
| `setActionPrice(shop, db, { guid, price, validFrom?, validTo? })` | `PUT /api/products/{guid}/action-price` |
| `updateStock(shop, db, { guid, stockId, quantity })` | `PATCH /api/products/{guid}/stock` |
| `createVoucher(shop, db, { code, discountType, discountValue, validUntil? })` | `POST /api/vouchers` |
| `createCustomerNote(shop, db, { guid, note })` | `POST /api/customers/{guid}/notes` |
| `bulkUpdateProducts(shop, db, items[])` | iteruje N× `PATCH /api/products/{guid}`, vrátí per-item status |

Všechny write helpery používají `callWithRetry` (uvnitř `writes.ts`) — exponential backoff s jitter pro 5xx; **NE retry pro 4xx** (klient by se opakováním nezbavil chyby).

## Mock Shoptet (Prism)

`docker compose up mock-shoptet` startne Prism nad [`spec/shoptet-openapi.json`](../../spec/shoptet-openapi.json) na host portu **4010**. Vrací deterministicky `example` payloady z OpenAPI specu.

ENV proměnná `SHOPTET_API_BASE_URL` zaměří klienta na mock (`http://mock-shoptet:4010` v compose síti, `http://localhost:4010` z hostu).

Když potřebuješ jiný response, edituj OpenAPI example a `docker compose restart mock-shoptet` (Prism cachuje spec).

### Známé limity mocku

- **Stejný `eshopId`** vrací pro každý install → v testech musíš čistit stav přes `deletePendingForShop` apod. (viz [../testing/e2e.md](../testing/e2e.md)).
- **Žádný `stockAmount`** v product payloadech → `low_stock` degraduje na empty result.
- **Žádný HMAC** na webhook payloadech (musíš podepsat sám v testu — viz `tests-e2e/helpers/hmac.ts`).

## Konfigurace

| ENV | Účel |
|---|---|
| `SHOPTET_API_BASE_URL` | Default base URL (override per shop přes `shops.shoptetApiBaseUrl`) |
| `SHOPTET_CLIENT_ID` / `SHOPTET_CLIENT_SECRET` | OAuth credentials přidělené Shoptetem (pro install code exchange) |
| `SHOPTET_REDIRECT_URI` | OAuth callback URL (registrované u Shoptetu) |

Setup viz [`../operations/env.md`](../operations/env.md).
