# Testing

Tři vrstvy testů. **E2E se spouští výhradně v containeru přes Taskfile** — nikdy ne `pnpm exec playwright test` z hostu.

## Vrstvy

| Vrstva | Kde | Spouští se | Co testuje |
| --- | --- | --- | --- |
| Unit | `apps/web/tests/`, `apps/mcp-server/tests/`, `packages/*/tests/` | `task test` (přes containery) | Funkce, route handlery, klient s mock fetchem. |
| Shoptet client | `packages/shoptet-client/tests/` | `task test` | OAuth helper, axios klient, HMAC, token cache. |
| E2E | `tests-e2e/tests/` | `task e2e` (compose profil `e2e`) | Plný stack: web + mcp + postgres + redis + Prism mock Shoptetu. |

## E2E — pravidla

> **🚨 Nikdy nespouštět z hostu.**
>
> Compose profile `e2e` má pevně dané hostnamy `app:3000`, `mcp:3001` a vlastní `node_modules` volume. Lokální run skrz `localhost:13000` může projít jinak než CI a maskovat regresi (síťová izolace, hostname rozdíly). Vždy `task e2e` nebo některý cíl z `e2e:*`.

### Cíle

| Task | Co spustí |
| --- | --- |
| `task e2e` | Celá Playwright sada v compose profilu `e2e`. |
| `task e2e:oauth` | Jen OAuth flow + install + tool execution (7 testů). Rychlá smyčka pro práci na MCP/auth. |
| `task e2e:flow` | Jen `full-flow.spec.ts` smoke (1 test). |
| `task e2e:ui` | Playwright UI mode v containeru (host port 9323). |

### Specy

| Spec | Vrstva flow | Co dělá |
| --- | --- | --- |
| `install.spec.ts` | 1. Shoptet install | `POST /api/install?code=mock_…` → web volá Prism mock OAuth + `/eshop` → shop row v DB. |
| `mcp-oauth.spec.ts` | 3. MCP OAuth | DCR → `/oauth/authorize` → Playwright klikne consent → token exchange (PKCE S256). Plus PKCE negative test. |
| `mcp-tools.spec.ts` | 4. Tool execution | `tools/list` filter podle scopes, `tools/call list_orders`, anonymní 401. |
| `full-flow.spec.ts` | 1 → 4 | Smoke: install → seeded login → MCP OAuth → SDK klient zavolá `list_orders`. |
| `install.spec.ts`, `webhook.spec.ts`, `healthz.spec.ts`, `homepage.spec.ts`, `admin*.spec.ts`, `iframe-embed.spec.ts`, `client-dashboard-empty.spec.ts` | Existující | Pre-Sprint-3 testy; některé jsou aktuálně červené kvůli probíhajícímu UI rewriteu. |

### Helpery

`tests-e2e/helpers/`:

| Soubor | Použití |
| --- | --- |
| `db.ts` | Querování shop row, webhook tabulky. |
| `session.ts` | `seedBrowserSession()` — vytvoří user + session token přímo v DB (bypassuje magic-link e-mail). |
| `seed-session-cookie.ts` | `loginViaSeed()` — wrapper co setne `puls_session` cookie do BrowserContextu. |
| `install.ts` | `installShopViaApi()` — install + override `adminEmail` (aby seeded user shop viděl v consent UI). |
| `oauth.ts` | `dcrRegister`, `generatePkcePair`, `performAuthorizeAndConsent` (Playwright driver consent UI), `exchangeAuthCode`. |
| `mcp.ts` | `connectMcpClient()` — `@modelcontextprotocol/sdk` klient přes Streamable HTTP s Bearerem. |
| `hmac.ts` | Webhook HMAC podpis. |

### Driver pro consent UI

`performAuthorizeAndConsent()` ovládá Playwright na `/auth/mcp-connect`:

- Hooks `page.route` + `page.on('request')` na `redirect_uri`. Dvě vrstvy capture protože Remix někdy posílá form přes SPA `.data` fetch (s JS redirectem na `redirect_uri`), jindy plain HTML POST + 302 který browser sleduje (a my musíme zachytit URL než selže ECONNREFUSED na neexistujícím `localhost:9999`).
- `page.click(..., { noWaitAfter: true })` aby se nezablokovalo čekání na navigation completion která nikdy nepřijde.
- `redirect_uri` v testech je `http://localhost:9999/cb` — jen úložiště pro `code` v query stringu, nic na něm neběží.

### Magic-link bypass

Login code je hashovaný v Redisu, takže ho z testu nelze zpětně získat. Místo procházení e-mailu jdeme přes `seedBrowserSession()` co vloží user + session row do DB a vrátí token. Cookie `puls_session` se potom nastaví do BrowserContextu. To pokrývá co potřebujeme — UI consent screen vidíme, OAuth code session je validní.

Samostatný test pro magic-link UI flow zatím neexistuje (mailovací kód deterministicky vytáhnout znamená přidat dev-only endpoint `/__test/last-mail-code` nebo MailHog do compose; ne zatím prioritní).

## Schema migrace

Drizzle migrations v `apps/web/drizzle/migrations/` se aplikují automaticky při startu `app` containeru (entrypoint volá `drizzle-kit migrate`). Když přidáš sloupec do `packages/db/src/schema.ts`, vygeneruj migraci přes `task db:generate`.

## Mock Shoptet

Compose service `mock-shoptet` = Stoplight Prism nad `spec/shoptet-openapi.json`. Vrací `example` payloady z OpenAPI specu (deterministicky, stateless). Když potřebuješ jiný response, edituj OpenAPI example.
