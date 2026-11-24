# Admin API (`/api/admin/*`)

Public REST API pro automatizovaný approach k operativním datům. Slouží například pro:
- Status dashboard nad Pulsem (Grafana, custom monitor)
- Audit / billing scripts
- Bulk export shopů pro CRM sync

Všechny endpointy vyžadují **Admin API Key** v `Authorization: Bearer <key>` header.

Code: validace [`apps/web/app/lib/admin-api/keys.server.ts`](../../apps/web/app/lib/admin-api/keys.server.ts), endpointy [`apps/web/app/routes/api.admin.*.tsx`](../../apps/web/app/routes/).

## Authentication

```http
GET /api/admin/shops HTTP/1.1
Host: pulsmcp.com
Authorization: Bearer pmcp_admin_<64hex>
```

Pokud chybí, neplatný, nebo revokovaný klíč → **401 Unauthorized**:
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer realm="puls-admin"

{"error":"unauthorized"}
```

### Klíče

- Format: `pmcp_admin_<64-hex-string>` (32 random bytes hex-encoded, prefixed)
- Hash-only storage v `admin_api_keys.key_hash` (SHA-256)
- `key_prefix` (`pmcp_admin_<8hex>`) v UI listu pro identifikaci
- `last_used_at` se updatne při každém validním requestu (best-effort, async)
- Revoke: `revoked_at = now()` → all future requests 401

### Vytvoření klíče

V `/admin/api-keys` UI:
1. **Vygenerovat klíč** form: enter label → POST.
2. UI ukáže **plain key** **jednorázově** — uživatel musí zkopírovat hned.
3. DB má jen `key_hash` + `key_prefix`. Plain key se už nikdy nezobrazí.

## Endpointy

### `GET /api/admin/shops`
[`api.admin.shops.tsx`](../../apps/web/app/routes/api.admin.shops.tsx)

```json
{
  "count": 42,
  "shops": [
    {
      "id": "abc123",
      "platform": "upgates",
      "platformAccountId": "myshop",
      "domain": "myshop.admin.upgates.com",
      "name": "Owner Name",
      "adminEmail": "owner@myshop.cz",
      "status": "ACTIVE",
      "installedAt": "2026-04-15T10:23:45.000Z"
    },
    ...
  ]
}
```

Sortováno `installed_at DESC`. Žádná paginace (limit ~stovky shopů).

### `GET /api/admin/stats?since=<ISO8601>`
[`api.admin.stats.tsx`](../../apps/web/app/routes/api.admin.stats.tsx)

```json
{
  "totals": { "total": 12345, "errors": 23 },
  "byTool": [
    { "tool": "list_orders", "total": 4567, "errors": 5, "avgDurationMs": 234 },
    ...
  ],
  "byShop": [
    { "shopId": "abc", "domain": "...", "total": 1234, "errors": 1 },
    ...
  ]
}
```

`?since=2026-05-01T00:00:00Z` (optional) — filtruje calls od daného timestampu. Bez `since` = all time.

### `GET /api/admin/logs?shop=<id>&status=<>&tool=<>&since=<>&limit=<>`
[`api.admin.logs.tsx`](../../apps/web/app/routes/api.admin.logs.tsx)

Vrátí filtered tool call log:
```json
{
  "count": 100,
  "logs": [
    {
      "id": "log_xyz",
      "shopId": "abc",
      "domain": "...",
      "tool": "list_orders",
      "status": "ok",
      "durationMs": 234,
      "args": { "limit": 50 },
      "errorMessage": null,
      "createdAt": "2026-05-08T14:30:00.000Z"
    }
  ]
}
```

Filtry:
- `?shop=<shopId>` — per shop
- `?status=ok|error`
- `?tool=<name>`
- `?since=<ISO8601>` — od timestampu
- `?limit=<1-500>` — default 100, max 500

### `GET /api/admin/system`
[`api.admin.system.tsx`](../../apps/web/app/routes/api.admin.system.tsx)

```json
{
  "ok": true,
  "env": "production",
  "mcpOrigin": "https://pulsmcp.com",
  "postgres": { "ok": true, "latencyMs": 12, "error": null },
  "redis":    { "ok": true, "latencyMs": 3, "error": null }
}
```

HTTP 200 pokud `ok=true`, jinak 503.

## Curl příklady

```bash
KEY="pmcp_admin_..."

# List všech shopů
curl -H "Authorization: Bearer $KEY" https://pulsmcp.com/api/admin/shops | jq

# Stats za posledních 7 dní
SINCE=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
curl -H "Authorization: Bearer $KEY" "https://pulsmcp.com/api/admin/stats?since=$SINCE" | jq

# Recent error logs pro konkrétní shop
curl -H "Authorization: Bearer $KEY" \
  "https://pulsmcp.com/api/admin/logs?shop=<shopId>&status=error&limit=50" | jq

# System health
curl -H "Authorization: Bearer $KEY" https://pulsmcp.com/api/admin/system | jq
```

## Rate limiting

Dnes **bez explicit rate limitu** — předpoklad, že admin API není veřejně sdílený. Pokud bude potřeba (např. monitoring polluje):
- Per-key Redis counter
- Default 60 req/min nebo 1000 req/hour

## Bezpečnost

- **Bearer header only** — žádné query params nebo cookies (nelze omylem leak v logu).
- **Hash-only storage** — kompromitace DB neodhalí plain klíče.
- **Single-use display** — UI ukáže plain key jen při vytvoření.
- **Audit log**: `last_used_at` ukáže kdy byl klíč naposled použit. Pokud klíč nebyl 90+ dnů použitý, doporučujeme revokovat.
- **Per-team scope (TBD)** — dnes jeden klíč má všechna oprávnění. Pokud bude potřeba scope (např. read-only vs read-write), přidat sloupec `scopes JSONB` do `admin_api_keys` + middleware check per endpoint.
