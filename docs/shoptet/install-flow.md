# Shoptet install flow

Shoptet posílá install request po schválení addonu uživatelem v Shoptet adminu. Náš endpoint vymění `code` za permanentní OAuth Access Token, vyčte metadata e-shopu a vytvoří/updatne `shops` row.

## Endpoint

`POST /api/install?code=<install_code>`

> **Pozn.**: Shoptet specifikuje `GET`, ale my implementujeme `POST` (běžně ve světě webhooks). V produkci je nutné mít to konzistentní s tím, co Shoptet partnerství akceptuje. Pokud Shoptet trvá na `GET`, přidáme i loader (jen mirror akce).

Code: [`apps/web/app/routes/api.install.tsx`](../../apps/web/app/routes/api.install.tsx) → [`apps/web/app/lib/shoptet-install.ts`](../../apps/web/app/lib/shoptet-install.ts)

## Sekvence

```
Shoptet                              Puls (apps/web)             Shoptet OAuth
   │                                                                  │
   │ POST /api/install?code=<code> ────────►                          │
   │                                  │ 1. exchangeInstallCode        │
   │                                  │    POST {SHOPTET_API_BASE_URL}/oauth/token
   │                                  │    grant_type=authorization_code &
   │                                  │    code=<code> & client_id+secret &
   │                                  │    redirect_uri=<our> & scope=basic_eshop
   │                                  │ ──────────────────────────►   │
   │                                  │ ◄── { access_token, expires_in: 43200 }
   │                                  │                               │
   │                                  │ 2. fetchBasicEshop            │
   │                                  │    GET /resource?method=getBasicEshop
   │                                  │    Authorization: Bearer <token>
   │                                  │ ──────────────────────────►   │
   │                                  │ ◄── { project: { id, url }, user: { name, email } }
   │                                  │                               │
   │                                  │ 3. UPSERT shops (eshopId UNIQUE)
   │                                  │    - existing → update,
   │                                  │      keep webhook key + mcp secret
   │                                  │    - new → insert + generate
   │                                  │      32B webhook key, 16B mcp secret
   │                                  │                               │
   │                                  │ 4. assignTierOnInstall        │
   │                                  │    - eshopId nikdy neměl trial
   │                                  │      → 'trial' (14 dnů)        │
   │                                  │    - eshopId měl trial dříve  │
   │                                  │      → 'starter' (anti-freeride)
   │                                  │                               │
   │ ◄── 200 { ok, shopId, durationMs }                               │
```

**Limit: 5 sekund** total (Shoptet to považuje za failed install, pokud se nevejdeme).

## OAuth code → Access Token (Shoptet)

```ts
// packages/shoptet-client/src/auth.ts
exchangeInstallCode({ code, tokenUrl, clientId, clientSecret, redirectUri })
  → POST tokenUrl
       grant_type=authorization_code
       code=<install_code>
       client_id=<env.SHOPTET_CLIENT_ID>
       client_secret=<env.SHOPTET_CLIENT_SECRET>
       redirect_uri=<env.SHOPTET_REDIRECT_URI>
       scope=basic_eshop
  → { access_token, expires_in: 43200 }    // expires_in se nepouzije, token je permanentni
```

**Důležité:**
- `expires_in: 43200` (12h) je informativní; OAuth Access Token je v Shoptet **permanentní** (toto vrací jen jako součást OAuth conventions).
- Ukládáme do `shops.oauth_access_token` (255 znaků). Z něj generujeme krátkodobé API tokeny — viz [api-client.md](api-client.md).

## Eshop info

```ts
fetchBasicEshop(apiBaseUrl, oauthAccessToken)
  → GET /resource?method=getBasicEshop
       Authorization: Bearer <oauthAccessToken>
  → { data: { project: { id, url, name, ... }, user: { email, name, ... } } }
```

Z toho:
- `project.id` → `shops.eshopId` (Shoptet's unique int ID)
- `project.url` → normalized → `shops.domain` (např. `xxxxx.myshoptet.com`)
- `user.email` → `shops.adminEmail` (lowercased) — kdo nainstaloval; přiřadí pak vlastnictví v dashboardu

## Anti-freeride: tier assignment

[`apps/web/app/lib/pricing.server.ts`](../../apps/web/app/lib/pricing.server.ts) `assignTierOnInstall`:

```ts
// Pseudo
INSERT INTO tier_assignments (eshop_id, tier_id='trial', reason='install')
  ON CONFLICT (eshop_id) WHERE tier_id='trial' DO NOTHING
  RETURNING *;

if (insertedRow) {
  // First install for this eshopId — give trial
  UPDATE shops SET tier_id='trial', trial_ends_at=now()+14d WHERE id=...
  return { tierId: 'trial', reason: 'install' }
} else {
  // eshopId previously had trial — anti-freeride: starter
  INSERT INTO tier_assignments (eshop_id, tier_id='starter', reason='reinstall_no_trial')
  UPDATE shops SET tier_id='starter', trial_ends_at=null WHERE id=...
  return { tierId: 'starter', reason: 'reinstall_no_trial' }
}
```

**Klíč**: `idx_tier_assignments_eshop_tier` UNIQUE PARTIAL INDEX na `(eshop_id, tier_id)` WHERE `tier_id = 'trial'`. To brání druhému insertu trialu pro stejný `eshop_id`. Funguje i napříč úplným cyklem **install → uninstall → reinstall** (`tier_assignments` se nemaže s shopem, je tam `ON DELETE SET NULL` na `shop_id`, ale `eshop_id` zůstává).

## Reinstall

Pokud už `shops` row pro `eshop_id` existuje (`uninstalled_at IS NOT NULL` nebo prostě reinstall):
- Update `oauth_access_token` (Shoptet vždy vydá nový), `domain`, `name`, `adminEmail`, `shoptet_api_base_url`, `status='ACTIVE'`, `updatedAt`.
- **NEgeneruje se nový `webhook_signature_key` ani `mcp_endpoint_secret`** — zachová existující, aby webhook subscriptions (registrované u Shoptetu) zůstaly validní.
- Tier zůstává jaký byl (anti-freeride trial check výše).

## Response

### 200 OK
```json
{
  "ok": true,
  "shopId": "abc123...",
  "durationMs": 234
}
```

### 400 Bad Request
```json
{
  "ok": false,
  "error": "Missing ?code="
}
```

Common errors:
- "Missing ?code=" — query param missing
- "OAuth token exchange failed (HTTP 400)" — Shoptet returned error
- "Invalid project.url from Shoptet info: ..." — domain parsing failed
- "Failed to persist shop" — DB insert vrátil 0 rows (rare)

## Shoptet IP allowlist

Produkce musí povolit zdrojový rozsah `185.184.254.0/24` na portech 80/443/8080/8443. Coolify default firewall to umožňuje, ale pokud bude před tím proxy/CDN, musí to ven vědět.

Test stack běží lokálně — `task install` nebo `task e2e:install` testuje proti `mock-shoptet` (Prism) bez IP omezení.

## Related

| Téma | Doc |
|---|---|
| Webhooks (po installu se mohou registrovat) | [webhooks.md](webhooks.md) |
| API client (token cache, retry/backoff) | [api-client.md](api-client.md) |
| Settings iframe v Shoptet adminu | [../web/settings-iframe.md](../web/settings-iframe.md) |
