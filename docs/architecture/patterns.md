# Architecture patterns — platform connector & Upgates

> Implementační vzory, na kterých stojí multi-platform vrstva Pulsu. Cíl: jeden
> neutrální kontrakt (`PlatformConnector`) + per-platforma konkrétní konektor.
> Aktuální platforma: **Upgates** (`packages/upgates-client`).

---

## 1. Stack volby

| Vrstva | Volba pro Puls | Důvod |
|---|---|---|
| Runtime | Node.js 22 LTS + TypeScript 5.x | LTS, MCP SDK kompatibilní |
| HTTP (mcp) | Express.js | Battle-tested, MCP SDK kompatibilní |
| Web | React Router (Remix) | UI + OAuth AS + install/webhook routy |
| ORM/DB | Drizzle + Postgres 16 | typové schema, migrace |
| Cache / rate | Redis 7 | daily counters, login codes, MCP stats |
| HTTP klient | axios + interceptory | rate-limit backoff, concurrency gate |
| MCP | `@modelcontextprotocol/sdk` (TS) | Streamable HTTP |
| Deploy | Docker + docker-compose / Coolify | jednotný dev↔prod |

## 2. Platform abstrakce (`@puls/platform-core`)

Jádro je `PlatformConnector` — neutrální rozhraní, které MCP server volá bez
znalosti konkrétní platformy. Registry konektorů (`apps/mcp-server/src/connector-registry.ts`)
mapuje `shop.platform` na konkrétní implementaci.

```
PlatformConnector
 ├─ orders / products / customers / categories / stocks   (read)
 ├─ writes (create/update/delete, set price/discount, …)  (gated capabilities)
 ├─ webhook.verify(rawBody, key, signature)               (per-platforma)
 └─ capabilities                                          (co platforma umí)
```

- **Capabilities** (`capabilities.ts`) — boolean flagy per akce. Tool se zaregistruje,
  jen když connector danou capability hlásí `true`. Tak platforma, která něco neumí,
  prostě nezaregistruje příslušný tool (graceful degradation).
- **Neutrální doménové typy** (`@puls/ecommerce-common`) — `NormalizedShop`, order/product
  tvary sdílené napříč platformami; konkrétní mapování dělá konektor.

## 3. Shop entita (Drizzle)

```
shops
  id                  cuid  PK
  platform            enum('upgates', …)          -- diskriminátor
  external_id         text                        -- identita eshopu z platformy
  domain              text  UNIQUE
  name                text?
  status              enum(ACTIVE | PAUSED | UNINSTALLED)
  api_base_url        text?                        -- per-eshop endpoint (apiUrl)
  api_login           text?                        -- Upgates apiUser (Basic auth)
  api_key             text?                        -- Upgates apiKey, ŠIFROVANĚ (enc:v1:…)
  oauth_access_token  text                         -- placeholder pro platformy bez OAuth
  webhook_signature_key text?                      -- per-shop secret (generován při registraci webhooku)
  mcp_endpoint_secret text                         -- rezervováno pro per-shop /mcp URL
  installed_at / uninstalled_at / …
```

Multi-platform identita = `(platform, external_id)` UNIQUE. `api_key` se drží
**šifrovaně** a dešifruje jen v paměti při sestavení HTTP klienta.

## 4. Install / aktivace (Upgates)

```
Upgates → POST /api/upgates/install (aktivační callback)
  1. Ověřit signature_v2 veřejným klíčem Upgates (RSA)
     — files.upgates.com/addons/signature/api.signature.pub.key (cache v paměti)
  2. Z payloadu: apiUser, apiKey, apiUrl, identita eshopu
  3. Odvodit domain z apiUrl (fallback `${token}.upgates`)
  4. /owner lookup → adminEmail (nebo párování dokončí uživatel v iframu)
  5. UPSERT shops (platform, external_id) — apiKey šifrovaně,
     webhook secret + mcpEndpointSecret vygenerovat
  6. assignTierOnInstall → trial (1×) / starter (reinstall)
  7. Registrovat webhooky (POST /api/v2/webhooks) pro orders/products/customers/categories
```

Auth je **Basic** — žádný token-exchange, žádné krátkodobé tokeny k cachování.

## 5. Webhook handler (Upgates)

```
POST /api/webhooks/upgates
  1. Raw body (kvůli ověření v konstantním čase)
  2. Header X-Upgates-Webhook-Secret → lookup shop, porovnat timing-safe
  3. Parse payload: { eshop, <category>: [id, id, …] } — SEZNAM ID, ne plná data
  4. Idempotency: klíč si volí volající (Upgates nemá eventInstance),
     např. hash(event + ids.join(',')) → upsert webhook_notifications
  5. Vrátit 200 rychle; follow-up fetch entit dělá sync worker async
```

Pozn.: Upgates datový webhook (na rozdíl od aktivačního `signature_v2`) v dokumentaci
podpis neuvádí → bezpečný default je per-shop secret. `[O]` ověřit reálný mechanismus.

## 6. Rate-limit aware HTTP klient (`upgates-client/src/http.ts`)

```
axios interceptory:
  1. response → číst X-Rate-Limit-{Hour,Day,Total}-Remaining
  2. proaktivní backoff: když některý pool < RATE_LIMIT_LOW_THRESHOLD (5)
     → přibrzdit další request o RATE_LIMIT_BACKOFF_MS (30s)
  3. na 429 → jeden retry, respektovat Retry-After (cap 60s; delší re-queue sync)
  4. sdílený concurrency gate: max 3 souběžné requesty
```

Stránkování (`pagination.ts`): wrapper nese `number_of_pages` / `current_page`,
`paginateAll` iteruje (strop `MAX_PAGES = 1000`); `limit` umožní early-exit, aby
on-demand MCP request netáhl celou historii a nešetřil pool budget.

## 7. Express middleware order (mcp-server)

```typescript
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use('/health', healthRouter);
app.use('/mcp', mcpRouter);   // Bearer middleware: extractBearer → validateBearer → loadShop → tier gate
app.use(notFoundHandler);
app.use(errorHandler);
```

Webhook routy, které ověřují podpis nad raw body, musí být mountnuté **před** JSON
parserem (`express.raw`). Settings iframe routa **nesmí** posílat `X-Frame-Options`
(CSP `frame-ancestors` místo toho povolí admin doménu platformy).

## 8. Write model — okamžitý zápis + audit + revert

Žádná schvalovací fronta. Write tool s `confirm:"yes"` guardem provede **okamžitý**
zápis přes connector, `logWrite` zaloguje `before`/`after` do `write_log`
(status `applied`/`failed`). Revert přes `revert_write` / dashboard obnoví `before`
stav. Capabilities se **flipují per-akce až po live ověření** proti reálnému eshopu.
Detail: [../mcp/write-tools-and-audit.md](../mcp/write-tools-and-audit.md).

## 9. Reference

- `packages/platform-core` — `PlatformConnector`, capabilities, registry, neutrální typy
- `packages/upgates-client` — Upgates konektor (HTTP, webhook, signature, mappery)
- `packages/ecommerce-common` — platform-neutrální doménové typy
- `apps/mcp-server/src/connector-registry.ts` — mapování `shop.platform` → konektor
- Upgates API docs: https://upgatesapiv2.docs.apiary.io/
