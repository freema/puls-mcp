import { and, eq, lt, gte, sql } from 'drizzle-orm';
import { healthDaily, healthPings } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getConfig } from '~/lib/config';
import { logger, serializeError } from '~/lib/logger';

/**
 * Status-page health pinger.
 *
 *   probeAndRecord — single tick: probes web / mcp / shoptet_api / upgates_api,
 *       inserts a row into health_pings per component. Status rules:
 *         up        HTTP 2xx, latency < 2000 ms
 *         degraded  HTTP 2xx, latency >= 2000 ms
 *         down      timeout / non-2xx / network error
 *   rollupYesterday — picks the previous UTC day's pings into health_daily,
 *       writes one row per component with uptime_pct + counters.
 *   pruneOldPings — deletes health_pings older than 7 days (rollup retains
 *       the historical truth).
 *
 * The web /healthz check is local (we are the web). MCP and Shoptet are
 * checked over HTTP using the internal/base URLs from config so probes
 * don't depend on external DNS or routing.
 */

type Component = 'web' | 'mcp' | 'shoptet_api' | 'upgates_api';
type Outcome = {
  status: 'up' | 'down' | 'degraded';
  latencyMs: number | null;
  error: string | null;
};

const PROBE_TIMEOUT_MS = 5_000;
const SLOW_THRESHOLD_MS = 2_000;

async function probeWeb(): Promise<Outcome> {
  const t0 = Date.now();
  try {
    // Reuse the same checks /healthz route exposes — db + redis ping.
    const { runHealthChecks } = await import('~/lib/health');
    const r = await runHealthChecks();
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return {
        status: 'down',
        latencyMs,
        error: `db=${r.db} redis=${r.redis}`,
      };
    }
    if (latencyMs >= SLOW_THRESHOLD_MS) {
      return { status: 'degraded', latencyMs, error: 'slow' };
    }
    return { status: 'up', latencyMs, error: null };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : 'web probe failed',
    };
  }
}

async function probeUrl(url: string): Promise<Outcome> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, method: 'GET' });
    const latencyMs = Date.now() - t0;
    if (res.status >= 200 && res.status < 300) {
      if (latencyMs >= SLOW_THRESHOLD_MS) {
        return { status: 'degraded', latencyMs, error: 'slow' };
      }
      return { status: 'up', latencyMs, error: null };
    }
    return { status: 'down', latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : 'probe failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeMcp(): Promise<Outcome> {
  const cfg = getConfig();
  const url = cfg.MCP_INTERNAL_URL.replace(/\/$/, '') + '/health';
  return probeUrl(url);
}

async function probeShoptetApi(): Promise<Outcome> {
  const cfg = getConfig();
  // Mock Shoptet exposes /api/eshop; real Shoptet doesn't have a public
  // healthz, so we probe a known cheap GET. 401/403 still means "API
  // is reachable", but our probe treats anything non-2xx as down because
  // for the *mock* env we expect 200 unauthenticated on /api/eshop is not
  // available. Use the OpenAPI root which Prism always serves.
  // Bez SHOPTET_API_BASE_URL (Shoptet nenakonfigurovaný) pingujeme veřejné API.
  const base = (cfg.SHOPTET_API_BASE_URL ?? 'https://api.myshoptet.com').replace(
    /\/$/,
    ''
  );
  const url = base + '/api/eshop';
  return probeUrl(url);
}

async function probeUpgatesApi(): Promise<Outcome> {
  const cfg = getConfig();
  // Upgates API je per-eshop (vlastní subdoména každého obchodu) → globální
  // health endpoint neexistuje. V dev/E2E pingujeme Prism mock
  // (UPGATES_API_BASE_URL); v produkci pingujeme veřejný Upgates endpoint, na
  // kterém reálně závisíme — veřejný klíč pro ověření podpisu aktivačních
  // callbacků. Reachable → infra Upgatesu nám odpovídá.
  const base = cfg.UPGATES_API_BASE_URL?.replace(/\/$/, '');
  const url = base
    ? `${base}/api/v2/eshop`
    : 'https://files.upgates.com/addons/signature/api.signature.pub.key';
  return probeUrl(url);
}

const PROBES: Record<Component, () => Promise<Outcome>> = {
  web: probeWeb,
  mcp: probeMcp,
  shoptet_api: probeShoptetApi,
  upgates_api: probeUpgatesApi,
};

export async function probeAndRecord(db: DB): Promise<{
  results: Record<Component, Outcome>;
}> {
  const components: Component[] = ['web', 'mcp', 'shoptet_api', 'upgates_api'];
  const entries = await Promise.all(
    components.map(async (c) => [c, await PROBES[c]()] as const)
  );
  const results = Object.fromEntries(entries) as Record<Component, Outcome>;

  // Single batch insert keeps the pinger cheap — 3 rows per minute.
  const rows = entries.map(([component, o]) => ({
    component,
    status: o.status,
    latencyMs: o.latencyMs,
    error: o.error,
  }));
  await db.insert(healthPings).values(rows);

  return { results };
}

/** Returns YYYY-MM-DD for "yesterday in UTC". */
function yesterdayUtcIso(): string {
  const now = new Date();
  const utcDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  );
  return utcDay.toISOString().slice(0, 10);
}

export async function rollupYesterday(db: DB): Promise<{ rolled: number }> {
  const day = yesterdayUtcIso();
  const dayStart = new Date(`${day}T00:00:00Z`);
  const dayEnd = new Date(`${day}T23:59:59.999Z`);

  const rows = await db
    .select({
      component: healthPings.component,
      total: sql<string>`count(*)`,
      down: sql<string>`count(*) filter (where status = 'down')`,
    })
    .from(healthPings)
    .where(
      and(
        gte(healthPings.checkedAt, dayStart),
        lt(healthPings.checkedAt, new Date(dayEnd.getTime() + 1))
      )
    )
    .groupBy(healthPings.component);

  let rolled = 0;
  for (const r of rows) {
    const total = Number(r.total);
    const down = Number(r.down);
    if (total === 0) continue;
    const uptimePct = ((total - down) / total) * 100;
    await db
      .insert(healthDaily)
      .values({
        day,
        component: r.component,
        uptimePct: uptimePct.toFixed(2),
        totalChecks: total,
        downChecks: down,
      })
      .onConflictDoUpdate({
        target: [healthDaily.day, healthDaily.component],
        set: {
          uptimePct: uptimePct.toFixed(2),
          totalChecks: total,
          downChecks: down,
        },
      });
    rolled += 1;
  }
  return { rolled };
}

export async function pruneOldPings(db: DB): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const r = await db
    .delete(healthPings)
    .where(lt(healthPings.checkedAt, cutoff))
    .returning({ id: healthPings.id });
  return { deleted: r.length };
}

/** Idempotent guard for the in-process scheduler. */
let lastRollupDay: string | null = null;

export async function maybeDailyRollup(db: DB): Promise<void> {
  // Run rollup once per UTC day, after 00:05 UTC.
  const now = new Date();
  if (now.getUTCHours() < 1) return;
  const today = now.toISOString().slice(0, 10);
  if (lastRollupDay === today) return;
  try {
    await rollupYesterday(db);
    await pruneOldPings(db);
    lastRollupDay = today;
  } catch (err) {
    logger.error(
      { err: serializeError(err) },
      'health rollup failed (will retry on next tick)'
    );
  }
}

// Avoid unused-import noise when the helper is dead-code eliminated.
void eq;
