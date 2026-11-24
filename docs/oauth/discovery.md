# OAuth discovery endpointy

MCP klienti začínají bez znalosti našich URL — jediné, co znají, je MCP endpoint URL (`/mcp`). Z něj přes `.well-known` zjistí všechno ostatní.

## Endpointy

### `GET /.well-known/oauth-protected-resource` (RFC 9728)

Vystavuje **MCP server** (port 3001) i **web** (port 3000), protože MCP klient se na něj může zeptat na obě.

Code: [`apps/mcp-server/src/oauth/metadata.ts:20`](../../apps/mcp-server/src/oauth/metadata.ts), [`apps/web/app/routes/well-known.oauth-protected-resource.tsx`](../../apps/web/app/routes/well-known.oauth-protected-resource.tsx).

```json
{
  "resource": "https://pulsmcp.com",
  "authorization_servers": ["https://pulsmcp.com"],
  "scopes_supported": ["mcp:read", "mcp:write"],
  "bearer_methods_supported": ["header"]
}
```

- `resource` = MCP origin (kde běží `/mcp` endpoint)
- `authorization_servers[0]` = AS origin (kde běží `/oauth/*`)
- V dev compose: `resource = http://localhost:13001`, `authorization_servers = ["http://localhost:13000"]`

### `GET /.well-known/oauth-authorization-server` (RFC 8414)

Vystavuje **MCP server** (mirror) i **web** (canonical).

Code: [`apps/mcp-server/src/oauth/metadata.ts:32`](../../apps/mcp-server/src/oauth/metadata.ts), [`apps/web/app/routes/well-known.oauth-authorization-server.tsx`](../../apps/web/app/routes/well-known.oauth-authorization-server.tsx).

```json
{
  "issuer": "https://pulsmcp.com",
  "authorization_endpoint": "https://pulsmcp.com/oauth/authorize",
  "token_endpoint": "https://pulsmcp.com/oauth/token",
  "registration_endpoint": "https://pulsmcp.com/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["mcp:read", "mcp:write"]
}
```

## Origin resolution

```ts
function publicOrigin(req): string {
  const fromEnv = process.env.MCP_PUBLIC_ORIGIN?.trim();   // RS — mcp-server
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Fallback: derive from request headers
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || 'localhost:3001';
  return `${proto}://${host}`;
}

function authServerOrigin(req): string {
  const fromEnv = process.env.WEB_PUBLIC_ORIGIN?.trim();   // AS — web
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return publicOrigin(req);
}
```

V production stack ENV proměnné `MCP_PUBLIC_ORIGIN=https://pulsmcp.com` a `WEB_PUBLIC_ORIGIN=https://pulsmcp.com` zajistí konzistentní origin (oba pod stejnou doménou, různé path prefix).

## Container-aware rewriting (v testech)

V e2e testech běží Playwright v containeru, který nemá síťový přístup na `localhost:13000`. Proto helper [`tests-e2e/helpers/oauth.ts:rewriteToContainerOrigin`](../../tests-e2e/helpers/oauth.ts) přepíše advertised `localhost:*` URL z discovery na `BASE_URL_WEB` (= `http://app:3000` v compose síti).

Real klient (Claude Desktop, Cursor) řeší endpoints přes svůj host, takže žádný rewriting nepotřebuje.

## Probe sanity check

V testu [`mcp-oauth.spec.ts:16`](../../tests-e2e/tests/mcp-oauth.spec.ts) probíhá kontrola, že `authorization_endpoint` advertised v metadata **opravdu odpovídá** (ne 404). Důvod: bug, kde MCP advertise URL na host, kde route neexistuje, by se projevil v Inspectoru jako "Cannot GET /oauth/authorize" — nechceme to mít skryté.

## Workflow klienta

```
Client                      MCP RS                AS
  │ 1. POST /mcp init        │                      │
  │   no Bearer              │                      │
  │ ◄── 401 + WWW-Authenticate: Bearer resource_metadata="..."
  │                          │                      │
  │ 2. GET resource_metadata URL                    │
  │ ◄── { authorization_servers: [AS], ... }        │
  │                          │                      │
  │ 3. GET <AS>/.well-known/oauth-authorization-server
  │ ─────────────────────────────────────────────► │
  │ ◄── { authorization_endpoint, registration_endpoint, ... }
  │                                                 │
  │ 4. (DCR ⇒ authorize ⇒ consent ⇒ token, viz overview.md)
```

Tj. klient z jednoho `/mcp` URL vyjde, najde RS metadata → AS metadata → DCR → fully-functional flow. **Zero config** od uživatele kromě "přidat MCP server: https://pulsmcp.com/mcp".
