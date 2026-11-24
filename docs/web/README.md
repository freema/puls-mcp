# Web — kompletní inventář route

`apps/web` je React Router 7 SSR aplikace. Soubory v `apps/web/app/routes/` mapují na URL přes file-based router (jména s `.` zastupují `/`, `$` parametry, `_index` index route, `_layout` outlet wrapper).

## Mapa route

### Public (bez login)

Marketingová vrstva (homepage, pricing, blog, prompt galerie, právní stránky, kontakt, public status, sitemap, llms.txt) byla při archivaci projektu odstraněna. Zbývá:

| Route | Soubor | Účel |
|---|---|---|
| `/` | `_index.tsx` | Statický anglický přehled archivovaného projektu (banner, jak to fungovalo, tech, odkazy na GitHub + `/login`) + RFC 8288 `Link` discovery header |
| `/robots.txt` | `robots[.]txt.tsx` | `Disallow: /` |
| `/maintenance` | `maintenance.tsx` | Custom maintenance page |
| `/healthz` | `healthz.tsx` | Liveness probe — `runHealthChecks()` |

### Auth (login wall)
| Route | Soubor | Účel |
|---|---|---|
| `/login` | `login.tsx` | E-mail input → odešle 6-místný kód |
| `/login/verify` | `login.verify.tsx` | Verify kód → vytvoří session |
| `/auth/google` | `auth.google.tsx` | Start Google OIDC (state cookie) |
| `/auth/google/callback` | `auth.google.callback.tsx` | OIDC callback → ensure user → session |
| `/auth/logout` | `auth.logout.tsx` | POST → destroy session, redirect / |
| `/auth/mcp-connect` | `auth.mcp-connect.tsx` | OAuth consent UI (po `/oauth/authorize`) |

Detail v [auth.md](auth.md), [../oauth/authorize-and-consent.md](../oauth/authorize-and-consent.md).

### Klient dashboard (login required, owner-only)
| Route | Soubor | Účel |
|---|---|---|
| `/dashboard` | `dashboard._index.tsx` | Redirect na `/dashboard/:shopId` (1 shop) nebo `/dashboard/select` |
| `/dashboard/select` | `dashboard.select.tsx` | Multi-shop picker |
| `/dashboard/:shopId` | `dashboard.$shopId.tsx` | Layout s sidebar (`Outlet`) |
| `/dashboard/:shopId` (index) | `dashboard.$shopId._index.tsx` | Přehled — MCP URL, quick stats, usage chart, recent activity |
| `/dashboard/:shopId/activity` | `dashboard.$shopId.activity.tsx` | Last 100 tool calls |
| `/dashboard/:shopId/tools` | `dashboard.$shopId.tools.tsx` | Live `tools/list` z MCP serveru pro tento shop |
| `/dashboard/:shopId/connections` | `dashboard.$shopId.connections.tsx` | Aktivní MCP klienti (oauth_access_tokens), revoke |
| `/dashboard/:shopId/write-history` | `dashboard.$shopId.write-history._index.tsx` | Historie zápisů — audit log `write_log` |
| `/dashboard/:shopId/write-history/:id` | `dashboard.$shopId.write-history.$id.tsx` | Detail zápisu — diff before/after + revert |
| `/settings/:shopId` | `settings.$shopId.tsx` | Iframe verze dashboardu pro Shoptet admin |
| `/nastaveni` | `nastaveni.tsx` | User account settings |
| `/nastaveni/delete-account` | `nastaveni.delete-account.tsx` | Hard delete account + cascade |

Detail v [client-dashboard.md](client-dashboard.md), [settings-iframe.md](settings-iframe.md).

### Admin (login + admin email match)
| Route | Soubor | Účel |
|---|---|---|
| `/admin` | `admin.tsx` (layout) + `admin._index.tsx` | Overview — KPI cards, health strip, calls chart, recent installs/webhooks |
| `/admin/shops` | `admin.shops._index.tsx` | List 200 nejnovějších shopů |
| `/admin/shops/:shopId` | `admin.shops.$shopId.tsx` | Shop detail — metadata, masked secrets, webhooks, tier history, tier change form |
| `/admin/pricing` | `admin.pricing._index.tsx` | Tier list + shop counts |
| `/admin/pricing/:tierId` | `admin.pricing.$tierId.tsx` | Edit tier (limity, features, public flag) |
| `/admin/logs` | `admin.logs._index.tsx` | Tool call log (filter shop/status/tool, last 300) |
| `/admin/webhooks` | `admin.webhooks._index.tsx` | Webhook notifications (filter, last 250) |
| `/admin/api-keys` | `admin.api-keys._index.tsx` | Long-lived admin API keys + per-shop secrets list |
| `/admin/emails` | `admin.emails._index.tsx` | Preview e-mail šablon (subject, html, text) |
| `/admin/prompts` | `admin.prompts._index.tsx` | List všech promptů (i unpublished) |
| `/admin/prompts/new` | `admin.prompts.new.tsx` | Create form |
| `/admin/prompts/:id` | `admin.prompts.$id.tsx` | Edit form |
| `/admin/system` | `admin.system._index.tsx` | Health JSON, Redis info, applied migrations, Node version |
| `/admin/status` | `admin.status._index.tsx` | List incidentů |
| `/admin/status/new` | `admin.status.new.tsx` | Vytvořit incident |
| `/admin/status/:id` | `admin.status.$id.tsx` | Edit incidentu (timeline updates, resolved flag) |

Detail v [admin.md](admin.md).

### Shoptet integrace API (machine endpoints)
| Route | Soubor | Účel |
|---|---|---|
| `POST /api/install` | `api.install.tsx` | Shoptet install handshake (5s limit) |
| `POST /api/webhooks` | `api.webhooks.tsx` | Webhook receiver (HMAC verify, idempotency) |
| `GET /api/cron` | `api.cron.tsx` | Cron job trigger (Bearer `CRON_SECRET`) |

Detail v [../shoptet/install-flow.md](../shoptet/install-flow.md), [../shoptet/webhooks.md](../shoptet/webhooks.md), [../architecture/scheduler-and-jobs.md](../architecture/scheduler-and-jobs.md).

### Public Admin API (Bearer api-key)
| Route | Soubor | Účel |
|---|---|---|
| `GET /api/admin/shops` | `api.admin.shops.tsx` | List všech shopů |
| `GET /api/admin/stats` | `api.admin.stats.tsx` | Tool call stats (totals, by tool, by shop) |
| `GET /api/admin/logs` | `api.admin.logs.tsx` | Filtered tool call log |
| `GET /api/admin/system` | `api.admin.system.tsx` | DB + Redis ping |

Detail v [../operations/admin-api.md](../operations/admin-api.md).

### MCP OAuth Authorization Server
| Route | Soubor | Účel |
|---|---|---|
| `GET /oauth/authorize` | `oauth.authorize.tsx` | Start OAuth flow (validuje params, ukládá pending) |
| `POST /oauth/register` | `oauth.register.tsx` | Dynamic Client Registration (DCR) |
| `POST /oauth/token` | `oauth.token.tsx` | Token exchange (PKCE S256) |
| `GET /.well-known/oauth-authorization-server` | `well-known.oauth-authorization-server.tsx` | RFC 8414 metadata |
| `GET /.well-known/oauth-protected-resource` | `well-known.oauth-protected-resource.tsx` | RFC 9728 metadata (mirror MCP RS) |

Detail v [../oauth/](../oauth/).

### Catch-all
| Route | Soubor | Účel |
|---|---|---|
| `/*` | `$.tsx` | 404 page |

## Komponenty

### Dashboard (`app/components/dashboard/`)
| Komponenta | Použití |
|---|---|
| `client-top-bar.tsx` | Header dashboard (shop name, quota, user menu) |
| `client-sidebar.tsx` | Sidebar nav (Přehled, Activity, Tools, Historie zápisů, Připojené aplikace) |
| `mcp-url-card.tsx` | Copy-paste MCP URL + návod |
| `quick-stats-grid.tsx` | KPI cards (calls today, errors, ...) |
| `usage-chart.tsx` | 30-day usage line chart |
| `activity-table.tsx` | Recent tool calls table |
| `tools-list.tsx` | Live tools/list rendering |
| `trial-banner.tsx` | Trial active / expired banner |
| `embed-chrome.tsx` | EmbedHeader + EmbedFooter pro `/settings/:shopId` iframe |

### Admin (`app/components/admin/`)
| Komponenta | Použití |
|---|---|
| `admin-top-bar.tsx` | Admin header s user email |
| `admin-sidebar.tsx` | Admin nav (Overview, Shops, Pricing, Logs, ...) |
| `big-stat-card.tsx` | KPI stat card (count + label) |
| `health-strip-indicator.tsx` | Per-component health dot |
| `admin-calls-chart.client.tsx` | 24h calls chart (client-only Recharts) |
| `shops-table.tsx` | Shop list table |
| `prompt-form.tsx` | Sdílený create/edit form pro prompty |

### Auth (`app/components/auth/`)
| Komponenta | Použití |
|---|---|
| `auth-shell.tsx` | Login/verify shell (logo, banner, primary button styles, GoogleG icon) |

### Sdílené (`app/components/`)
| Komponenta | Použití |
|---|---|
| `header.tsx` | `SiteHeader` — top bar s loginem / user menu (dashboard select, nastavení) |
| `puls-logo.tsx` | SVG logo |
| `user-menu.tsx` | Dropdown s logout |
| `error/` | Error boundary komponenty |
| `ui/` | Generic UI primitives (button, badge, nice-select) |

## Layouty (parent route)

- `admin.tsx` — admin shell (sidebar + topbar), guard `requireSessionUser` + `isAdminEmail`
- `dashboard.$shopId.tsx` — shop dashboard shell (sidebar + topbar), guard `shop.adminEmail === user.email`

## Cross-cutting concerns

- **Session cookie**: `puls_session` (HttpOnly, SameSite=None v prod kvůli iframe, Lax v dev). Code: [`lib/auth/session.server.ts`](../../apps/web/app/lib/auth/session.server.ts).
- **In-process scheduler**: bootnutý v `entry.server.tsx` přes `ensureScheduler()` — viz [../architecture/scheduler-and-jobs.md](../architecture/scheduler-and-jobs.md).
- **Logger**: Pino + pino-pretty v dev. Code: [`lib/logger.ts`](../../apps/web/app/lib/logger.ts).
- **Sentry**: pokud `SENTRY_DSN`. Code: [`lib/sentry.ts`](../../apps/web/app/lib/sentry.ts) (TODO if exists).
