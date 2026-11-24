# OAuth Token Exchange

Krok 5 OAuth flow — klient vymění `authorization_code` + PKCE `code_verifier` za Bearer token.

Code: [`apps/web/app/routes/oauth.token.tsx`](../../apps/web/app/routes/oauth.token.tsx)

## Request

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<auth_code>
&code_verifier=<verifier>
&redirect_uri=<exact_match_from_authorize>
&client_id=<dcr_client_id>
```

### Akceptované content-types
- `application/x-www-form-urlencoded` (kanonické)
- `application/json` (fallback — body keys mapované do form params)
- `multipart/form-data` (poslední fallback)

`readParams` v `oauth.token.tsx:23` zvládá všechny tři. Většina klientů (Claude, Cursor) posílá form-urlencoded.

## Validace

| Check | Failure |
|---|---|
| `request.method === 'POST'` | 405 `invalid_request` |
| `grant_type === 'authorization_code'` | 400 `unsupported_grant_type` |
| `code` AND `code_verifier` přítomny | 400 `invalid_request` |
| `oauth_authorization_codes WHERE code_hash = sha256(code) AND used = false AND expires_at > now()` returns row | 400 `invalid_grant` "authorization code is invalid, expired, or already used" |
| `redirect_uri` exact match (pokud poslán) | 400 `invalid_grant` "redirect_uri mismatch" |
| `verifyPkceS256(code_verifier, codeChallenge)` | 400 `invalid_grant` "code_verifier is invalid" |

## PKCE S256 verify

```ts
function verifyPkceS256(verifier: string, challenge: string): boolean {
  const expected = createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');     // base64url
  return expected === challenge;
}
```

Code: [`apps/web/app/lib/oauth/oauth.server.ts:9`](../../apps/web/app/lib/oauth/oauth.server.ts).

## Akce při úspěchu

1. `UPDATE oauth_authorization_codes SET used = true WHERE id = <auth_code.id>` — single-use.
2. Lookup `oauth_clients WHERE client_id = <client_id>` (pokud poslal) → `oauth_client_pk` (pro FK v access token).
3. Vygeneruje 32B base64url `access_token` → `token_hash = sha256(token).hex`.
4. Insert do `oauth_access_tokens`:
   ```ts
   {
     tokenHash,
     userId:      authCode.userId,
     shopId:      authCode.shopId,
     oauthClientId: oauthClientPk,
     scope:       authCode.scope,
     disabledTools: authCode.disabledTools,    // ← copy from auth code
     expiresAt:   now + 180 days
   }
   ```
5. Response:
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json
   Cache-Control: no-store
   Pragma: no-cache

   {
     "access_token": "<32-char-base64url>",
     "token_type": "Bearer",
     "expires_in": 15552000,
     "scope": "mcp:read mcp:write"
   }
   ```

`Cache-Control: no-store` + `Pragma: no-cache` — bezpečnost: token nikdy nesmí proxychat / browser cachovat.

## Failure response

```json
{
  "error": "invalid_grant",
  "error_description": "code_verifier is invalid"
}
```

| `error` | Kdy |
|---|---|
| `invalid_request` | Missing/malformed params, nebo wrong method |
| `unsupported_grant_type` | grant_type != authorization_code |
| `invalid_grant` | Code expired/used, redirect_uri mismatch, PKCE mismatch |

## Konstanty

| Const | Hodnota | Definice |
|---|---|---|
| `ACCESS_TOKEN_TTL_SEC` | 180 dnů (15 552 000 s) | `lib/oauth/oauth.server.ts:31` |
| `AUTH_CODE_TTL_MS` | 5 min (300 000 ms) | `lib/oauth/oauth.server.ts:32` |
| `PENDING_TTL_MS` | 10 min (600 000 ms) | `lib/oauth/oauth.server.ts:33` |

## Co token NEobsahuje

- ❌ Refresh token — nemáme. Po expiraci klient jede znovu OAuth flow.
- ❌ `id_token` (OIDC) — Puls není OIDC IdP, jen MCP authorization server.
- ❌ Plain `client_secret` v requestu — `token_endpoint_auth_method: "none"` (PKCE replaces it).

## Test scenarios

| Spec | Co testuje |
|---|---|
| `mcp-oauth.spec.ts` "full happy path mints a token bound to shop + scopes" | Plný flow DCR → authorize → consent → token. Verifikuje, že `oauth_access_tokens` má správný `shop_id` a `disabled_tools`. |
| `mcp-oauth.spec.ts` "rejects token exchange with wrong PKCE verifier" | Negative: jiný `code_verifier` než ten, jehož challenge byl odeslán → 400 `invalid_grant`. |
| `mcp-oauth.spec.ts` "discovery advertises endpoints that are actually reachable" | GET `authorization_endpoint` z metadata nesmí vrátit 404 (sanity check). |
