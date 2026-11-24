# Admin area

Interní admin UI pro provozovatele Pulsu (dnes 1 person — `admin@example.com`).

## Přístup

`/admin/*` je gated:
1. `requireSessionUser` — musí být přihlášený.
2. `isAdminEmail(user.email)` — e-mail v `ADMIN_EMAIL` env (CSV, lowercase, exact match).
3. Pokud user je přihlášený ale nemá admin → `redirect('/dashboard')`.
4. Pokud nepřihlášený → `redirect('/login')`.

`<meta robots="noindex, nofollow">` na všech admin stránkách.

Layout: [`admin.tsx`](../../apps/web/app/routes/admin.tsx) (sidebar + topbar) → `<Outlet />`.

## Sidebar

[`apps/web/app/components/admin/admin-sidebar.tsx`](../../apps/web/app/components/admin/admin-sidebar.tsx)

| Položka | Ikona | Cíl |
|---|---|---|
| Overview | `Activity` | `/admin` |
| Shops | `Store` | `/admin/shops` |
| Pricing | `Tag` | `/admin/pricing` |
| Logs | `Logs` | `/admin/logs` |
| Webhooks | `Webhook` | `/admin/webhooks` |
| API Keys | `Key` | `/admin/api-keys` |
| Emaily | `Mail` | `/admin/emails` |
| Prompty | `Sparkles` | `/admin/prompts` |
| System | `Server` | `/admin/system` |
| Incidenty | `AlertOctagon` | `/admin/status` |

## `/admin` (Overview)

[`admin._index.tsx`](../../apps/web/app/routes/admin._index.tsx)

Loader: souhrn z DB + Redis:
- Aktivní shopy count
- Paused shopy count
- Trial active / ending soon (D-7) / expired counts
- Global calls counter (Redis `puls:mcp:calls:global`)
- 24h calls proxy (count `mcp_tool_calls` last 24h)
- Health probes (DB, Redis, Shoptet API)
- Last 10 installs
- Last 8 webhook notifications

Render:
- **`<HealthStripIndicator>`** strip nahoře (web/db/redis/shoptet_api dot indicators)
- **`<BigStatCard>`** grid: shopy aktivní, trial expirations, global calls
- **`<AdminCallsChart>`** (lazy-loaded client component) — 24h chart
- Recent installs + webhooks tables

> **Pozn.**: V production se rendruje `lazy(() => import('AdminCallsChart.client'))` — chart je client-only, server fallback je `<Suspense fallback={...}>`. V dev může 500 status (HMR / chunk timing) — render je OK, jen status code je flaky. Není to bug v datech.

## `/admin/shops`

[`admin.shops._index.tsx`](../../apps/web/app/routes/admin.shops._index.tsx)

Tabulka 200 nejnovějších shopů:
| eshopId | domain | name | status | installed_at | → |

Click na řádek → `/admin/shops/:shopId`.

## `/admin/shops/:shopId`

[`admin.shops.$shopId.tsx`](../../apps/web/app/routes/admin.shops.$shopId.tsx)

Detail shopu:
- **Metadata**: eshopId, domain, name, status, admin_email, installed_at, shoptet_api_base_url
- **Masked secrets**: `oauth_access_token` → `sk_******xxxx`, `webhook_signature_key`, `mcp_endpoint_secret`
- **Tier section**:
  - Aktuální tier (badge), kdy přiřazen (`tier_assigned_at`)
  - **Tier history** z `tier_assignments` (audit log)
  - **Změnit tier** form: dropdown s `getAllTiers()` → POST → `assignTier` (s reason `admin_override`)
- **Webhook notifications**: posledních 50 pro tento shop

## `/admin/pricing`

[`admin.pricing._index.tsx`](../../apps/web/app/routes/admin.pricing._index.tsx)

Tabulka tierů:
| Název | ID | Měsíčně | Calls/den | Memory items | Log dní | Shopů | Public | Trial | → |

`getTierShopCounts(db)` spočítá kolik shopů každý tier má (informativní, validuje že nemažeme aktivně používaný tier).

Click → `/admin/pricing/:tierId` ([`admin.pricing.$tierId.tsx`](../../apps/web/app/routes/admin.pricing.$tierId.tsx)) — edit form.

> Tiery se **nemažou**, jen archivují (`archived_at`) nebo skrývají (`is_public=false`).

## `/admin/logs`

[`admin.logs._index.tsx`](../../apps/web/app/routes/admin.logs._index.tsx)

Tool call log s filtry:
- `?shop=<id>` — per shop (NiceSelect dropdown)
- `?status=ok|error` — status filter
- `?tool=<name>` — tool filter

Vrátí last 300 řádků, joinuje shop info (domain, owner email).

Sloupce: timestamp, shop (domain + email), tool, status, duration_ms, error/detail.

## `/admin/webhooks`

[`admin.webhooks._index.tsx`](../../apps/web/app/routes/admin.webhooks._index.tsx)

Webhook notifications log s filtry: shop, event, state (ok/pending/error). Last 250.

## `/admin/api-keys`

[`admin.api-keys._index.tsx`](../../apps/web/app/routes/admin.api-keys._index.tsx)

Dvě sekce:

### Per-shop secrets (read-only)
Tabulka 100 shopů s masked secrets (`oauth`, `webhook`, `mcp` — všechno `sk_******xxxx` formát). Pro debugging.

### Admin API keys
Long-lived klíče pro `/api/admin/*` endpointy:
- List: label, prefix (`sk_******xxxx`), created_at, last_used_at, revoked_at
- **Create form** (POST `intent=create`): label → vygeneruje 32B base64url key, ukáže **plain key** (jen tentokrát!), uloží `key_hash` (SHA-256) + `key_prefix`.
- **Revoke** form (POST `intent=revoke&id=...`): SET `revoked_at = now()`.

Detail v [../operations/admin-api.md](../operations/admin-api.md).

## `/admin/emails`

[`admin.emails._index.tsx`](../../apps/web/app/routes/admin.emails._index.tsx)

Preview e-mailových šablon. Šablony žijí v `lib/email/templates/` (pro každou: `id`, `name`, `description`, `render() → { subject, html, text }`).

UI: split view — vlevo list šablon, vpravo subject + rendered HTML + plain text. Slouží k vizuální kontrole před deployem.

Aktuální templates:
- `login-code` — magic link kód
- `trial-d-3` — trial končí za 3 dny
- `trial-d-1` — trial končí zítra
- `trial-expired` — trial vypršel, shop pozastaven

## `/admin/prompts`

[`admin.prompts._index.tsx`](../../apps/web/app/routes/admin.prompts._index.tsx) + `new` + `:id`

Správa prompt knihovny (prompty se servírují MCP klientům; veřejná galerie `/prompts` byla v archivní verzi odstraněna):

### List
Všechny prompty (i unpublished). Sloupce: title, kategorie, difficulty, published flag, views, uses, → edit.

### New / Edit
Sdílený `<PromptForm>` ([`apps/web/app/components/admin/prompt-form.tsx`](../../apps/web/app/components/admin/prompt-form.tsx)):
- Slug, title, summary, body (markdown textarea), kategorie (select), difficulty, est_minutes
- `required_tools` (comma-separated list), `required_consent` (multiselect: orders/products/.../write/memory)
- `min_tier` (select)
- `is_published`, `is_featured`, `sort_order`

Action: insert/update `prompts` row. **Cache bust**: po změně se invaliduje Redis cache `puls:prompts:published` (projeví se do 60s).

## `/admin/system`

[`admin.system._index.tsx`](../../apps/web/app/routes/admin.system._index.tsx)

Pre `<pre>` blocks:
- **Health JSON**: výsledek `runHealthChecks()` (db, redis, shoptetMock probes + lastError)
- **Redis INFO**: prvních 8 řádků z `redis.info('server')` (version, uptime, OS)
- **Migrations**: list applied migrations z `_journal.json`
- **Node version**

Pro debugging produkčního deploymentu (po redeploy zkontrolovat, že DB schema je aktuální).

## `/admin/status`

[`admin.status._index.tsx`](../../apps/web/app/routes/admin.status._index.tsx) + `new` + `:id`

Manuální správa incidentů (veřejná `/status` stránka byla v archivní verzi odstraněna; tabulka `incidents` zůstává):

### List
100 nejnovějších incidentů. Sloupce: component, title, status badge, started_at, resolved_at.

### New ([`admin.status.new.tsx`](../../apps/web/app/routes/admin.status.new.tsx))
Form: component (web/mcp/shoptet_api/multi), title, status (investigating/identified/monitoring/resolved), initial update message.

### Edit ([`admin.status.$id.tsx`](../../apps/web/app/routes/admin.status.$id.tsx))
Edit incident, add timeline updates (markdown), mark resolved.

## Top bar (`<AdminTopBar>`)

[`apps/web/app/components/admin/admin-top-bar.tsx`](../../apps/web/app/components/admin/admin-top-bar.tsx)

Header s:
- Logo Puls (link → `/`)
- Trail "Administrace"
- Right: user e-mail, "Logout" form, "Klientský dashboard" link (→ `/dashboard`)

## API endpointy pro Admin (machine)

Public Admin API (`/api/admin/*`) — Bearer s admin API key. Detail v [../operations/admin-api.md](../operations/admin-api.md).
