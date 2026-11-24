# OAuth Authorize + Consent UI

Krok 3-4 OAuth flow — uživatel se přihlásí, vybere shop a povolí tool kategorie.

## Endpointy

| Step | Method | Path | Code |
|---|---|---|---|
| 3 | GET | `/oauth/authorize` | [`oauth.authorize.tsx`](../../apps/web/app/routes/oauth.authorize.tsx) |
| 4a | GET | `/auth/mcp-connect?mcp_state=...` | [`auth.mcp-connect.tsx`](../../apps/web/app/routes/auth.mcp-connect.tsx) |
| 4b | POST | `/auth/mcp-connect` | (action ve stejném souboru) |

## `/oauth/authorize` (krok 3)

### Request
```http
GET /oauth/authorize?
    response_type=code
    &client_id=<dcr_client_id>
    &redirect_uri=http://localhost:9999/cb
    &code_challenge=<base64url(sha256(verifier))>
    &code_challenge_method=S256
    &state=<client-supplied-state>
    &scope=mcp:read+mcp:write
```

### Validace (loader v `oauth.authorize.tsx`)
| Check | Failure |
|---|---|
| `response_type === 'code'` | 400 `unsupported_response_type` |
| `redirect_uri` exists | 400 `invalid_request` "redirect_uri required" |
| `redirect_uri` parses as URL | 400 `invalid_request` "redirect_uri must be a valid URL" |
| `code_challenge` exists AND `code_challenge_method === 'S256'` | 400 `invalid_request` "PKCE with code_challenge_method=S256 is required" |

### Akce
1. Generuje 24B hex `mcp_state` (interní, nepřezní s klientovým `state`).
2. Insert do `oauth_pending_sessions`:
   ```ts
   { mcpState, clientId, clientState: state, redirectUri,
     codeChallenge, codeChallengeMethod, scope,
     expiresAt: now + 10min }
   ```
3. `throw redirect('/auth/mcp-connect?mcp_state=' + mcpState)`

> Pozn.: `state` od klienta se uloží do `clientState` (pro pozdější callback), interní `mcpState` je server-side handoff token mezi authorize a consent. Klient ho nikdy nevidí.

## `/auth/mcp-connect` (krok 4)

### Loader (GET)
1. Validuje `?mcp_state=...` (musí v `oauth_pending_sessions` být a `expires_at > now`).
2. Pokud user není přihlášený → `redirect('/login?callbackUrl=/auth/mcp-connect?mcp_state=...')`.
3. Loaduje `oauth_clients` row pro `clientName` (zobrazí "<klient> chce přístup k vašemu eshopu").
4. Loaduje `listShopsForEmail(user.email)` — všechny shopy, kde `admin_email = user.email` (case-insensitive).
5. Vrátí data pro UI render: `{ mcpState, clientName, shops, redirectHost, scope }`.

### UI render
```
┌───────────────────────────────────────────────────┐
│ Puls · MCP autorizace                             │
│                                                   │
│ <ClientName> chce přístup k vašemu eshopu         │
│                                                   │
│ Po povolení dostane <ClientName> oprávnění        │
│ používat vybrané nástroje na zvoleném eshopu      │
│ přes MCP. Token vyprší za 180 dní a můžete ho     │
│ kdykoliv odvolat v dashboardu. Přesměrujeme       │
│ zpět na <redirectHost>.                           │
│                                                   │
│ Eshop:    [▼ My Shop — myshop.myshoptet.com]     │
│                                                   │
│ Nástroje, ke kterým bude mít klient přístup:      │
│   ☑ Objednávky                                    │
│   ☑ Produkty                                      │
│   ☑ Zákazníci                                     │
│   ☑ Katalog (eshop info)                          │
│   ☑ Insights (přehledy)                           │
│   ☐ Zápisové akce  [Mění data]                    │
│   ☑ Paměť (preference a kontext)                  │
│                                                   │
│ Scope: mcp:read mcp:write                         │
│                                                   │
│ [Zamítnout]                       [Povolit přístup]│
└───────────────────────────────────────────────────┘
```

**Edge case** — uživatel nemá žádný shop (žádný row v `shops` kde `admin_email = user.email`):
```
Žádný eshop k propojení
Pod tímto účtem zatím nemáte žádný aktivní Shoptet eshop. Nejdřív
nainstalujte Puls v admin rozhraní Shoptetu a vraťte se sem.
[ Na dashboard ]
```

### Action (POST)

1. Re-load `oauth_pending_sessions` (validace, že user nedostal stale).
2. Re-check `getSessionUser` (jinak redirect na `/login`).
3. **Pokud `decision === 'deny'`** → smaže pending row → redirect zpět na `redirect_uri` s `?error=access_denied[&state=<clientState>]`.
4. **Pokud `decision === 'allow'`**:
   - Validuje `shop_id` v owned shopech (jinak 403).
   - Parse zaškrtnutých `tool_<id>=on` → vyrobí `enabledIds` set → `disabled = ALL_CATEGORIES.filter(id => !enabledIds.has(id)).join(',')`.
   - Vygeneruje 32B base64url `code` → SHA-256 hash → uloží `oauth_authorization_codes`:
     ```ts
     { codeHash, userId, shopId,
       clientId, redirectUri,
       codeChallenge, codeChallengeMethod, state: clientState, scope,
       disabledTools, expiresAt: now + 5min }
     ```
   - Smaže `oauth_pending_sessions` row.
   - `throw redirect(redirect_uri + '?code=<code>[&state=<clientState>]')`

## Bezpečnost

- **Owner-only shop selection** — user může vybrat jen shop, kde `shops.admin_email = users.email`. Server side check (řádek 175-180 v `auth.mcp-connect.tsx`).
- **`mcp_state` nelze brute-force** — 24B hex (~192 bit entropy) + 10 min TTL.
- **`code` plain string nikdy v DB** — uložený jen `code_hash` (SHA-256). Při token exchange klient pošle plain code, server hashuje a hledá.
- **CSRF**: `oauth_pending_sessions` slouží jako server-side state — klientův `state` parameter je passthrough echo, ne security gate. Skutečný gate je `mcp_state` (kterého se klient nikdy nedotkne).
- **`tool_<id>=on` parsing** — server validuje proti whitelist `validIds`, neznámé `tool_<id>` se ignorují.

## Memory note v consent UI

Kategorie `memory` je defaultně zaškrtnutá, ale **memory tooly se zaregistrují jen pokud má shop `memory_enabled` v `shops` table** (toggle v dashboardu). Tj. user může povolit `memory` v consentu ale memory neaktivovat — pak `tools/list` memory tooly nezobrazí.

## Login wall

Pokud user není přihlášený, redirect na `/login?callbackUrl=...` → po loginu se vrátí zpět na `/auth/mcp-connect`. Login flow podporuje magic link (e-mail kód) i Google OIDC — viz [../web/auth.md](../web/auth.md).

## Test driver

V e2e testech [`tests-e2e/helpers/oauth.ts:performAuthorizeAndConsent`](../../tests-e2e/helpers/oauth.ts) Playwright:
1. Naviguje na `/oauth/authorize?...` s pre-set sessionem cookie.
2. Vyčká na hidden input `name="shop_id"` (custom NiceSelect).
3. Optional: klikne na shop dropdown a vybere matching label.
4. Pro každou kategorii v `enabledTools` argumentu zkontroluje, ostatní odškrtne.
5. Klikne `button[name="decision"][value="allow"]` (s `noWaitAfter: true` aby se nedeadlockovalo na 302 do redirect_uri).
6. `page.route` zachytí redirect na `redirect_uri` a vyparsuje `code` + `state` z URL.
