# MCP server — přehled

Puls vystavuje **jediný MCP endpoint `/mcp`** (žádné per-shop URL). Shop a povolené tool kategorie jsou zakódované v Bearer tokenu vydaném po OAuth/consent flow. Tj. AI klient drží **jeden Bearer per (user, shop, consent set)** a stejný `/mcp` URL používá pro všechny shopy — switch mezi shopy = nový OAuth flow.

## Endpoint

| Method | Path | Účel |
|---|---|---|
| `POST /mcp` | JSON-RPC request (tool call, list, initialize) | Hlavní transport |
| `GET /mcp` | SSE stream pro server-side notifications | Streamable HTTP |
| `DELETE /mcp` | Session close | Klient korektně ukončí session |
| `GET /health` | `{ ok: true }` | Liveness probe |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata | Discovery (resource server) |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 mirror | Discovery (auth server, viz [oauth/discovery.md](../oauth/discovery.md)) |

Code: [`apps/mcp-server/src/index.ts`](../../apps/mcp-server/src/index.ts)

## Transport: Streamable HTTP

Implementace `@modelcontextprotocol/sdk/server/streamableHttp.js` (`StreamableHTTPServerTransport`):

- **Initialize handshake**: první `POST /mcp` musí být `initialize` JSON-RPC. Server vyrobí session ID (UUID) a vrátí ho v `Mcp-Session-Id` header.
- **Subsequent requests**: každý další `POST /mcp` musí poslat `Mcp-Session-Id` header → server routuje do existující session.
- **Session not found**: pokud klient pošle session ID, který server nezná (např. po restartu), vrátí JSON-RPC error `-32002` "Session not found. The server may have restarted. Please reconnect." → klient má zavolat `initialize` znovu.
- **Stale init**: pokud klient pošle `initialize` s `Mcp-Session-Id` header, server přesto vyrobí novou session (handshake má prioritu).

## Authorization

Code: [`apps/mcp-server/src/oauth/middleware.ts`](../../apps/mcp-server/src/oauth/middleware.ts)

```ts
extractBearer(req)            // header "Authorization: Bearer <token>"
  → validateBearer(db, bearer) // SELECT oauth_access_tokens WHERE token_hash = sha256(bearer) AND expires_at > now() AND revoked_at IS NULL
  → loadShopById(db, shopId)   // shop musí ještě existovat
  → if status === 'PAUSED' → 402 + zpráva o trial expiry
  → parseDisabledTools(token.disabledTools)  // CSV → Set<string>
  → createShopMcpServer(shop, db, disabledTools)
```

### 401 Unauthorized

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://pulsmcp.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="..."

{"jsonrpc":"2.0","error":{"code":-32001,"message":"invalid_token"},"id":null}
```

`WWW-Authenticate` header obsahuje `resource_metadata` (RFC 9728) — MCP klienti to umí použít k auto-discovery a spuštění OAuth flow bez user input.

### Legacy tokens (před consent UI)

Tokens vydané před zavedením consent kategorií mají `disabled_tools = NULL`. `parseDisabledTools` to interpretuje jako **opt-in striktní** → automaticky se přidá `'write'` do disabled (tj. legacy token nikdy nedostane mutating tools, dokud uživatel neudělá nový OAuth flow s explicit consent).

## Per-request session lifecycle

```
POST /mcp { initialize, ... }
  ├─ extractBearer / validateBearer / loadShopById
  ├─ createShopMcpServer(shop, db, disabledTools)
  │   ├─ withMemoryEnhancedDescriptions  (pokud memory consent on)
  │   ├─ withTierGate                    (rate limit + tier checks)
  │   ├─ registerOrdersTools (pokud consent)
  │   ├─ registerProductsTools
  │   ├─ registerCustomersTools
  │   ├─ registerCatalogTools
  │   ├─ registerInsightsTools
  │   ├─ registerWriteTools             (NE pokud trial — anti-freeride)
  │   ├─ registerMemoryTools            (pokud memory consent on a memory enabled v shopu)
  │   ├─ registerShopResources          (vždy)
  │   └─ registerShopPrompts            (vždy)
  └─ StreamableHTTPServerTransport → handleRequest
       └─ uloží session do shopSessions map (key = sessionId, value = { transport, server })
```

Pozn.: server instance je per-session, nikoli per-shop. Dvě paralelní AI session na ten samý shop = dvě `McpServer` instance.

## Tier gate

Code: [`apps/mcp-server/src/tier-gate.ts`](../../apps/mcp-server/src/tier-gate.ts)

`withTierGate(server, shop, tier)` přepíše `server.tool(...)` registraci tak, aby každý tool handler před voláním zkontroloval:

1. **Trial expirace** — pokud `tier.isTrial && shop.trialEndsAt <= now` → `text "Zkušební období Puls vypršelo. Aktivujte placený tarif na pulsmcp.com." isError=true`.
2. **Premium tools whitelist** — `tier.unlocksTools` (dnes prázdné, future-proof).
3. **Daily rate limit** — Redis key `puls:rl:mcp-shop:<shopId>:<YYYY-MM-DD>`, `INCR` + první call `EXPIRE` na 24h. Pokud `n > tier.callsPerDay` → `text "Denní limit X volání pro tarif "Y" je vyčerpán." isError=true`.
   - **Fail-open**: pokud Redis nedostupný, povolí volání (nelámeme funkčnost na infra výpadku, jen logujeme).

## Tool registration filter

V `createShopMcpServer`:

```ts
if (!disabledTools.has('orders'))    registerOrdersTools(server, shop, db);
if (!disabledTools.has('products'))  registerProductsTools(server, shop, db);
if (!disabledTools.has('customers')) registerCustomersTools(server, shop, db);
if (!disabledTools.has('catalog'))   registerCatalogTools(server, shop, db);
if (!disabledTools.has('insights'))  registerInsightsTools(server, shop, db);
const trialBlocksWrites = tier?.isTrial === true;
if (!disabledTools.has('write') && !trialBlocksWrites) registerWriteTools(...)
if (!disabledTools.has('memory') && memory !== null)   registerMemoryTools(...)
```

Tj. `tools/list` vrací **jen kategorie, které uživatel povolil** + (write) **trial tier nemá write tools v listingu vůbec**.

## Memory enhancement

Pokud má shop `shop_memory` row (memory enabled v dashboardu), MCP factory wrapne `server.tool` tak, aby každá tool description obsahovala přidaný kontext z paměti shopu. Příklad:

```
Original: "List recent orders. Returns slim row per order..."
Enhanced: "List recent orders. Returns slim row per order...\n\n[Shop context: User prefers last_30_days reporting window. Default order status filter: 'paid'.]"
```

Detail v [`mcp/memory.md`](memory.md).

## Resources & Prompts

- **Resources** (`apps/mcp-server/src/resources.ts`) — vystavuje `puls://eshop/info`, `puls://catalog/categories`, `puls://catalog/warehouses` jako MCP resources (dají se číst přes `resources/read`). Není to gated consent UI — jsou to read-only metadata.
- **Prompts** (`apps/mcp-server/src/prompts.ts`) — registruje pre-built MCP prompts (templates) pro běžné business otázky. Stejné téma, ale jiný surface než **prompt galerie** v `/prompts` (ta je veřejné UI s markdown body).

## Error handling

Wrapper handlerů (`apps/mcp-server/src/tools/usage.ts:withRequestLogging`):

1. Spustí handler → catch.
2. Pokud throw → zalogovat do `mcp_tool_calls` se status `error` + `errorMessage`, recordovat v Redis daily counter, znovu hodit (klient dostane JSON-RPC error).
3. Pokud handler vrátí `{ isError: true, content: [...] }` → zalogovat status `error` + extrahovaný `error` text z JSON content, vrátit klientovi (klient dostane normal `tools/call` response s `isError: true`).
4. Pokud OK → zalogovat `ok`, vrátit content.

Sentry capture (pokud `SENTRY_DSN`) běží na `unhandledRejection`, `uncaughtException`, a uvnitř `streamableMcpRequest` / `handleMcp` (tag `component: <name>`).

## Connect z Inspector / Claude Desktop

```bash
task inspector            # spustí mcp-inspector na lokále
# Inspector → Add MCP server → http://localhost:13001/mcp
# Authorization: Bearer <token>     ← získaný z OAuth flow nebo ručně vytvořený
```

Detail viz [oauth/overview.md](../oauth/overview.md) — stejný flow jede Claude Desktop, Cursor, Continue.
