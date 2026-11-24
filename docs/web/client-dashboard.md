# Klient dashboard

Po přihlášení jde uživatel do `/dashboard`, kde uvidí svoje shopy a může spravovat MCP připojení.

## Layout & guards

[`apps/web/app/routes/dashboard.$shopId.tsx`](../../apps/web/app/routes/dashboard.$shopId.tsx) je parent layout pro všechny `/dashboard/:shopId/*` routes.

### Loader (každý request)
1. `requireSessionUser` (jinak redirect `/login`).
2. SELECT shop by `params.shopId`.
3. **Owner check**: `shop.adminEmail === user.email` (case-insensitive). Pokud miss → **403 Forbidden**.
4. Load `tier` (`getTier(db, shop.tierId)`).
5. Load `stats` z Redis (`loadDashboardStats(redis, shopId, callsPerDay)`).
6. Spočítá `trial.active` / `trial.expired` flagy.

### Render
```
┌─────────────────────────────────────────────────────────────┐
│ ClientTopBar (shop name, quota X/Y, user menu, logout)      │
├──────────┬──────────────────────────────────────────────────┤
│          │ TrialBanner (active nebo expired)                │
│  Side-   │                                                  │
│  bar     │  <Outlet />  ← per-route content                 │
│          │                                                  │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### TrialBanner

`<TrialBanner variant="active" tierName="Trial" endsAt={...}>`:
- "🎉 Probíhá trial — končí za X dnů. Vyberte si plán."
- CTA → `/pricing`

`<TrialBanner variant="expired" tierName="Trial">`:
- "⚠️ Zkušební období skončilo. Aktivujte placený plán pro pokračování."
- Pokud expired, **`<Outlet />` se nerendruje** — uživatel uvidí jen banner a CTA. Vědomé, aby motivovalo k upgrade.

## `/dashboard` (index)

[`dashboard._index.tsx`](../../apps/web/app/routes/dashboard._index.tsx)

Loader:
- `listShopsForEmail(user.email)` → seznam shopů kde je owner.
- 1 shop → `redirect('/dashboard/' + id)`
- 2+ shopů → `redirect('/dashboard/select')`
- 0 shopů → render onboarding screen

Action (POST `intent=demo-shop`):
- **Dev only** (`NODE_ENV !== 'production'`).
- Vyrobí demo shop přes mock-shoptet (`createDemoShopForEmail`).

Onboarding (0 shopů):
```
Zatím nemáte žádný shop připojený.
[Vytvořit demo shop] (jen v dev)
```

## `/dashboard/select`

[`dashboard.select.tsx`](../../apps/web/app/routes/dashboard.select.tsx)

Multi-shop picker. Render: search input + grid karet (shop name/domain, status badge, "Otevřít →"). Avatar barvy z `AVATAR_COLORS` rotace pro vizuální odlišení.

## `/dashboard/:shopId` (shop overview)

[`dashboard.$shopId._index.tsx`](../../apps/web/app/routes/dashboard.$shopId._index.tsx)

Loader: load shop, tier, stats (calls today + per-day), recent activity (last 5 lines), usage history (30 dnů).

Komponenty:

### `<McpUrlCard>`
Copy-paste MCP URL pro Claude Desktop / Cursor:
```
https://pulsmcp.com/mcp
```
+ návod jak přidat do klienta + `[Nakonfigurovat MCP klienta →]`.

> **URL je generická** (žádný shopId / secret v URL) — shop je vázaný na Bearer token vydaný OAuth flow.

### `<QuickStatsGrid>`
KPI cards:
- Calls today (X / Y limit)
- Errors today
- Active connections (počet platných oauth_access_tokens)
- Memory items (z shop_memory_items)

### `<UsageChart>`
30-day line chart calls per day. Data z Redis ZSET `puls:mcp:shop:<shopId>:calls:<YYYY-MM-DD>`.

### `<ActivityTable>`
Posledních 5 tool calls. Sloupce: timestamp, tool, status, duration_ms.

## `/dashboard/:shopId/activity`

[`dashboard.$shopId.activity.tsx`](../../apps/web/app/routes/dashboard.$shopId.activity.tsx)

Last 100 tool calls. Stejná tabulka jako overview, ale full list. Načítá z Redis activity ZSET.

## `/dashboard/:shopId/tools`

[`dashboard.$shopId.tools.tsx`](../../apps/web/app/routes/dashboard.$shopId.tools.tsx)

Loader: zavolá `fetchShopMcpTools({ shopId, mcpSecret })` — interně vyrobí short-lived MCP klienta s shop's Bearer (TBD: jak se autentizuje vůči svému MCP serveru — pravděpodobně přes `mcpEndpointSecret`) a zavolá `tools/list`. Vrátí list pro renderování.

Render: list každého tool s name, description, input schema. Slouží uživateli k přehledu, co AI klient s aktuálním consentem může.

## `/dashboard/:shopId/connections`

[`dashboard.$shopId.connections.tsx`](../../apps/web/app/routes/dashboard.$shopId.connections.tsx)

Loader: SELECT `oauth_access_tokens` (active = `revoked_at IS NULL AND expires_at > now()`) JOIN `oauth_clients` pro client_name. Vrátí list.

Render: tabulka:
| Klient | Scope | Vytvořeno | Vyprší | Last used | Akce |
|---|---|---|---|---|---|
| Claude Desktop | mcp:read mcp:write | 2026-04-01 | 2026-09-28 | před 5 min | [Odpojit] |

Action `intent=revoke&id=<token_id>` → `UPDATE oauth_access_tokens SET revoked_at = now()`. Klient pak dostane 401 a musí znovu OAuth flow.

## `/dashboard/:shopId/write-history`

[`dashboard.$shopId.write-history._index.tsx`](../../apps/web/app/routes/dashboard.$shopId.write-history._index.tsx)

Loader: SELECT `write_log WHERE shop_id = ?`, order by `created_at DESC`, limit 200.

Render: tabulka provedených zápisů (nástroj, status badge, provedeno, vráceno) s linkem na detail. Statusy: `applied` (Provedeno) / `reverted` (Vráceno) / `failed` (Selhalo). Prázdný stav: „Zatím žádné zápisy."

## `/dashboard/:shopId/write-history/:id`

[`dashboard.$shopId.write-history.$id.tsx`](../../apps/web/app/routes/dashboard.$shopId.write-history.$id.tsx)

Loader: SELECT `write_log WHERE id = ?` + ověření `shop_id` shody.

Render:
- Tool name + status badge + časy (provedeno / vráceno).
- Args (JSON pretty).
- **Diff view**: `before` vs `after` (side-by-side).
- Result JSON (po provedení) a Chyba (u `failed`).
- Pokud `status === 'applied'` → tlačítko **[Vrátit]** (revert).

Action `intent=revert`:
- Obnoví `before` stav přes connector **stejnou sémantikou jako MCP nástroj `revert_write`** (`mapBeforeToPatch` je duplikovaný v obou — viz pozn. níže), pak `UPDATE status='reverted', reverted_at=now()`.
- Nereverzibilní (`create_customer_note`) nebo platformou nepodporované zápisy vrátí srozumitelnou chybu; voucher se deaktivuje, kde to platforma umí.

> **POZOR:** `mapBeforeToPatch` (before stav produktu → `ProductPatch`) je duplikovaný v této routě i v [`apps/mcp-server/src/tools/revert.ts`](../../apps/mcp-server/src/tools/revert.ts) — při změně synchronizovat oba.

Detail write modelu v [../mcp/write-tools-and-audit.md](../mcp/write-tools-and-audit.md).

## `/settings/:shopId` (iframe)

Speciální varianta pro embed v Shoptet adminu. Detail v [settings-iframe.md](settings-iframe.md).

## Sidebar (`<ClientSidebar>`)

[`apps/web/app/components/dashboard/client-sidebar.tsx`](../../apps/web/app/components/dashboard/client-sidebar.tsx)

| Položka | Ikona | Cíl |
|---|---|---|
| Přehled | `Activity` | `/dashboard/:shopId` |
| Activity log | `Logs` | `/dashboard/:shopId/activity` |
| Tools | `Terminal` | `/dashboard/:shopId/tools` |
| Historie zápisů | `History` | `/dashboard/:shopId/write-history` |
| Připojené aplikace | `Link2` | `/dashboard/:shopId/connections` |

Active link má `aria-current="page"` + zvýrazněný background a left-border accent.

## Top bar (`<ClientTopBar>`)

[`apps/web/app/components/dashboard/client-top-bar.tsx`](../../apps/web/app/components/dashboard/client-top-bar.tsx)

Header obsahuje:
- Logo Puls
- Shop name (vlevo)
- Quota indicator (`X / Y` calls today, progress bar)
- User menu (right) — e-mail, link "Nastavení" → `/nastaveni`, "Logout" form

## E2E

| Spec | Co testuje |
|---|---|
| `client-dashboard-empty.spec.ts` | Empty state když user nemá žádný shop |
| `iframe-embed.spec.ts` | Embed funguje, "Otevřít plný přehled" tlačítko (`testid="open-full-dashboard"`) je viditelné |
| `mcp-write-tools-v2.spec.ts` | Immediate write → `write_log` audit row (`applied`) → `revert_write` → `reverted` |
