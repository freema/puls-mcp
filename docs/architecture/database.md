# Database schema

Jeden Postgres 16, jedno DB `puls`. Schema žije v [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) (Drizzle ORM). Migrace v [`apps/web/drizzle/migrations/`](../../apps/web/drizzle/migrations/) a aplikují se automaticky při startu `app` containeru (entrypoint volá `drizzle-kit migrate`).

## Tabulky a vztahy

```
                              ┌─────────────┐
                              │ pricing_tiers│  (trial / starter / pro / business)
                              │  id PK      │
                              └──────┬──────┘
                                     │ tier_id (FK soft)
            ┌────────────┐    ┌──────▼──────┐    ┌─────────────────────┐
            │   users    │    │   shops     │◄──┤ tier_assignments    │
            │  id PK     │    │  id PK      │    │  audit log + anti-  │
            │  email UQ  │    │  eshop_id UQ│    │  freeride (unique   │
            │  google_sub│    │  domain UQ  │    │  partial idx)       │
            └─────┬──────┘    │  oauth_token│    └─────────────────────┘
                  │           │  webhook_key│
        ┌─────────┴─────────┐ │  mcp_secret │    ┌─────────────────────┐
        │                   │ │  tier_id    │◄──┤ api_token_cache     │
        ▼                   ▼ │  trial_ends │    │  shopId UQ → shops  │
  ┌──────────┐    ┌─────────────┐ status     │    │  legacy token cache │
  │ sessions │    │ oauth_*     │             │    │  (per-shop, legacy) │
  │  user_id │    │ register/   │             │    └─────────────────────┘
  │  token   │    │ pending/    │             │
  │  expires │    │ codes/      │             ├──► webhook_notifications (event idempotency)
  └──────────┘    │ access_tok. │             │
                  │  user+shop  │             ├──► mcp_tool_calls (telemetry, retention by tier)
                  │  scope+disabled_tools     │
                  └─────────────┘             ├──► write_log (audit okamžitých zápisů)
                                              │
                                              ├──► shop_memory + shop_memory_items
                                              │     (preferences + learned context)
                                              │
                                              └──► prompt_uses

   ┌─────────────────┐     ┌──────────────────┐
   │ admin_api_keys  │     │ prompt_categories│
   │  hash + prefix  │     │    + prompts     │
   └─────────────────┘     └──────────────────┘

   ┌──────────────────┐    ┌──────────────────┐    ┌─────────────────┐
   │ health_pings     │ →  │ health_daily     │    │   incidents     │
   │ raw probes       │    │ rollup per den   │    │ manual entries  │
   └──────────────────┘    └──────────────────┘    └─────────────────┘
```

## Tabulky podle účelu

### Identita & sessions
| Tabulka | Účel |
|---|---|
| `users` | E-mailem identifikovaný uživatel. `google_sub` = Google OIDC subject (link). |
| `sessions` | Server-side session (HttpOnly cookie `puls_session`, TTL 30 dnů, rolling refresh). |
| `magic_links` | Hashované 6-místné kódy pro e-mail login (TTL 10 min, max 5 atempts). |

### Platformová integrace
| Tabulka | Účel |
|---|---|
| `shops` | Hlavní entita. Multi-platform identita `(platform, external_id)` UNIQUE (od migrace `0010`; `external_id` nahradil dřívější `eshop_id integer`, base URL je generický `api_base_url`). Drží per-shop credentials (`api_login` + `api_key` šifrovaně pro Upgates Basic auth; `oauth_access_token` placeholder), `webhook_signature_key`, `mcp_endpoint_secret`. Dnes 1 record po prvním installu, reinstall = update. |
| `webhook_notifications` | Idempotency tabulka pro platformové webhooks. UNIQUE `(event, event_instance)` — duplicitní notifikace se zahodí. |
| `api_token_cache` | Legacy cache krátkodobých API tokenů per shop (1:1). Upgates používá statický Basic auth, takže se nepoužívá; tabulka zachována pro platformy s token-exchange. |

### MCP OAuth 2.1 (RFC 6749/7591/7636/8414/9728)
| Tabulka | Účel |
|---|---|
| `oauth_clients` | DCR-zaregistrovaní MCP klienti (Claude, Cursor, Inspector, ...). `client_id` UNIQUE. |
| `oauth_pending_sessions` | Krátkodobý state mezi `/oauth/authorize` a consent UI (`mcp_state` UNIQUE, TTL 10 min). Drží `code_challenge` a klientův `state`. |
| `oauth_authorization_codes` | Authorization codes po consentu. **Hash-only** (`code_hash` SHA-256, TTL 5 min, single-use přes `used` flag). |
| `oauth_access_tokens` | Bearer tokeny pro AI klienty. Hash-only, TTL **180 dnů**. Drží `(user_id, shop_id, scope, disabled_tools)` — token = projekce práv na konkrétní shop. |

### Pricing & gating
| Tabulka | Účel |
|---|---|
| `pricing_tiers` | Tarify se všemi limity (calls/day, memory items, retention, podpora SLA, ...). Spravované v `/admin/pricing`. **Nemažou se** — jen archivují (`archived_at`) nebo skrývají (`is_public=false`). |
| `tier_assignments` | Audit log všech tier změn. **Anti-freeride**: `idx_tier_assignments_eshop_tier` UNIQUE PARTIAL na `(eshop_id, 'trial')` — druhý trial pro stejný `eshop_id` se neinsertne. |

### Telemetry & audit
| Tabulka | Účel |
|---|---|
| `mcp_tool_calls` | Persistovaný log každého MCP volání (shop, tool, status, duration, sanitized args, error). Retence dle tieru (cron `log-retention`). |
| `write_log` | Audit log **okamžitých** zápisů (nahradil `pending_writes` v migraci `0012`). Statusy `applied | reverted | failed`; JSONB `before`/`after`/`result` snapshot; revertovatelné nástrojem `revert_write` (status → `reverted`, `reverted_at`). Žádná schvalovací fronta. Detail v [../mcp/write-tools-and-audit.md](../mcp/write-tools-and-audit.md). |

### Memory (per-shop)
| Tabulka | Účel |
|---|---|
| `shop_memory` | 1:1 ke `shops`. Drží pre-renderovaný `system_context` a `tool_contexts` blob, `prompt_version` pro cache invalidaci. |
| `shop_memory_items` | Granulární items (preference / context / learned / instruction), source (user / ai_learned), priority, applies_to_tools, confidence. Editovatelné v dashboardu i přes MCP tool `memory_set`. |

### Admin API & status page
| Tabulka | Účel |
|---|---|
| `admin_api_keys` | Hash-only long-lived API klíče pro `/api/admin/*`. UI prefix `sk_******xxxx` v listu. |
| `health_pings` | Raw výsledky probe (`web` / `mcp` / `upgates_api`) — každých 60s, TTL ~30 dnů přes daily rollup. |
| `health_daily` | Per-day per-component uptime % (driven public `/status` strip). |
| `incidents` | Manuální incidenty (status: investigating/identified/monitoring/resolved). JSONB timeline `updates[]`. |

### Prompt galerie
| Tabulka | Účel |
|---|---|
| `prompt_categories` | Kategorie (`id` text PK, např. `marketing`, `inventory`). |
| `prompts` | Veřejné prompty s body (markdown), `required_tools`, `required_consent`, `min_tier`, difficulty, view/use counters. |
| `prompt_uses` | Tracking, kdo prompt použil (user_id + shop_id). |

## Migrace

- **Drizzle Kit**: `task db:generate` vytvoří novou migraci z diff `schema.ts` proti DB.
- Migrace běží automaticky v entrypointu `app` containeru: `apps/web/Dockerfile` + `entrypoint.sh` → `pnpm drizzle-kit migrate`.
- Drizzle čte `apps/web/drizzle/migrations/meta/_journal.json` — **ne raw `.sql` soubory**. Když přidáš ručně novou `.sql`, musíš přidat řádek do `_journal.json` (`tag: '0009_...'`, `idx`, `when`).

| Migrace | Co přidává |
|---|---|
| `0000_init.sql` | Iniciální schema (users, sessions, shops, oauth_*, webhook_notifications, api_token_cache) |
| `0001_disabled_tools.sql` | `disabled_tools` CSV column do `oauth_authorization_codes` + `oauth_access_tokens` |
| `0002_mcp_tool_calls.sql` | Persistovaný telemetry log |
| `0003_shop_memory.sql` | Memory tabulky + enums |
| `0004_admin_api_keys.sql` | Long-lived admin API klíče |
| `0005_pricing_tiers.sql` | `pricing_tiers` + `tier_assignments` (anti-freeride index) |
| `0006_pending_writes.sql` | Approval queue *(později dropnuto migrací `0012`)* |
| `0007_status_page.sql` | `health_pings`, `health_daily`, `incidents` |
| `0008_prompt_gallery.sql` | `prompt_categories`, `prompts`, `prompt_uses` + seed |
| `0009_user_preferred_locale.sql` | `preferred_locale` na `users` (i18n CZ/SK/HU/EN) |
| `0010_multi_platform.sql` | `platform` diskriminátor, identita `(platform, external_id)`, `shoptet_api_base_url` → `api_base_url`, úprava anti-freeride indexu |
| `0011_prompt_tools_neutral.sql` | Přejmenování `required_tools` v prompt galerii na neutrální jména nástrojů (`shoptet_*` → `list_orders`, …) |
| `0012_brief_bishop.sql` | **DROP `pending_writes`** + CREATE `write_log` (enum `write_log_status` applied/reverted/failed) — přechod na okamžitý zápis + audit + revert |

## Backup / recovery

- Postgres v dev běží jako Docker volume (`postgres-data`).
- Prod: Coolify spravuje volume + backups (TBD detaily).
- Kritické tabulky pro full restore: `shops` (drží per-shop platformové credentials), `tier_assignments` (anti-freeride historie).
