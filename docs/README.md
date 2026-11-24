# Puls MCP — dokumentace

> Interní pracovní název. Veřejný brand: **Puls** (doména **pulsmcp.com**).
> Jeden monorepo, dvě běžící služby (`apps/web` + `apps/mcp-server`), Postgres + Redis + Prism mocky platforem (Shoptet, Upgates).

Tato složka obsahuje **kompletní popis chování systému** pro:

- **reviewery platforem** (Shoptet a Upgates marketplace, Claude Connector Directory), kteří doplněk schvalují
- **vývojáře, kteří se přidají do projektu** a potřebují onboarding
- **provoz** (deployment, runbook, incident response)

---

## Mapa dokumentace

### 🧭 Přehled
- [`architecture/overview.md`](architecture/overview.md) — vrstvy systému, datový tok install → MCP volání
- [`architecture/service-map.md`](architecture/service-map.md) — docker-compose topologie a porty
- [`architecture/database.md`](architecture/database.md) — Drizzle schema, FK graf, migrace
- [`architecture/scheduler-and-jobs.md`](architecture/scheduler-and-jobs.md) — in-process scheduler, cron joby, externí trigger
- [`architecture/patterns.md`](architecture/patterns.md) — platform connector & Upgates implementační vzory

### 🔌 MCP server
- [`mcp/overview.md`](mcp/overview.md) — `/mcp` endpoint, Streamable HTTP, sessions, error handling
- [`mcp/tools-reference.md`](mcp/tools-reference.md) — kompletní seznam toolů (neutrální jména, sdílené napříč platformami) s parametry a chováním
- [`mcp/write-tools-and-audit.md`](mcp/write-tools-and-audit.md) — write toolset, okamžitý zápis + audit log + revert, tier gating
- [`mcp/consent-categories.md`](mcp/consent-categories.md) — 7 consent kategorií, co každá odemyká
- [`mcp/memory.md`](mcp/memory.md) — per-shop memory (preferences + learned context)

### 🔐 OAuth 2.1
- [`oauth/overview.md`](oauth/overview.md) — celý handshake DCR → authorize → consent → token
- [`oauth/discovery.md`](oauth/discovery.md) — `.well-known/oauth-*` metadata endpointy (RFC 8414, RFC 9728)
- [`oauth/authorize-and-consent.md`](oauth/authorize-and-consent.md) — `/oauth/authorize` + `/auth/mcp-connect` consent UI
- [`oauth/token-exchange.md`](oauth/token-exchange.md) — `/oauth/token` (PKCE S256, authorization_code grant)
- [`oauth/token-binding.md`](oauth/token-binding.md) — token = (user, shop, scope, disabled_tools)

### 🛒 Platformová integrace — Shoptet
- [`shoptet/install-flow.md`](shoptet/install-flow.md) — OAuth install handshake (`POST /api/install?code=…`), upsert shopu, tier přiřazení
- [`shoptet/api-client.md`](shoptet/api-client.md) — `@puls/shoptet-client`: OAuth/API token cache, retry (401/423/429), mock Prism
- [`shoptet/webhooks.md`](shoptet/webhooks.md) — `POST /api/webhooks`, `Shoptet-Webhook-Signature` (HMAC-SHA1), idempotency
- Konektor: [`../packages/shoptet-client/`](../packages/shoptet-client/) — capabilities `SHOPTET_CAPABILITIES` (`packages/platform-core`)

### 🛒 Platformová integrace — Upgates
- [`../TECH-BRIEF.md`](../TECH-BRIEF.md) ↗ — technický brief Upgates API (auth, aktivace, webhooks, rate limits) v kořeni repo
- Aktivace: [`../apps/web/app/routes/api.upgates.install.tsx`](../apps/web/app/routes/api.upgates.install.tsx) — ověření `signature_v2`, uložení per-shop credentials
- Webhooky: [`../apps/web/app/routes/api.webhooks.upgates.tsx`](../apps/web/app/routes/api.webhooks.upgates.tsx) — `X-Upgates-Webhook-Secret`, ID-list payload, idempotency
- Konektor: [`../packages/upgates-client/`](../packages/upgates-client/) — HTTP klient (Basic auth, rate-limit backoff), webhook verify, capabilities

### 🌐 Web
- [`web/README.md`](web/README.md) — kompletní inventář route + komponent
- [`web/auth.md`](web/auth.md) — login flow (magic link + Google OIDC), session cookie
- [`web/client-dashboard.md`](web/client-dashboard.md) — `/dashboard/:shopId/*` — přehled, tools, activity, write-history (audit), connections
- [`web/admin.md`](web/admin.md) — `/admin/*` — Overview, Shops, Pricing, Logs, Webhooks, API Keys, Emails, Prompts, System, Incidenty
- [`web/settings-iframe.md`](web/settings-iframe.md) — `/settings/:shopId` (iframe v adminu Shoptetu / Upgates)
- [`web/design-client-dashboard.md`](web/design-client-dashboard.md), [`web/design-admin-dashboard.md`](web/design-admin-dashboard.md) — design briefy

### 🧪 Testování
- [`testing/overview.md`](testing/overview.md) — přehled vrstev (unit, e2e), pravidla
- [`testing/e2e.md`](testing/e2e.md) — Playwright spec mapa, helpers, debugging
- [`testing/login-bypass.md`](testing/login-bypass.md) — jak v testech (i lokálně) obejít magic link

### ⚙️ Provoz
- [`operations/compose.md`](operations/compose.md) — docker-compose detail, healthcheck, profily
- [`operations/env.md`](operations/env.md) — kompletní seznam ENV proměnných
- [`operations/admin-api.md`](operations/admin-api.md) — public Admin API (`/api/admin/*`) s API klíči

---

## Quick links

| Co | Kde |
|---|---|
| Globální setup | [`../README.md`](../README.md) — quickstart, `task dev`, `task e2e` |
| Platformový API brief | [`../TECH-BRIEF.md`](../TECH-BRIEF.md) (Upgates), [`shoptet/`](shoptet/) (Shoptet) |
| OpenAPI mock spec | [`../spec/shoptet-openapi.json`](../spec/shoptet-openapi.json), [`../spec/upgates-openapi.json`](../spec/upgates-openapi.json) |
| Drizzle migrace | [`../apps/web/drizzle/migrations/`](../apps/web/drizzle/migrations/) |
| MCP tooly | [`../apps/mcp-server/src/tools/`](../apps/mcp-server/src/tools/) |

---

## Glosář

| Pojem | Význam |
|---|---|
| **MCP** | Model Context Protocol — Anthropic spec pro propojení AI klientů s nástroji. Klienti: Claude Desktop, ChatGPT, Cursor, Continue. |
| **DCR** | Dynamic Client Registration (RFC 7591) — MCP klient se sám zaregistruje, dostane `client_id`, hned může jet OAuth flow. |
| **PKCE S256** | Proof Key for Code Exchange (RFC 7636) — nahrazuje `client_secret` u public klientů (mobile/CLI). |
| **externalId** | Identifikátor e-shopu z platformy (multi-platform identita `(platform, external_id)` UNIQUE). U Shoptetu `String(project.id)`, u Upgates identifikátor eshopu z aktivačního payloadu. |
| **mcpEndpointSecret** | 16B hex per-shop, uložený v `shops.mcpEndpointSecret`. **Dnes** se nepoužívá v URL (URL je generická `/mcp`); zachováno pro budoucí per-shop endpoint variantu. |
| **API credentials (Upgates)** | Per-shop `apiUser` + `apiKey` z aktivace; Basic auth (`Authorization: Basic base64(apiUser:apiKey)`). Žádný token-exchange ani expiry — `apiKey` ukládáme šifrovaně. |
| **OAuth / API token (Shoptet)** | Permanentní OAuth access token z install handshake (`shops.oauth_access_token`) + krátkodobý (30 min) API token cachovaný v `api_token_cache`. |
| **apiBaseUrl** | Per-eshop endpoint z aktivace (`apiUrl`). Base pro všechna volání platformového API. |
| **MCP Bearer (puls)** | Token, který Puls vydá AI klientovi po consent flow. SHA-256 hash v `oauth_access_tokens`, TTL 180 dní. |
| **Write log** | Audit záznam okamžitého zápisu (tabulka `write_log`, status `applied`/`reverted`/`failed`) — schvalovací fronta zrušena, místo ní revert přes `revert_write` / dashboard. |
| **Tier** | Pricing plán (`trial`, `starter`, `pro`, `business`) — řídí calls/day, memory, retention, write tools. |
