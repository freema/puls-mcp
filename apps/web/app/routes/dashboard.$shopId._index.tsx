import { eq } from 'drizzle-orm';
import { Link, useLoaderData } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { Route } from './+types/dashboard.$shopId._index';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { getRedis } from '~/lib/redis';
import {
  loadActivityLines,
  loadDashboardStats,
  loadUsageHistory,
} from '~/lib/dashboard-stats.server';
import { getTier } from '~/lib/pricing.server';
import { getConfig } from '~/lib/config';
import { McpUrlCard } from '~/components/dashboard/mcp-url-card';
import { QuickStatsGrid } from '~/components/dashboard/quick-stats-grid';
import { UsageChart } from '~/components/dashboard/usage-chart';
import { ActivityTable } from '~/components/dashboard/activity-table';

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) throw new Response('Not found', { status: 404 });

  if (
    !shop.adminEmail ||
    shop.adminEmail.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new Response('Forbidden', { status: 403 });
  }

  const redis = getRedis();
  const tier = await getTier(db, shop.tierId);
  const callsPerDay = tier?.callsPerDay ?? 200;
  const [stats, recent, usage] = await Promise.all([
    loadDashboardStats(redis, shopId, callsPerDay),
    loadActivityLines(redis, shopId, 5),
    loadUsageHistory(redis, shopId),
  ]);

  const cfg = getConfig();
  const origin = cfg.MCP_PUBLIC_ORIGIN.replace(/\/$/, '');
  const mcpUrl = `${origin}/mcp`;

  return { stats, recent, usage, mcpUrl, shopId };
}

export default function DashboardOverview() {
  const { stats, recent, usage, mcpUrl, shopId } =
    useLoaderData<typeof loader>();

  return (
    <>
      <McpUrlCard mcpUrl={mcpUrl} />
      <UsageChart data={usage} />
      <QuickStatsGrid stats={stats} />

      <section
        className="card"
        style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}
      >
        <div
          className="row between"
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--line)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h3 className="heading-3" style={{ margin: 0, marginBottom: 8 }}>
              Recent activity
            </h3>
            <span
              className="muted"
              style={{ fontSize: 12, lineHeight: 1.4, margin: 0 }}
            >
              Posledních {recent.length} volání
            </span>
          </div>
          <Link
            to={`/dashboard/${shopId}/activity`}
            className="btn btn-ghost btn-sm"
          >
            Zobrazit vše <ArrowRight size={12} />
          </Link>
        </div>
        <ActivityTable rows={recent} compact />
      </section>
    </>
  );
}
