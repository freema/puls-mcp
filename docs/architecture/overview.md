# Architektura — přehled

Puls je **dvě HTTP služby** sdílející Postgres a Redis. Jedna služba (`web`) drží UI, OAuth autorizační server, Admin API a webhook/install endpointy; druhá (`mcp`) drží MCP Streamable HTTP endpoint pro AI klienty.

## Vrstvy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  AI klient (Claude Desktop, ChatGPT, Cursor, Inspector, custom)              │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ HTTPS — Bearer + JSON-RPC (Streamable HTTP)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  apps/mcp-server (Express, port 3001)                                        │
│  • POST/GET/DELETE /mcp                — JSON-RPC tunnel, session per init   │
│  • GET /.well-known/oauth-protected-resource    (RFC 9728)                   │
│  • GET /.well-known/oauth-authorization-server  (mirror RFC 8414)            │
│  • Middleware: extractBearer → validateBearer → loadShopById → tier gate     │
└────────────┬───────────────────────────────────┬─────────────────────────────┘
             │ Drizzle (Postgres)                │ Bearer → token-bound shop
             │                                   ▼
             │                  ┌────────────────────────────────────┐
             │                  │  apps/web (React Router, port 3000)│
             │                  │  • OAuth AS: /oauth/{authorize,    │
             │                  │              register, token},     │
             │                  │              /auth/mcp-connect      │
             │                  │  • Marketing: /, /pricing, /blog,  │
             │                  │              /kontakt, /status      │
             │                  │  • Dashboard: /dashboard/:shopId/* │
             │                  │  • Admin: /admin/*                  │
             │                  │  • Upgates: /api/upgates/install,   │
             │                  │             /api/webhooks/upgates    │
             │                  │  • In-process scheduler (cron)      │
             │                  └──────────┬─────────────────────────┘
             │                             │
             ▼                             ▼
   ┌────────────────────┐      ┌────────────────────┐    ┌─────────────────────┐
   │  Postgres 16       │      │  Redis 7           │    │  Platforma (Upgates)│
   │  • shops, sessions │      │  • daily counters  │    │  (prod = real eshop │
   │  • OAuth tables    │      │  • per-shop activity    │    │   dev = Prism mock  │
   │  • mcp_tool_calls  │      │  • rate limit keys │    │   on port 4011)     │
   │  • write_log       │      │  • prompt cache    │    └─────────────────────┘
   │  • shop_memory*    │      └────────────────────┘
   │  • health_*, incidents
   │  • tier_assignments│
   │  • prompt_*        │
   └────────────────────┘
```

## End-to-end datový tok

### A. Install (e-shop aktivuje Puls z Upgates marketplace)
1. Upgates pošle aktivační callback na `/api/upgates/install` s identitou eshopu, API credentials (`apiUser`, `apiKey`, `apiUrl`) a podpisem `signature_v2`.
2. `app/routes/api.upgates.install.tsx` → handler v `packages/upgates-client` (`installer.ts`):
   - ověří `signature_v2` veřejným klíčem Upgates (RSA) — `signature.ts` / `signature-key.ts`
   - z `apiUrl` odvodí `domain`; z `/owner` lookupu doplní `adminEmail` (nebo párování dokončí uživatel přihlášením v iframu)
   - upsert do `shops` — multi-platform identita `(platform, external_id)` UNIQUE; `apiKey` ukládá **šifrovaně**, generuje `webhookSignatureKey` (per-shop secret) a `mcpEndpointSecret` (16B)
   - `assignTierOnInstall` (`lib/pricing.server.ts`) — první install → `trial` (14 dnů), reinstall → `starter` (anti-freeride přes unique partial index na `tier_assignments`)
3. Auth je **Basic** (`Authorization: Basic base64(apiUser:apiKey)`) — žádný OAuth token-exchange, žádné krátkodobé API tokeny.

### B. AI klient se chce připojit (OAuth handshake)
1. AI klient zavolá `GET /.well-known/oauth-authorization-server` (RFC 8414) → dostane `authorization_endpoint`, `token_endpoint`, `registration_endpoint`.
2. **DCR** (`POST /oauth/register`) — klient pošle `client_name` + `redirect_uris`, dostane `client_id`.
3. **Authorize** (`GET /oauth/authorize?response_type=code&client_id=...&code_challenge=...&code_challenge_method=S256`):
   - validuje vstup, uloží `oauth_pending_sessions` row, redirect na `/auth/mcp-connect?mcp_state=...`.
4. **Consent UI** (`/auth/mcp-connect`) — uživatel se přihlásí (jinak redirect na `/login`), vybere shop (z těch jeho) a tool kategorie (orders/products/customers/catalog/insights/write/memory).
5. POST → vygeneruje `authorization_code`, zapíše do `oauth_authorization_codes` (codeHash SHA-256, TTL 5 min, `disabled_tools` CSV), redirect na `redirect_uri?code=...&state=...`.
6. **Token exchange** (`POST /oauth/token`, content-type `application/x-www-form-urlencoded`):
   - validuje PKCE S256 (`SHA256(verifier).base64url === challenge`), validuje `redirect_uri` match
   - vydá Bearer (32B base64url, SHA-256 hash uložený v `oauth_access_tokens`, TTL 180 dní), kopíruje `disabled_tools` z auth code do tokenu.

### C. MCP volání (AI klient → Puls → platforma)
1. Klient pošle `POST /mcp` na `mcp-server:3001` s `Authorization: Bearer <puls_token>` a JSON-RPC payloadem.
2. `apps/mcp-server/src/index.ts:152` `handleMcp`:
   - `extractBearer` → `validateBearer` (lookup `oauth_access_tokens` by hash, kontrola expiry/revoked)
   - `loadShopById` (token nese `shopId`) → kontrola `status !== 'PAUSED'` (jinak 402 + zpráva o trial expiry)
   - `parseDisabledTools` z tokenu → vyrobí `Set<string>` zakázaných kategorií (legacy `null` → force-disable `write`)
   - `streamableMcpRequest` — pokud `initialize`, vyrobí novou MCP session (per-shop `McpServer`); jinak routuje JSON-RPC do existující session.
3. `createShopMcpServer` (`apps/mcp-server/src/puls-mcp.ts:71`):
   - načte tier (60s in-mem cache) → `withTierGate` wrapper kolem `server.tool` (kontroluje trial expiry + denní rate limit z Redisu)
   - načte memory (pokud `memory` consent on) → `withMemoryEnhancedDescriptions` injektuje memory context do tool descriptions
   - registruje tooly z povolených kategorií
4. Tool handler (`apps/mcp-server/src/tools/*.ts`):
   - **read tool** → volá platformový connector (`@puls/upgates-client`, axios klient s Basic auth + rate-limit backoff) → vrátí slim summary
   - **write tool** (`tools/writes.ts`) → `confirm:"yes"` guard → **okamžitý (synchronní) zápis** přes connector → `logWrite` zaloguje before/after do `write_log` (status `applied`/`failed`). Trial tier write tooly vůbec nemá (gate při registraci v `puls-mcp.ts`). Žádná fronta, žádný `auto_apply`.
5. `withRequestLogging` (`tools/usage.ts`) zaloguje volání do `mcp_tool_calls` a inkrementuje denní/per-shop counters v Redisu.

### D. Audit & revert (write tools)
1. Každý write tool zapíše do `write_log` řádek se statusem `applied` (nebo `failed`) a JSONB `before`/`after` snapshotem.
2. Uživatel vidí provedené zápisy v `/dashboard/:shopId/write-history` (list) a detail s diffem `before → after`.
3. **Revert:** nástroj `revert_write` (`tools/revert.ts`) nebo tlačítko „Vrátit" v dashboardu obnoví `before` stav přes connector a přepne status na `reverted`. Reverzibilní jsou `update_*` a `set_action_price`; `create_customer_note` nelze vrátit; `create_voucher` se deaktivuje, kde to platforma umí.
4. Mapování `before → connector call` je sdílená smlouva — `mapBeforeToPatch` je duplikovaný v `tools/revert.ts` i `dashboard.$shopId.write-history.$id.tsx` (při změně synchronizovat oba).

## Hosting model

- **Dev:** `docker compose up -d` — vše lokálně, mock-upgates (Prism) místo reálné platformy.
- **Prod:** Coolify (single replica), reálný platformový API endpoint (per-shop `apiBaseUrl` z aktivace).
- **Single instance** — in-process scheduler je intentional; pokud bude potřeba scale-out, přepneme na Postgres advisory-lock leader election.

## Klíčové soubory pro orientaci

| Téma | Cesta |
|---|---|
| MCP transport | `apps/mcp-server/src/index.ts` |
| MCP factory | `apps/mcp-server/src/puls-mcp.ts` |
| Bearer middleware | `apps/mcp-server/src/oauth/middleware.ts` |
| OAuth metadata | `apps/mcp-server/src/oauth/metadata.ts` |
| Tooly | `apps/mcp-server/src/tools/{orders,products,customers,catalog,insights,writes,revert,memory}.ts` |
| Tier gate | `apps/mcp-server/src/tier-gate.ts` |
| OAuth AS — authorize | `apps/web/app/routes/oauth.authorize.tsx` |
| OAuth AS — consent | `apps/web/app/routes/auth.mcp-connect.tsx` |
| OAuth AS — token | `apps/web/app/routes/oauth.token.tsx` |
| OAuth AS — DCR | `apps/web/app/routes/oauth.register.tsx` |
| Upgates aktivace | `apps/web/app/routes/api.upgates.install.tsx` |
| Upgates webhook | `apps/web/app/routes/api.webhooks.upgates.tsx` |
| Scheduler boot | `apps/web/app/lib/scheduler.server.ts` |
| Cron joby | `apps/web/app/lib/cron/{health-pinger,trial-expiry}.server.ts` |
| Platform connector | `packages/upgates-client/src/{connector,http,webhook,*.ts}` |
| Connector registry | `apps/mcp-server/src/connector-registry.ts` |
| DB schema | `packages/db/src/schema.ts` |
