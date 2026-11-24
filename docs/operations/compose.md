# Docker Compose

Definice: [`docker-compose.yml`](../../docker-compose.yml). Orchestruje 6 služeb.

## Služby

### `postgres`
- Image: `postgres:16-alpine`
- Container: `puls-postgres`
- Port: `5432:5432` (host:container)
- Volume: `postgres_data:/var/lib/postgresql/data`
- ENV: `POSTGRES_USER=puls`, `POSTGRES_PASSWORD=puls`, `POSTGRES_DB=puls`
- Healthcheck: `pg_isready -U puls -d puls` každých 5s

### `redis`
- Image: `redis:7-alpine`
- Container: `puls-redis`
- Port: `6379:6379`
- Volume: `redis_data:/data` (AOF persistence on)
- Healthcheck: `redis-cli ping` každých 10s

### `mock-shoptet`
- Image: `stoplight/prism:5`
- Container: `puls-mock-shoptet`
- Port: `4010:4010`
- Volume: `./spec/shoptet-openapi.json:/tmp/shoptet-openapi.json:ro`
- Command: `mock -h 0.0.0.0 -p 4010 --multiprocess false /tmp/...`
- Healthcheck: ☓ (Prism nemá HTTP healthcheck)

### `mock-upgates`
- Image: `stoplight/prism:5`
- Container: `puls-mock-upgates`
- Port: `4011:4011`
- Volume: `./spec/upgates-openapi.json:/tmp/upgates-openapi.json:ro`
- Command: `mock -h 0.0.0.0 -p 4011 --multiprocess false /tmp/...`
- Healthcheck: ☓ (Prism nemá HTTP healthcheck)

### `app` (web)
- Build: `apps/web/Dockerfile`
- Container: `puls-app`
- Port: `${APP_PUBLISH:-3000}:3000` (default `3000`; `task e2e` přepíná na `13000`)
- Volumes:
  - `./apps/web:/repo/apps/web` (bind mount pro HMR)
  - `./packages:/repo/packages`
  - `./package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Healthcheck: `curl -sf http://127.0.0.1:3000/healthz` každých 5s, retries 90, start_period 30s
- depends_on: postgres healthy, redis healthy, mock-shoptet + mock-upgates started
- Entrypoint: instaluje pnpm + buildí workspace balíky (`@puls/db`, `@puls/platform-core`, `@puls/ecommerce-common`, `@puls/shoptet-client`, `@puls/upgates-client`) (kvůli bind mountu, který přepíše obraz layery), pak `drizzle-kit migrate`, pak `dev` server

### `mcp`
- Build: `apps/mcp-server/Dockerfile`
- Container: `puls-mcp`
- Port: `${MCP_PUBLISH:-3001}:3001` (default `3001`; `task e2e` na `13001`)
- Healthcheck: `curl -sf http://127.0.0.1:3001/health`
- depends_on: app healthy (sdílí packages volume → musí být buildnuté než MCP startne)

### `e2e` (profile only)
Profile `e2e` — startne se jen přes `docker compose --profile e2e run --rm e2e ...`. Image: pickuje Node + Playwright, mountuje repo.

## Profily

| Profile | Služby |
|---|---|
| (default) | postgres, redis, mock-shoptet, mock-upgates, app, mcp |
| `e2e` | + `e2e` runner container |

`task e2e` spouští `docker compose --profile e2e run --rm e2e bash -lc "..."`.

## Síť

Všechny služby v default network `puls-mcp_default`. Hostnamy v networku:
- `postgres:5432`
- `redis:6379`
- `mock-shoptet:4010`
- `mock-upgates:4011`
- `app:3000`
- `mcp:3001`

Z hostu (mac/linux) přes published ports:
- `localhost:5432, 6379, 4010, 4011, 3000 (nebo 13000), 3001 (nebo 13001)`

## Volume persistence

```
postgres_data    — Postgres DB
redis_data       — Redis AOF
```

Wipe state: `docker compose down -v` (smaže volumes — všechny shopy, sessions, ...).

## Bind mount caveat

`./apps/web` a `./apps/mcp-server` bind-mount **přepíše** prebuilt layery z Dockerfile. Entrypoint kompenzuje:
1. `pnpm install --frozen-lockfile`
2. build workspace balíků (`@puls/db` … `@puls/shoptet-client`, `@puls/upgates-client`)
3. `drizzle-kit migrate` (jen v app)
4. `pnpm dev` (vite/express)

Důsledek: stack naběhne i z čistého clonu **bez lokálního `pnpm install`**.

## Healthchecks & start order

```
postgres healthy ──┬─► app builds packages → migrate → dev → healthy
redis healthy ─────┤                                            │
mocky started ────────┘                                          │
                                                                 ▼
                                                            mcp builds itself → start
```

`mcp` čeká na `app` healthy aby paralelní zápisy do `packages/*/dist` nezasáhly.

## Quickstart

```bash
cp .env.example .env       # (TODO: not committed yet)
docker compose build
docker compose up -d
docker compose logs -f app mcp
# Web: http://localhost:3000
# MCP: http://localhost:3001/health
# Mock: http://localhost:4010 (Shoptet), http://localhost:4011 (Upgates)
```

Nebo:
```bash
task dev         # build + up + tail logs
task health      # PG ready + /healthz + MCP /health
task stop        # down (keeps volumes)
```

## Production deployment

V production běží na **Coolify** (single instance). Důležité:
- Bind mount není v prod (Dockerfile staví self-contained image).
- Volumes mapované na Coolify-managed disky.
- Reverse proxy (Coolify nginx) terminuje TLS, předává `X-Forwarded-Proto: https`.
- Cron joby běží **in-process** (viz [../architecture/scheduler-and-jobs.md](../architecture/scheduler-and-jobs.md)).
- Backups: Coolify Postgres backup schedule.
