# Environment proměnné

Kompletní seznam co kde se používá. Defaults v compose, override přes `.env` v repo root.

## App (`apps/web`)

### Database & infrastruktura
| Proměnná | Default (compose) | Účel |
|---|---|---|
| `DATABASE_URL` | `postgresql://puls:puls@postgres:5432/puls` | Postgres connection |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `PORT` | `3000` | Web HTTP port |
| `NODE_ENV` | `development` | Standard Node env. **Production** → `Secure` cookies, `SameSite=None`, build optimizations |

### Platformová integrace (Upgates)
| Proměnná | Default | Účel |
|---|---|---|
| `UPGATES_API_BASE_URL` | `http://mock-upgates:4011` | Fallback base URL pro Upgates API. Per-shop `apiBaseUrl` z aktivace má přednost. |
| `UPGATES_SIGNATURE_TOKEN` | `puls-upgates-signature-token` | Token pro ověření aktivačního callbacku. |
| `UPGATES_SIGNATURE_PUBKEY` | (PEM / base64 PEM v compose) | Veřejný klíč Upgates pro ověření `signature_v2`. Prod fetchuje z `files.upgates.com`; override env (PEM nebo base64 PEM) pro dev/test. |


### Platformová integrace (Shoptet)
| Proměnná | Default | Účel |
|---|---|---|
| `SHOPTET_API_BASE_URL` | `http://mock-shoptet:4010` | Base URL pro Shoptet API (OAuth server + fallback API endpoint). Bez ní je Shoptet install vypnutý. |
| `SHOPTET_CLIENT_ID` | `mock-client-id` | OAuth client ID přidělené Shoptetem |
| `SHOPTET_CLIENT_SECRET` | `mock-client-secret` | OAuth client secret |
| `SHOPTET_REDIRECT_URI` | `http://localhost/oauth/callback` | OAuth callback registrovaný v Shoptetu (prod `https://<web>/api/install`) |

Všechny `SHOPTET_*` jsou volitelné — bez nich běží jen Upgates a `POST /api/install` vrátí chybu „Shoptet install is not configured".
### Auth & admin
| Proměnná | Default | Účel |
|---|---|---|
| `ADMIN_EMAIL` | `admin@example.com` | Comma-separated whitelist emailů s admin přístupem |
| `AUTH_GOOGLE_ID` | (empty) | Google OIDC client ID. Prázdné → Google sign-in skrytý |
| `AUTH_GOOGLE_SECRET` | (empty) | Google OIDC secret |
| `AUTH_GOOGLE_REDIRECT_URI` | (empty, defaults to `<origin>/auth/google/callback`) | OAuth callback |

### MCP
| Proměnná | Default | Účel |
|---|---|---|
| `MCP_INTERNAL_URL` | `http://mcp:3001` | Server-to-server URL (pro `lib/mcp-tools.server.ts` při fetch tools/list) |
| `MCP_PUBLIC_ORIGIN` | `http://localhost:3001` | Veřejné URL MCP serveru — vrácené v OAuth metadata |
| `WEB_PUBLIC_ORIGIN` | (auto-derived from request) | Veřejné URL webu — `issuer` v OAuth metadata. V prod nastavit explicit. |

### E-mail
| Proměnná | Default | Účel |
|---|---|---|
| `SMTP_HOST` | (empty) | SMTP server (např. `smtp.example.com`) |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | TLS on (true pro 465) |
| `SMTP_USER` | (empty) | |
| `SMTP_PASS` | (empty) | |
| `SMTP_FROM` | (empty) | From address |
| `RESEND_API_KEY` | (empty) | Alternative: Resend.com API |
| `EMAIL_FROM` | (empty) | From pro Resend |
| `PULS_LOG_MAIL` | `0` | Pokud `1`, e-maily se logují místo posílání (dev) |

### Cron
| Proměnná | Default | Účel |
|---|---|---|
| `CRON_SECRET` | `puls-cron-test-secret` | Bearer pro `/api/cron` endpoint. V prod nastavit silný random. |
| `PULS_DISABLE_SCHEDULER` | (empty) | Pokud `1`, in-process scheduler se nestartuje (test bypass — viz `e2e` profile) |

### Loggers & observability
| Proměnná | Default | Účel |
|---|---|---|
| `LOG_LEVEL` | (empty → Pino default `info`) | Pino log level (`trace|debug|info|warn|error|fatal`) |
| `SENTRY_DSN` | (empty) | Pokud nastaveno, captures chyby. Společné pro app + mcp. |
| `SENTRY_ENV` | `NODE_ENV` value | Sentry environment tag |

## MCP server (`apps/mcp-server`)

| Proměnná | Default | Účel |
|---|---|---|
| `DATABASE_URL` | sdílí s app | Stejný cluster |
| `REDIS_URL` | sdílí s app | Pro daily rate limit counters |
| `UPGATES_API_BASE_URL` | `http://mock-upgates:4011` | Fallback base URL (per-shop `apiBaseUrl` z aktivace má přednost) |
| `UPGATES_SIGNATURE_TOKEN` / `UPGATES_SIGNATURE_PUBKEY` | viz app | Ověření aktivačního `signature_v2` |
| `SHOPTET_API_BASE_URL` | `http://mock-shoptet:4010` | Fallback base URL pro Shoptet API + token exchange (per-shop `apiBaseUrl` má přednost) |
| `PORT` | `3001` | MCP HTTP port |
| `MCP_PUBLIC_ORIGIN` | `http://localhost:3001` | Issuer v OAuth metadata |
| `WEB_PUBLIC_ORIGIN` | (auto) | Authorization server origin |
| `LOG_LEVEL` | (empty → `info`) | Pino |
| `SENTRY_DSN` | (empty) | |

## E2E test container

| Proměnná | Default | Účel |
|---|---|---|
| `BASE_URL_WEB` | `http://app:3000` | Containerový hostname — Playwright access do app |
| `BASE_URL_MCP` | `http://mcp:3001` | MCP container URL |
| `DATABASE_URL` | sdílí | Pro `seedBrowserSession`, install helpers |
| `DEBUG_E2E` | (empty) | Pokud `1`, verbose logging v consent driver |

## Production checklist

Před deployment:

- [ ] `NODE_ENV=production`
- [ ] `WEB_PUBLIC_ORIGIN=https://pulsmcp.com`
- [ ] `MCP_PUBLIC_ORIGIN=https://pulsmcp.com` (sdílí doménu, různé routes)
- [ ] `DATABASE_URL=postgresql://...` (Coolify managed)
- [ ] `REDIS_URL=redis://...` (Coolify managed)
- [ ] `UPGATES_API_BASE_URL` — fallback endpoint (per-shop `apiBaseUrl` z aktivace má přednost)
- [ ] `UPGATES_SIGNATURE_TOKEN` — z Upgates partner portálu
- [ ] `UPGATES_SIGNATURE_PUBKEY` — prod fetchuje z `files.upgates.com`; nastavit jen pokud chceš override
- [ ] `SHOPTET_API_BASE_URL` / `SHOPTET_CLIENT_ID` / `SHOPTET_CLIENT_SECRET` — z Shoptet partner administrace (jen pokud běží Shoptet doplněk)
- [ ] `SHOPTET_REDIRECT_URI=https://pulsmcp.com/api/install`
- [ ] `ADMIN_EMAIL=admin@example.com` (případně další oddělené čárkou)
- [ ] `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — z Google Cloud Console
- [ ] `AUTH_GOOGLE_REDIRECT_URI=https://pulsmcp.com/auth/google/callback`
- [ ] `SMTP_*` nebo `RESEND_API_KEY` — pro magic link / trial reminder e-maily
- [ ] `EMAIL_FROM=Puls <noreply@pulsmcp.com>`
- [ ] `CRON_SECRET=<32+ char random>`
- [ ] `SENTRY_DSN=https://...@sentry.io/...`
- [ ] Healthcheck endpoint `/healthz` exposed přes Coolify proxy

## .env example (TODO commit)

```bash
# Local dev (mock everything)
UPGATES_API_BASE_URL=http://mock-upgates:4011
UPGATES_SIGNATURE_TOKEN=puls-upgates-signature-token
# UPGATES_SIGNATURE_PUBKEY=<PEM nebo base64 PEM> (default v compose)
SHOPTET_API_BASE_URL=http://mock-shoptet:4010
SHOPTET_CLIENT_ID=mock-client-id
SHOPTET_CLIENT_SECRET=mock-client-secret
SHOPTET_REDIRECT_URI=http://localhost/oauth/callback
ADMIN_EMAIL=ja@example.com
PULS_LOG_MAIL=1               # log e-maily místo SMTP
CRON_SECRET=local-dev-secret

# Optional
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
SENTRY_DSN=...
```
