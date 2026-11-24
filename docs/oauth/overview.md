# OAuth 2.1 — kompletní handshake

Puls implementuje **MCP-spec OAuth 2.1** s DCR (RFC 7591) + PKCE S256 (RFC 7636) — to je standard, který Claude Desktop, Cursor, Inspector a další MCP klienti používají out-of-the-box.

## Aktéři

- **Resource Server (RS)** = `apps/mcp-server` (port 3001) — drží MCP endpoint `/mcp`.
- **Authorization Server (AS)** = `apps/web` (port 3000) — drží `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/auth/mcp-connect`.
- **Client** = AI klient (Claude Desktop, Cursor, Inspector, ...).
- **User** = e-shopař přihlášený do Puls (session cookie).

> V dev compose má AS port `13000` a RS port `13001` (publikované hostporty); v containeru jsou `app:3000` a `mcp:3001`. V prod je vše pod jednou doménou (`pulsmcp.com`).

## Přehled flow

```
┌─────────┐                    ┌──────────┐                     ┌──────┐
│ Client  │                    │ MCP (RS) │                     │ User │
└────┬────┘                    └────┬─────┘                     └──┬───┘
     │ 1. GET /.well-known/oauth-authorization-server               │
     │ ◄──────────────────────────────                              │
     │ {authorization_endpoint, token_endpoint, registration_endpoint, ...}
     │                                                              │
     │ 2. POST /oauth/register   ──┐                                │
     │      {client_name,          │                                │
     │       redirect_uris[]}      │                                │
     │ ◄───{client_id, scope}──────┘                                │
     │                                                              │
     │ 3. Generate PKCE pair (verifier, challenge=S256(verifier))   │
     │                                                              │
     │ 4. Redirect user agent to:                                   │
     │    /oauth/authorize?response_type=code                       │
     │       &client_id=...                                         │
     │       &redirect_uri=...                                      │
     │       &code_challenge=...&code_challenge_method=S256         │
     │       &state=...&scope=mcp:read mcp:write                    │
     │ ◄────────────────────────  user agent ────────────────────► │
     │                                              [/login if not signed in]
     │                                              ◄── click Google or magic link
     │                                              [/auth/mcp-connect consent]
     │                                              ◄── select shop + tool categories
     │                                              [POST decision=allow]
     │                                              ◄────────── 302 Redirect
     │ ◄───── redirect_uri?code=<auth_code>&state=<state> ─────────│
     │                                                              │
     │ 5. POST /oauth/token (Content-Type: application/x-www-form-urlencoded)
     │      grant_type=authorization_code                           │
     │      code=<auth_code>                                        │
     │      code_verifier=<verifier>                                │
     │      redirect_uri=...                                        │
     │      client_id=...                                           │
     │ ◄──── {access_token, token_type:Bearer, expires_in:15552000, scope}
     │                                                              │
     │ 6. POST /mcp                                                 │
     │      Authorization: Bearer <access_token>                    │
     │      JSON-RPC initialize ──────► validateBearer / loadShop   │
     │ ◄──── Mcp-Session-Id + initialize result                     │
     │                                                              │
     │ 7. POST /mcp (next call)                                     │
     │      Authorization: Bearer <access_token>                    │
     │      Mcp-Session-Id: <id>                                    │
     │      JSON-RPC tools/list                                     │
     │ ◄──── { tools: [...] }   (filtered by disabled_tools)        │
```

Detailní popis každého kroku v samostatných souborech:

| Krok | Doc |
|---|---|
| 1 | [discovery.md](discovery.md) |
| 2 | [overview.md#dcr](#dcr-dynamic-client-registration) (níže) |
| 3-4 | [authorize-and-consent.md](authorize-and-consent.md) |
| 5 | [token-exchange.md](token-exchange.md) |
| 6-7 | [token-binding.md](token-binding.md) + [../mcp/overview.md](../mcp/overview.md) |

## DCR (Dynamic Client Registration)

`POST /oauth/register` — RFC 7591. Code: [`apps/web/app/routes/oauth.register.tsx`](../../apps/web/app/routes/oauth.register.tsx).

### Request
```http
POST /oauth/register HTTP/1.1
Content-Type: application/json

{
  "client_name": "Claude Desktop",
  "redirect_uris": ["http://localhost:9999/cb"],
  "scope": "mcp:read mcp:write",
  "client_uri": "https://claude.ai",
  "logo_uri": "https://claude.ai/logo.png"
}
```

### Validace
- `client_name` musí být ne-prázdný string
- `redirect_uris` musí být ne-prázdné pole validních URL (každé URL projde `new URL(uri)`)

### Response (201 Created)
```json
{
  "client_id": "<32hex>",
  "client_secret": "<base64url-43>",
  "client_name": "Claude Desktop",
  "redirect_uris": ["http://localhost:9999/cb"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "mcp:read mcp:write"
}
```

### Důležité
- `token_endpoint_auth_method: "none"` — public klient. PKCE nahrazuje `client_secret` u token exchange. `client_secret` se sice generuje, ale NEpoužívá se pro token endpoint; je rezerva pro budoucí confidential klienty.
- `client_id` je 32 hex (16B). `client_secret` je 43-znakový base64url (32B).
- Žádný unique constraint na `client_name` ani `redirect_uris` — registrací může být N (klient ztratí client_id ⇒ udělá nový).

## Klíčové RFC

| RFC | Co | Naše implementace |
|---|---|---|
| 6749 | OAuth 2.0 framework | Authorization Code grant, public client |
| 7591 | Dynamic Client Registration | `/oauth/register` |
| 7636 | PKCE | S256 only (`code_challenge_method` musí být `S256`) |
| 8414 | Authorization Server Metadata | `/.well-known/oauth-authorization-server` |
| 9728 | Protected Resource Metadata | `/.well-known/oauth-protected-resource` |

## Token vlastnosti

- **TTL: 180 dnů** (`ACCESS_TOKEN_TTL_SEC` v `lib/oauth/oauth.server.ts`).
- **No refresh tokens** — klient po expiraci jede znovu OAuth flow (consent vidí znovu, ale to je intentional bezpečnost).
- **Hash-only storage** — uloženo `sha256(token).hex` v `oauth_access_tokens.token_hash`. Plain token vidíme jen jednou, při exchange.
- **Token binding**: `(user_id, shop_id, scope, disabled_tools)` — viz [token-binding.md](token-binding.md).

## Bezpečnost

- **PKCE povinné** — `code_challenge_method` musí být `S256`, jinak 400 z `/oauth/authorize`.
- **Auth code single-use** — `oauth_authorization_codes.used` flag se nastaví na `true` po prvním exchange. Druhý pokus → `invalid_grant`.
- **Auth code TTL 5 min** — `AUTH_CODE_TTL_MS = 5 * 60 * 1000`.
- **Pending session TTL 10 min** — `PENDING_TTL_MS = 10 * 60 * 1000`. Pokud user nedokončí consent do 10 min, `mcp_state` propadne.
- **`redirect_uri` exact match** — při token exchange se kontroluje, že `redirect_uri` v request matchuje to, co bylo uložené při authorize.

## Revocation (dnes neimplementované endpointem)

Token revoke se dnes dělá ručně přes UI (`/dashboard/:shopId/connections` → tlačítko "Odpojit" → SET `revoked_at = now()`). Dedicated `/oauth/revoke` endpoint (RFC 7009) zatím není; klienti nemají standardní cestu jak token revokovat sami. TODO když to bude potřeba.

## Audit log

| Co | Kde |
|---|---|
| DCR | `oauth_clients` row created |
| Authorize start | `oauth_pending_sessions` row insert |
| Consent (allow) | `oauth_authorization_codes` row insert; `oauth_pending_sessions` delete |
| Consent (deny) | `oauth_pending_sessions` delete; redirect with `error=access_denied` |
| Token exchange | `oauth_access_tokens` row insert; `oauth_authorization_codes.used = true` |
| Bearer use | `oauth_access_tokens.last_used_at` updated each request |
