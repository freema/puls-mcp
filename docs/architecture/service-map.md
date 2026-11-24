# Service map

Runtime topology when running locally via `docker compose`. Mirror diagram for the team — not for users.

## Services

| Service        | Port (host) | Port (in net) | Image / build                      | Healthcheck                |
| -------------- | ----------- | ------------- | ---------------------------------- | -------------------------- |
| `postgres`     | 5432        | 5432          | `postgres:16-alpine`               | `pg_isready`               |
| `redis`        | 6379        | 6379          | `redis:7-alpine`                   | `redis-cli ping`           |
| `mock-upgates` | 4011        | 4011          | `stoplight/prism:5`                | (none — Prism is stateless) |
| `app` (web)    | `${APP_PUBLISH:-3000}` | 3000 | `apps/web/Dockerfile`        | `GET /healthz`             |
| `mcp`          | `${MCP_PUBLISH:-3001}` | 3001 | `apps/mcp-server/Dockerfile` | `GET /health`              |
| `e2e`          | —           | —             | `mcr.microsoft.com/playwright:v1.50.0-jammy` | (one-shot test runner) |

## Who calls whom

```
   Platforma — Upgates (real or mock)
       ▲                   ▲
       │ Upgates REST      │ webhook POST (per-shop secret)
       │                   │
   ┌───┴───────────────────┴────┐
   │            app             │     ← Browser (user, dashboard, admin)
   │  Remix (apps/web)          │     ← Upgates addon aktivační callback
   │  /api/upgates/install      │
   │  /oauth/authorize          │
   │  /oauth/token              │
   │  /oauth/register (DCR)     │
   │  /auth/mcp-connect         │
   │  /.well-known/oauth-*      │
   └───┬─────────┬──────────────┘
       │         │
       │         │ DB (drizzle)
       ▼         ▼
   Postgres    Redis (rate limits, login codes, MCP stats)
       ▲
       │ DB (drizzle, read-only-ish)
   ┌───┴────────────────────────┐
   │           mcp              │     ← LLM clients (Claude, Cursor, Inspector)
   │  apps/mcp-server           │       talk Streamable HTTP + Bearer token
   │  /mcp                      │
   │  /.well-known/oauth-*      │
   └───┬────────────────────────┘
       │
       │ Upgates REST (per-shop Basic auth creds from DB)
       ▼
   mock-upgates (Prism over spec/upgates-openapi.json)
```

## Environment per service

### `app`
- `DATABASE_URL` → postgres
- `REDIS_URL` → redis
- `UPGATES_API_BASE_URL` → mock-upgates inside compose, real Upgates in prod (fallback; per-shop `apiBaseUrl` z aktivace má přednost)
- `UPGATES_SIGNATURE_TOKEN`, `UPGATES_SIGNATURE_PUBKEY` — ověření aktivačního `signature_v2`
- `MCP_INTERNAL_URL`, `MCP_PUBLIC_ORIGIN` — for cross-linking
- `ADMIN_EMAIL` — gates `/admin`
- `AUTH_GOOGLE_*` — Google OAuth (skipped in e2e)
- `SMTP_*` / `RESEND_API_KEY` / `EMAIL_FROM` — login code email
- `PULS_LOG_MAIL=1` — also log mail subject when actually sent

### `mcp`
- `DATABASE_URL`, `REDIS_URL`
- `UPGATES_API_BASE_URL` — same as app (fallback)
- `MCP_PUBLIC_ORIGIN` (optional) — origin announced in `WWW-Authenticate` resource_metadata
- `WEB_PUBLIC_ORIGIN` (optional) — origin used as authorization_server in metadata; defaults to MCP_PUBLIC_ORIGIN

### `mock-upgates`
- Mounts `spec/upgates-openapi.json`.
- Returns OpenAPI `example` payloads. Prism is stateless — same example every call.

## Test surfaces

| Layer                | Lives in                                | Runs against                         |
| -------------------- | --------------------------------------- | ------------------------------------ |
| Unit                 | `apps/web/tests`, `apps/mcp-server/tests`, `packages/*/tests` | Vitest, mocked deps |
| Upgates client       | `packages/upgates-client/tests`         | Vitest + msw / fetch mocks           |
| E2E (full compose)   | `tests-e2e/tests`                       | docker compose (`--profile e2e`) — Playwright drives `app`, calls `mcp`, hits `mock-upgates` |

## E2E flow shapes

1. **Upgates addon aktivace** — aktivační callback na `/api/upgates/install` (s `signature_v2`) → app ověří podpis, persistuje shop s per-shop credentials; `adminEmail` z `/owner` lookupu (mock `owner@example.test`).
2. **User login** — magic-link via `/login` + `/login/verify`, or seeded session via `tests-e2e/helpers/session.ts:seedBrowserSession`.
3. **MCP OAuth** — DCR via `POST /oauth/register` → `GET /oauth/authorize` (redirect to `/auth/mcp-connect` consent) → form post returns `redirect_uri?code=…&state=…` → `POST /oauth/token` (PKCE S256) → `access_token` bound to user + shop + scope/disabledTools.
4. **Tool execution** — `POST /mcp` with `Authorization: Bearer …`. MCP server resolves shop from token, filters tools by `disabledTools`, calls the platform connector (`@puls/upgates-client`) which talks to mock-upgates.
