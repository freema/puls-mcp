# Scheduler & background jobs

Puls má jednu instanci `app` containeru, takže místo externího cron systému (Coolify cron, k8s CronJob) běží **in-process scheduler** přímo v Node procesu webu. Druhý kanál — `/api/cron` HTTP endpoint — zůstává pro deterministické testovací triggery a fallback (např. po deploymentu, kde chceme ručně forcnout job).

## In-process scheduler

Soubor: [`apps/web/app/lib/scheduler.server.ts`](../../apps/web/app/lib/scheduler.server.ts)

Boot: `apps/web/app/entry.server.tsx` zavolá `ensureScheduler()` při prvním server renderu. Implementace je idempotentní přes `globalThis.__pulsScheduler` / `__pulsHealthPinger` guard, takže HMR ani vícenásobné importy duplicitní intervaly nevytvoří.

### Aktivní loops

| Loop | Interval | Co dělá | Code path |
|---|---|---|---|
| **Health pinger** | 60s (po 7s startup delay) | `probeAndRecord` (web/mcp/upgates_api do `health_pings`) + `maybeDailyRollup` (rollup yesterday → `health_daily`) | `lib/cron/health-pinger.server.ts` |

> **Pozn.:** Dřívější loop „Pending writes" (`executeApprovedWrites` + `expirePendingWrites`) byl **zrušen** spolu se schvalovací frontou. Write zápisy jsou dnes okamžité (synchronní) přímo v MCP tool handleru — viz [../mcp/write-tools-and-audit.md](../mcp/write-tools-and-audit.md). Žádný background worker pro zápisy už neexistuje.

### Zásady

- **Reentrant guard**: každý loop drží lokální `running = true` flag, druhý tick se přeskočí pokud první ještě běží.
- **`unref()`**: timer se neudržuje proces alive. Když se app vypíná, scheduler se zastaví bez extra logiky.
- **Single replica only**: pokud bude potřeba scale-out, přepnout na Postgres `pg_advisory_lock(...)` leader election. Dnes single instance, simple interval stačí.
- **Test bypass**: nastav `PULS_DISABLE_SCHEDULER=1` (compose profile `e2e` v `e2e.spec.ts` to využívá pro deterministické dispatch přes `/api/cron`).

## Externí cron endpoint (test trigger)

Soubor: [`apps/web/app/routes/api.cron.tsx`](../../apps/web/app/routes/api.cron.tsx)

`GET /api/cron?job=<name>` s `Authorization: Bearer <CRON_SECRET>`. Bez `CRON_SECRET` v ENV vrátí 503 (záměrně bezpečnost, žádné hidden default).

### Joby

| `?job=` | Funkce | Co dělá |
|---|---|---|
| `trial-reminders` | `runTrialReminders` | D-3 a D-1 e-maily před koncem trialu |
| `trial-expiry` | `expireTrials` | Přepne expirované trial shopy na `PAUSED` + pošle email |
| `log-retention` | `pruneActivityLog` | Smaže `mcp_tool_calls` starší než tier retention |
| `trial-purge` | `pruneExpiredTrials` | Smaže data shopů po grace period od `trial_expired` |
| `status-pinger` | `probeAndRecord` | Probe + zápis do `health_pings` (test trigger) |
| `status-rollup` | `rollupYesterday` | Rollup health_pings yesterday → health_daily (test trigger) |
| `all` (default) | Všechny v pořadí | Pro denní k8s CronJob/Coolify cron, pokud bude potřeba |

### Doporučené cron schedule (až přejdeme na externí scheduler)

```
*/1 * * * *    /api/cron?job=status-pinger
0 */1 * * *    /api/cron?job=status-rollup        # každou hodinu zkusíme i mid-day rollup, idempotent
0 6 * * *      /api/cron?job=trial-reminders      # ráno 6:00 UTC
0 7 * * *      /api/cron?job=trial-expiry         # po reminderech
0 3 * * *      /api/cron?job=log-retention        # 3:00 UTC
0 4 * * 0      /api/cron?job=trial-purge          # neděle 4:00
```

## Health pinger

Code: [`apps/web/app/lib/cron/health-pinger.server.ts`](../../apps/web/app/lib/cron/health-pinger.server.ts)

### `probeAndRecord(db)`
- Probe každé z `('web', 'mcp', 'upgates_api')`:
  - `web`: GET `WEB_PUBLIC_ORIGIN/healthz` (5s timeout)
  - `mcp`: GET `MCP_PUBLIC_ORIGIN/health`
  - `upgates_api`: HEAD `UPGATES_API_BASE_URL`
- Status rule: `< 2000ms` = `up`, `2000-5000ms` = `degraded`, fail nebo timeout = `down`.
- Insert do `health_pings`.

### `maybeDailyRollup(db)`
- Pokud poslední `health_daily` row pro yesterday ještě neexistuje, agreguje `health_pings` z předevčerejška-yesterday a insertne.
- Idempotentní (UNIQUE PK `(day, component)`).

### `rollupYesterday(db)`
- Force-rollup yesterday (test trigger / catch-up).

## Trial cron joby

Code: [`apps/web/app/lib/cron/trial-expiry.server.ts`](../../apps/web/app/lib/cron/trial-expiry.server.ts)

| Funkce | Co dělá |
|---|---|
| `runTrialReminders(db)` | Najde shopy s `trial_ends_at` v okně `[now+24h, now+96h]` a pošle "trial končí D-3" / "trial končí D-1" email (deduplicated přes flag v shop record nebo Redis). |
| `expireTrials(db)` | Najde shopy s `trial_ends_at < now` a `tier_id = 'trial'`. Přepne `status = 'PAUSED'`, posílá email "trial vypršel". MCP volání pak vrací 402. |
| `pruneActivityLog(db)` | Per-tier `activity_retention_days` z `pricing_tiers` → smaže `mcp_tool_calls` starší. |
| `pruneExpiredTrials(db)` | Po grace period (např. 30 dnů od PAUSED) hard-delete shop dat (s výjimkou `tier_assignments` pro anti-freeride historii). |

## Log a observabilita

- Scheduler píše přes Pino (`logger.info` při každém non-zero tick, `logger.error` při chybě).
- Sentry (pokud `SENTRY_DSN`) zachytí výjimky z tooly i scheduleru.
- Admin UI `/admin/system` ukazuje aktuální health, Redis info, migrace.
