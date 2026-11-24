# E2E testing — Playwright

> **🚨 NIKDY nespouštět z hostu.** Vždy přes `task e2e` (compose profile `e2e`). Hostová síť maskuje regrese (rozdílné hostnamy `app:3000` vs `localhost:13000`, různé `node_modules` volumes).

Detail vrstev v [overview.md](overview.md). Tady mapy spec → flow + helper guide.

## Tasks (Taskfile.yaml)

| Task | Co spustí |
|---|---|
| `task e2e` | Plná Playwright sada (~63 testů, ~1 min). |
| `task e2e:oauth` | `install.spec.ts` + `mcp-oauth.spec.ts` + `mcp-tools.spec.ts` + `full-flow.spec.ts`. Rychlý loop pro auth/MCP. |
| `task e2e:flow` | Jen `full-flow.spec.ts` (smoke). |
| `task e2e:ui` | Playwright UI mode v containeru, host port 9323. |

Všechny běží pod `docker compose --profile e2e run --rm e2e ...`. Compose service `e2e` má `depends_on: { app, mcp }` healthchecks.

## Spec → flow mapa

| Spec | Vrstva | Co dělá |
|---|---|---|
| `install.spec.ts` | Shoptet install | `POST /api/install?code=mock_<random>` → ověří `shops` row, OAuth token (mock Shoptet OAuth), idempotentní reinstall. |
| `webhook.spec.ts` | Webhooks | Pošle webhook s validním HMAC → ověří `webhook_notifications` row. Negative: chybný HMAC → 401. |
| `healthz.spec.ts` | Health | GET `/healthz` → `{ ok: true }`. |
| `homepage.spec.ts` | Marketing | Všechny `data-testid` viditelné, mobile snapshot (viewport 375). |
| `client-dashboard-empty.spec.ts` | Dashboard | Empty state když user nemá žádný shop. |
| `iframe-embed.spec.ts` | Iframe | Embed funguje, `[data-testid="open-full-dashboard"]` viditelný. |
| `admin.spec.ts`, `admin-auth.spec.ts`, `admin-shops.spec.ts`, `admin-tool-logs.spec.ts` | Admin | Auth gate (non-admin → /dashboard), shop list, tool log filters. |
| `mcp-oauth.spec.ts` | MCP OAuth | DCR → `/oauth/authorize` → consent → token exchange (PKCE S256). + PKCE negative test + discovery probe sanity. |
| `mcp-tools.spec.ts` | MCP tools | `tools/list` filter podle scopes, `tools/call list_orders`, anonymní 401. |
| `mcp-tools-upgates.spec.ts` | MCP tools (Upgates) | Stejné neutrální nástroje proti `mock-upgates` — ověří multi-platform parity a graceful degradaci write kategorie. |
| `mcp-write-tools.spec.ts` + `mcp-write-tools-v2.spec.ts` | MCP writes (immediate + audit + revert) | Okamžitý zápis → `write_log` audit (`applied`) → `revert_write` → `reverted`; `confirm:"yes"` guard; trial nemá write tooly v `tools/list`. (v2 je plně na novém modelu.) |
| `mcp-insights.spec.ts` | MCP insights | `sales_summary`, `low_stock`, `top_customers` end-to-end. |
| `mcp-memory.spec.ts` | MCP memory | `memory_set` → `memory_get` → enhanced descriptions, memory disable behavior. |
| `mcp-resources-prompts.spec.ts` | MCP resources | `resources/list`, `resources/read`, `prompts/list`, `prompts/get`. |
| `full-flow.spec.ts` | End-to-end | Install → seeded login → MCP OAuth → SDK klient zavolá `list_orders`. |
| `status-page.spec.ts` | Status | Public render, components, daily strip, admin CRUD incidentů. |
| `prompt-gallery.spec.ts` | Prompts | List, search, detail, "Use" form, tier gate, sitemap. |

## Helpery

`tests-e2e/helpers/`:

| Soubor | Použití |
|---|---|
| `db.ts` | Přímé DB queries (shop row, webhook table). Pg client. |
| `session.ts` | `seedBrowserSession({ databaseUrl, email })` — vytvoří user + session row v DB, vrátí `{ token }`. |
| `seed-session-cookie.ts` | `loginViaSeed({ context, ... })` — wrapper co setne `puls_session` cookie do BrowserContextu. |
| `install.ts` | `installShopViaApi({ baseUrl, databaseUrl, adminEmail })` — install + override `adminEmail` (aby seeded user shop viděl v consent UI). |
| `mint-token.ts` | Vyrobí Bearer token přímo v DB pro testování `/mcp` bez OAuth flow (rychlejší). |
| `oauth.ts` | `dcrRegister`, `generatePkcePair`, `performAuthorizeAndConsent` (Playwright driver consent UI), `exchangeAuthCode`, `discoverAuthServer` (s container-origin rewrite). |
| `mcp.ts` | `connectMcpClient()` — `@modelcontextprotocol/sdk` klient přes Streamable HTTP s Bearerem. |
| `hmac.ts` | `signWebhook(rawBody, key)` — HMAC-SHA1 hex pro webhook test. |
| `write-log.ts` | `getWriteLog`, `listWriteLogForShop`, `latestWriteLogForShop`, `deleteWriteLogForShop`, `setShopTier` — práce s `write_log` audit tabulkou + cleanup mezi sub-testy. |
| `health-pings.ts` | Cleanup helpers pro status page testy. |
| `prompts.ts` | Test factory pro prompt rows (insert + cleanup). |

## Driver pro consent UI

[`oauth.ts:performAuthorizeAndConsent`](../../tests-e2e/helpers/oauth.ts) ovládá Playwright na `/auth/mcp-connect`:

1. Hooks `page.route(redirectMatcher)` + `page.on('request')` na `redirect_uri` — **dvě vrstvy capture**, protože Remix někdy posílá form přes SPA `.data` fetch (s JS redirectem na `redirect_uri`), jindy plain HTML POST + 302 který browser sleduje (a my musíme zachytit URL než selže ECONNREFUSED na neexistujícím `localhost:9999`).
2. `page.click(allowButton, { noWaitAfter: true })` — aby se neblokovalo čekání na navigation completion která nikdy nepřijde.
3. `redirect_uri` v testech je `http://localhost:9999/cb` — jen úložiště pro `code` v query stringu, nic na něm neběží.
4. Cookie consent banner ("Rozumím") se před kliknutím dismissne (best-effort), protože překrýval submit button.
5. Loop until captured nebo timeout 15s.

## Container-origin rewrite

V e2e běží Playwright v containeru, který nezná `localhost:13000` (host port). MCP discovery vrací URL s `localhost:13000`, ale klient potřebuje `app:3000` (compose síť).

[`oauth.ts:rewriteToContainerOrigin`](../../tests-e2e/helpers/oauth.ts:73) přepíše `localhost:*` URL z metadata na `BASE_URL_WEB` (= `http://app:3000` v compose env). Real klienti to nepotřebují.

## Mock Shoptet / Mock Upgates

`docker compose up mock-shoptet` (Stoplight Prism nad `spec/shoptet-openapi.json`) a `mock-upgates` (Prism nad `spec/upgates-openapi.json`) běží paralelně. Vrací `example` payloady deterministicky. `mcp-tools-upgates.spec.ts` jede proti `mock-upgates`, ostatní MCP specs proti `mock-shoptet`.

**Známé pasti:**
- **Stejný `eshopId` pro všechny instally** v testech — sdílí jeden `shops` row mezi paralelními subtest blocks. Cleanup: `deleteWriteLogForShop(dbUrl, shopId)` před kritickými assertions.
- **Prism cachuje spec** — po editu OpenAPI musíš `docker compose restart mock-shoptet`.

## Magic-link bypass

Login přes e-mail kód není deterministický (kód jde do SMTP / Resend). Místo procházení emailu jdeme přes `seedBrowserSession()` co vloží user + session row do DB a vrátí token. Detail v [login-bypass.md](login-bypass.md).

## Common failures & fixes

| Symptom | Příčina | Fix |
|---|---|---|
| `OAuth ECONNREFUSED ::1:13000` | MCP discovery vrátil host URL, e2e container nedosáhne | `rewriteToContainerOrigin` v `oauth.ts` |
| `mcp-oauth set assertion stale` | Test očekával `{products, customers}` ale UI má 5 nových | Update assertion: `{products, customers, insights, write, memory}` |
| `iframe-embed open-full-dashboard timeout` | Komponenta neměla `data-testid` | Přidat `data-testid="open-full-dashboard"` na `<a>` v `embed-chrome.tsx` |
| Write spec polluce | Mock vrací stejné `eshopId` → shop sdílený → `write_log` řádky z jiného subtestu | `deleteWriteLogForShop(dbUrl, shopId)` před assertion |
| `admin status incident timeout` | Public `/status` má `Cache-Control: max-age=30` → browser cachuje | `await page.goto('/status?_=' + Date.now())` cache-bust |
| `Migration not applied` | Drizzle čte `_journal.json`, ne raw `.sql` | Přidat entry do `_journal.json` po každé nové migraci |
| `LOG_LEVEL: must be included in custom levels` | Compose `LOG_LEVEL: ${LOG_LEVEL:-}` = empty string, `??` neuchytí | `(process.env.LOG_LEVEL \|\| undefined) ??` v logger init |

## Debugging

```bash
task e2e:ui                                    # Playwright UI mode na port 9323
docker compose logs -f app mcp                 # tail logy během testu
docker compose exec app sh                     # shell v app containeru
docker compose exec postgres psql -U puls puls # SQL prompt
```

`DEBUG_E2E=1` env var v `oauth.ts` zapíná verbose logging (request/response/console).
