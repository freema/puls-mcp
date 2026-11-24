import { lazy, Suspense } from 'react';
import { sql, desc, eq, and, lte, gte, isNotNull } from 'drizzle-orm';
import { feedback, shops, webhookNotifications } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { getRedis } from '~/lib/redis';
import { runHealthChecks } from '~/lib/health';
import { BigStatCard } from '~/components/admin/big-stat-card';
import { HealthStripIndicator } from '~/components/admin/health-strip-indicator';
import { Link, useLoaderData } from 'react-router';
import { ChevronDown, RefreshCw } from 'lucide-react';

const AdminCallsChart = lazy(() =>
  import('~/components/admin/admin-calls-chart.client').then((m) => ({
    default: m.AdminCallsChart,
  }))
);

export async function loader() {
  const db = getDb();
  const redis = getRedis();

  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shops)
    .where(eq(shops.status, 'ACTIVE'));

  const [pausedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shops)
    .where(eq(shops.status, 'PAUSED'));

  const callsGlobal = Number((await redis.get('puls:mcp:calls:global')) ?? 0);

  const [newFeedbackRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(eq(feedback.status, 'new'));

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [trialActiveRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shops)
    .where(and(eq(shops.tierId, 'trial'), gte(shops.trialEndsAt, now)));
  const [trialEndingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shops)
    .where(
      and(
        eq(shops.tierId, 'trial'),
        gte(shops.trialEndsAt, now),
        lte(shops.trialEndsAt, in7days)
      )
    );
  const [trialExpiredRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shops)
    .where(
      and(
        eq(shops.tierId, 'trial'),
        isNotNull(shops.trialEndsAt),
        lte(shops.trialEndsAt, now)
      )
    );

  const recentInstalls = await db
    .select({
      id: shops.id,
      domain: shops.domain,
      installedAt: shops.installedAt,
    })
    .from(shops)
    .orderBy(desc(shops.installedAt))
    .limit(10);

  const recentHooks = await db
    .select({
      id: webhookNotifications.id,
      event: webhookNotifications.event,
      shopId: webhookNotifications.shopId,
      createdAt: webhookNotifications.createdAt,
    })
    .from(webhookNotifications)
    .orderBy(desc(webhookNotifications.createdAt))
    .limit(8);

  let redisOk = false;
  try {
    redisOk = (await redis.ping()) === 'PONG';
  } catch {
    redisOk = false;
  }

  const health = await runHealthChecks();

  const activeCount = activeRow?.count ?? 0;

  return {
    stats: {
      activeShops: activeCount,
      pausedShops: pausedRow?.count ?? 0,
      calls24hProxy: callsGlobal,
      trialActive: trialActiveRow?.count ?? 0,
      trialEndingSoon: trialEndingRow?.count ?? 0,
      trialExpired: trialExpiredRow?.count ?? 0,
      newFeedback: newFeedbackRow?.count ?? 0,
    },
    health: {
      api: health.ok,
      db: health.db === 'up',
      redis: redisOk,
      lastError: health.ok ? null : 'healthcheck',
    },
    recentInstalls,
    recentHooks,
  };
}

export default function AdminOverview() {
  const { stats, health, recentInstalls, recentHooks } =
    useLoaderData<typeof loader>();
  const today = new Date().toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="col gap-16">
      <div
        className="row between"
        style={{
          marginBottom: 6,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div className="col gap-6">
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              letterSpacing: '0.12em',
            }}
          >
            OVERVIEW
          </span>
          <h1 className="heading-2">System health · {today}</h1>
        </div>
        <div className="row gap-8">
          <button type="button" className="btn btn-soft btn-sm">
            Last 24h <ChevronDown size={12} />
          </button>
          <button type="button" className="btn btn-soft btn-sm">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <BigStatCard
          label="Aktivní shopy"
          value={String(stats.activeShops)}
          hint="aktivní instalace"
          trend="up"
        />
        <BigStatCard
          label="MCP volání · cum."
          value={String(stats.calls24hProxy)}
          hint="napříč všemi shopy"
          trend="up"
        />
        <BigStatCard
          label="Pozastavené"
          value={String(stats.pausedShops)}
          hint="paused shops"
          trend="flat"
          ok
        />
        <BigStatCard
          label="Trial — aktivní"
          value={String(stats.trialActive)}
          hint={`${stats.trialEndingSoon} vyprší ≤ 7d · ${stats.trialExpired} vypršelých`}
          trend="flat"
        />
        <Link to="/admin/feedback" style={{ textDecoration: 'none' }}>
          <BigStatCard
            label="Nový feedback"
            value={String(stats.newFeedback)}
            hint="čeká na triage"
            trend={stats.newFeedback > 0 ? 'up' : 'flat'}
          />
        </Link>
      </div>

      <HealthStripIndicator
        items={[
          { label: 'API uptime', ok: health.api, detail: health.api ? '99.98% · 30d' : 'fail' },
          { label: 'DB pool', ok: health.db, detail: health.db ? 'connected' : 'down' },
          { label: 'Redis', ok: health.redis, detail: health.redis ? 'queue 0' : 'down' },
          {
            label: 'Last error',
            ok: !health.lastError,
            detail: health.lastError ?? 'no errors',
          },
        ]}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        <section
          className="card"
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div
            className="row between"
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <h3 className="heading-3">MCP volání (globálně)</h3>
          </div>
          <div style={{ padding: 16 }}>
            <Suspense
              fallback={
                <div
                  style={{
                    height: 224,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                  }}
                />
              }
            >
              <AdminCallsChart value={stats.calls24hProxy} />
            </Suspense>
          </div>
        </section>

        <section
          className="card"
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div
            className="row between"
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <h3 className="heading-3">Poslední instalace</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              {recentInstalls.length}
            </span>
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {recentInstalls.length === 0 ? (
              <li
                style={{
                  padding: '16px 20px',
                  fontSize: 13,
                  color: 'var(--ink-3)',
                }}
              >
                Zatím žádné instalace.
              </li>
            ) : (
              recentInstalls.map((s, i) => (
                <li
                  key={s.id}
                  className="row between"
                  style={{
                    padding: '12px 20px',
                    borderBottom:
                      i < recentInstalls.length - 1
                        ? '1px solid var(--line)'
                        : 'none',
                    gap: 8,
                  }}
                >
                  <Link
                    to={`/admin/shops/${s.id}`}
                    className="mono"
                    style={{
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      fontSize: 12.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {s.domain}
                  </Link>
                  <span
                    className="mono faint"
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {new Date(s.installedAt).toLocaleDateString('cs-CZ')}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section
        className="card"
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <div
          className="row between"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <h3 className="heading-3">Nedávné webhooky</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {recentHooks.length}
          </span>
        </div>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {recentHooks.length === 0 ? (
            <li
              style={{
                padding: '16px 20px',
                fontSize: 13,
                color: 'var(--ink-3)',
              }}
            >
              Žádné webhooky.
            </li>
          ) : (
            recentHooks.map((h, i) => (
              <li
                key={h.id}
                className="row gap-12"
                style={{
                  padding: '12px 20px',
                  borderBottom:
                    i < recentHooks.length - 1
                      ? '1px solid var(--line)'
                      : 'none',
                }}
              >
                <span
                  className="mono"
                  style={{
                    color: 'var(--accent)',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {h.event}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--ink-2)' }}
                >
                  shop {h.shopId ?? '—'}
                </span>
                <span style={{ flex: 1 }} />
                <span
                  className="mono faint"
                  style={{ fontSize: 11 }}
                >
                  {new Date(h.createdAt).toLocaleString('cs-CZ')}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
