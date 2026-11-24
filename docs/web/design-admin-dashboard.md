# Design — Admin Dashboard (Puls operators)

> **Cíl:** Provozovatel Pulse (= my, admin@example.com) má **single source of truth** o stavu produkce: kolik shopů, kolik MCP volání, co padá, kdo si stěžuje. Reaktivní operations + proaktivní monitoring.
> **Kdo se přihlašuje:** **JEDEN** admin email (zatím `admin@example.com`, později rozšířit přes role table). `session.user.email === ADMIN_EMAIL` check v layoutu.

---

## Auth & access

- Single admin pattern (Sprint 3): `ADMIN_EMAIL` env var, layout redirect na `/dashboard` jinak
- Sprint 5: rozšířit na `admins` tabulku s rolemi (super-admin, support, read-only)
- Cookie session 7 dní, magic link login
- Robots: `noindex, nofollow` na všech `/admin/*`

## Sidebar nav

```
┌─────────────────┐
│  Admin Puls     │
├─────────────────┤
│ 📊 Overview     │  /admin
│ 🏪 Shops        │  /admin/shops          ← ★ specific pro Puls
│ 🔧 Tools        │  /admin/tools          ← MCP tool registry + usage
│ 📜 Logs         │  /admin/logs           ← MCP call log + errors
│ 🪝 Webhooks     │  /admin/webhooks       ← všechny incoming webhooks
│ 👥 Users        │  /admin/users          ← admin users (Sprint 5)
│ 🔑 API Keys     │  /admin/api-keys       ← Shoptet client_id/secret + rotation
│ 📢 Announcement │  /admin/announcements  ← in-app banner pro klienty
│ 💬 Feedback     │  /admin/feedback       ← uninstall reasons, support tickets
│ ⚙️ System       │  /admin/system         ← env, DB stats, Redis, queue
└─────────────────┘
```

---

## Stránky

### `/admin` — Overview
**Goal:** Health check celého systému na 1 obrazovce.

Sekce:
1. **Big numbers** (4 hero stats):
   - Aktivních shopů: N (▲ změna vs minulý týden)
   - MCP volání 24h: 8 432
   - Error rate 24h: 0.4% (⚠️ je-li nad threshold)
   - MRR (calculated z plánů shopů): X Kč

2. **Health strip** (3 indikátory):
   - 🟢 API uptime 99.98% (30d)
   - 🟢 DB connection pool: 8/20
   - 🟢 Redis: OK / queue depth 0
   - 🟡 Shoptet API rate-limit fill: 38% průměr přes shopy
   - 🔴 Last error: 12m ago — `shoptet_list_orders timeout for shop_xyz`

3. **Recent installs** (timeline, 10 položek):
   - 2h ago — Shop "Elektro123" (eshopId 5482) — Pro plan
   - 6h ago — Shop "ModaShop" — Free plan
   - ...

4. **Recent uninstalls** (s reason když máme):
   - 1d ago — Shop "Test123" — reason: "moc drahé"

5. **Active alerts:**
   - ⚠️ Shop "BigEshop" má 23 errored MCP calls za hodinu — link na detail

### `/admin/shops` — Shops table
**Goal:** Najít konkrétní shop, vidět stav, manuálně zasáhnout.

Tabulka s search + filters:
| Shop | Domain | Status | Plan | Calls 24h | Errors | Installed | Action |
|---|---|---|---|---|---|---|---|
| Elektro123 | elektro123.myshoptet.com | 🟢 ACTIVE | Pro | 142 | 0 | 2026-04-12 | [Detail] |
| ModaShop | moda.shoptet.com | 🟡 PAUSED | Free | 0 | 0 | 2026-04-10 | [Detail] |

Filters: status (ACTIVE/PAUSED/UNINSTALLED), plan, errors > 0, installed range
Search: po názvu, domain, eshopId, shopId

Klik na řádek → detail page `/admin/shops/<id>`:
- Shop info (eshopId, domain, status, plán, install date, OAuth token expiry)
- Quick actions: **Pause**, **Force uninstall** (s confirmation), **Regenerate MCP secret**, **Impersonate** (= otevřít jako klient — kontroverzní, jen na request)
- Last 50 MCP calls
- Last 50 webhooks
- Tokens cache stav
- Audit log (kdo co kdy změnil)

### `/admin/tools` — MCP tool registry
**Goal:** Přehled co Puls nabízí, kolik se to používá, kde to padá.

Tabulka:
| Tool | Description | Calls 24h | Calls 7d | Errors 7d | Avg latency | P95 latency | Action |
|---|---|---|---|---|---|---|---|
| shoptet_list_orders | List orders... | 1 234 | 8 432 | 12 (0.1%) | 142 ms | 380 ms | [Detail] |
| shoptet_get_product | Get product... | 542 | 3 421 | 8 | 89 ms | 220 ms | [Detail] |
| echo | Test tool | 23 | 142 | 0 | 5 ms | 12 ms | [Detail] |

Klik na tool → /admin/tools/<name>:
- Schema (input/output)
- Histogram latency
- Top error messages
- Top users (shops)
- Calls timeline (last 7d)

### `/admin/logs` — MCP call log
**Goal:** Forensic — najít přesný request co padl.

Tabulka s pokročilými filters:
| Time | Shop | Tool | Status | Latency | Detail |
|---|---|---|---|---|---|
| 14:23:45 | shop_abc | shoptet_list_orders | ✅ 200 | 142 ms | [...] |
| 14:23:42 | shop_xyz | shoptet_get_product | ❌ 500 | 1234 ms | [...] |

Filters: time range, shop, tool, status (success/error), latency > Xms, error message contains
Export: CSV / JSON pro dev investigation
Detail modal: full request payload, response, error trace, headers (sanitized)

### `/admin/webhooks` — Incoming webhooks log
**Goal:** Vidět co nám Shoptet posílá, co jsme neuposlechli (HMAC fail), idempotency stats.

Tabulka:
| Time | Shop | Event | Signature | Processed | Detail |
|---|---|---|---|---|---|
| 14:23 | shop_abc | order:create | ✅ valid | ✅ | [...] |
| 14:22 | shop_xyz | addon:uninstall | ✅ valid | ⏳ pending | [...] |
| 14:20 | unknown | order:create | ❌ invalid HMAC | — | [...] (security alert) |

Special filter: `signature=invalid` → security incidents

### `/admin/users` — Admin users (Sprint 5+)
- Tabulka adminů (email, role, last login)
- Add/remove admin
- Audit log akcí adminů

### `/admin/api-keys` — Shoptet credentials
**Goal:** Bezpečně spravovat náš `client_id` + `client_secret` od Shoptetu.

- Aktuální Shoptet client_id (read-only display)
- Last rotation date
- Rotate button (s warning — vyžaduje re-install všech shopů)
- Webhook signature key per shop (audit table — read-only display)

### `/admin/announcements` — Klientské oznámení
**Goal:** Posílat plošné zprávy do client dashboardu (banner nahoře).

Form:
- Title
- Message (markdown)
- Severity: info / warning / error
- Show until (date)
- Target: all / Free / Pro / Premium / specific shop IDs
- [Publish]

Aktuální + minulé announcements list.

### `/admin/feedback` — Support & uninstall reasons
**Goal:** Vidět proč klienti odcházejí, sbírat NPS.

Sekce:
1. **Uninstall reasons** (last 30d) — automaticky zachycené při webhook `addon:uninstall` (Shoptet ti pošle reason)
2. **Support tickets** — když Sprint 5+ implementujeme support email/form
3. **NPS submissions** — Sprint 5+
4. **Reviews z marketplace** — scrape jednou denně z `doplnky.shoptet.cz/<slug>` (Sprint 5)

### `/admin/system` — System health
- DB connection pool stats (Drizzle metrics)
- Redis stats (memory, queue depth, key count)
- BullMQ jobs: pending / active / failed / completed (Sprint 4+)
- Env config dump (sanitized, secrets maskované)
- Recent migrations
- Build version + commit hash + deployed at
- Manual trigger: "Run health check pro všechny shopy" (Sprint 5+)

---

## Routes (Remix)

```
apps/web/app/routes/
├── admin._index.tsx              # /admin — Overview
├── admin.shops._index.tsx        # /admin/shops — table
├── admin.shops.$shopId.tsx       # /admin/shops/<id> — detail + actions
├── admin.tools._index.tsx
├── admin.tools.$name.tsx
├── admin.logs._index.tsx
├── admin.webhooks._index.tsx
├── admin.users._index.tsx        # Sprint 5+
├── admin.api-keys._index.tsx
├── admin.announcements._index.tsx
├── admin.feedback._index.tsx
└── admin.system._index.tsx
```

Layout `apps/web/app/routes/admin.tsx` (parent):
- Auth check: `session.user.email !== ADMIN_EMAIL` → redirect `/dashboard`
- AdminSidebar component
- Main content area

## Komponenty (`apps/web/app/components/admin/`)

| Komponenta | Použití |
|---|---|
| `AdminSidebar.tsx` | nav |
| `BigStatCard.tsx` | velké hero metriky na overview |
| `HealthStripIndicator.tsx` | green/yellow/red dot + label |
| `ShopsTable.tsx` | sortable, filterable, paginated |
| `ShopDetailCard.tsx` | shop header s actions |
| `MetricsHistogram.tsx` | latency distribuce (recharts) |
| `LogsTable.tsx` | virtualized scroll, filters |
| `JsonViewer.tsx` | pretty-print payloads (modal) |
| `AnnouncementForm.tsx` | publish form |
| `ConfirmActionDialog.tsx` | shadcn AlertDialog wrapper pro destruktivní akce |

## Data needed (queries) — nové tabulky pro Sprint 4+

```typescript
// apps/web/drizzle/schema.ts
export const mcpCallLogs = pgTable('mcp_call_logs', {
  id: text('id').primaryKey(),
  shopId: text('shop_id').references(() => shops.id),
  toolName: text('tool_name').notNull(),
  inputs: jsonb('inputs'),
  status: text('status').notNull(), // 'success' | 'error' | 'rate_limited'
  errorMessage: text('error_message'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  severity: text('severity'), // 'info' | 'warning' | 'error'
  targetTier: text('target_tier'), // null = all
  showUntil: timestamp('show_until'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const adminAuditLog = pgTable('admin_audit_log', {
  id: text('id').primaryKey(),
  adminEmail: text('admin_email').notNull(),
  action: text('action').notNull(), // 'shop.pause' | 'shop.regenerate' | ...
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

## Tech detaily
- **Same Tailwind/shadcn stack** jako client dashboard
- **Recharts** pro grafy (latency histograms, time series)
- **TanStack Table** pro velké tables (logs, shops) s virtualization
- **Lucide icons**
- **Server-side pagination** (limit 100/page)
- **CSV export** pro logs/shops přes Remix resource route
- **Real-time updates** (Sprint 5+) — SSE pro live logs view, jinak polling 30s

## Bezpečnost
- **Single admin email** v env (Sprint 3) — `ADMIN_EMAIL=admin@example.com`
- **2FA** Sprint 5+ (TOTP)
- **Audit log** všech mutativních akcí
- **Sensitive data masking** — OAuth tokeny, secrets nikdy v UI plně, jen `mask_xxx_last4`
- **Rate limit** na admin endpointy (anti-brute-force)
- **CORS:** admin endpointy odmítají cross-origin requests
- **CSP** strict (žádný inline JS)

## NON-GOALS (Sprint 3 — minimální viable admin)
- ❌ Tools detail page (jen list)
- ❌ Logs export (jen view)
- ❌ Announcements (Sprint 4+)
- ❌ Feedback page (Sprint 5+)
- ❌ Multi-admin role system (Sprint 5+)
- ❌ Real-time SSE updates (Sprint 5+)
- ❌ NPS/review scraping (Sprint 5+)
- ❌ Impersonate funkce (citlivé, jen na vyžádání ve Sprintu 5+)

## Acceptance pro Sprint 3 (minimální admin)
- [ ] Auth: `admin@example.com` se přihlásí, ostatní redirect
- [ ] `/admin` Overview s 4 big stats (z reálných query)
- [ ] `/admin/shops` table — list, search po name/domain, filter status
- [ ] `/admin/shops/<id>` detail — info + Pause/Resume akce + last 50 calls
- [ ] `/admin/logs` — table s filters (time, shop, tool, status), JSON viewer modal
- [ ] `/admin/webhooks` — table, signature valid/invalid filter
- [ ] `/admin/api-keys` — read-only display Shoptet creds (masked)
- [ ] `/admin/system` — DB/Redis/queue health
- [ ] AdminSidebar nav working, active route highlight
- [ ] All routes redirect non-admin na `/dashboard`
- [ ] Lighthouse A11y 95+ (admin nemusí být SEO)

## Sprint roadmap pro admin
- **Sprint 3:** routes 1-4 + auth (Overview, Shops, Logs, Webhooks, System)
- **Sprint 4:** Tools detail, Announcements, mcp_call_logs tabulka, BullMQ stats
- **Sprint 5:** Multi-admin, audit log UI, Feedback, NPS, marketplace reviews scrape, real-time SSE
