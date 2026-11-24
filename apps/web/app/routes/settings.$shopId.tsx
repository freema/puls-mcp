import type { Route } from './+types/settings.$shopId';
import { eq } from 'drizzle-orm';
import { useLoaderData } from 'react-router';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { getRedis } from '~/lib/redis';
import { loadDashboardStats } from '~/lib/dashboard-stats.server';
import { getTier } from '~/lib/pricing.server';
import { getConfig } from '~/lib/config';
import { McpUrlCard } from '~/components/dashboard/mcp-url-card';
import { QuickStatsGrid } from '~/components/dashboard/quick-stats-grid';
import {
  EmbedFooter,
  EmbedHeader,
} from '~/components/dashboard/embed-chrome';

export function headers(): HeadersInit {
  return {
    'X-Frame-Options': '',
    'Content-Security-Policy': "frame-ancestors 'self' https://*.myshoptet.com https://*.admin.upgates.com",
  };
}

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
  const stats = await loadDashboardStats(
    redis,
    shopId,
    tier?.callsPerDay ?? 200
  );
  const cfg = getConfig();
  const origin = cfg.MCP_PUBLIC_ORIGIN.replace(/\/$/, '');
  const mcpUrl = `${origin}/mcp`;

  return {
    shop: {
      id: shop.id,
      domain: shop.domain,
      name: shop.name,
      status: shop.status,
    },
    stats,
    mcpUrl,
  };
}

export default function SettingsEmbed() {
  const { shop, stats, mcpUrl } = useLoaderData<typeof loader>();

  return (
    <div
      data-testid="settings-embed-root"
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        minHeight: '100dvh',
        padding: '20px 24px',
      }}
    >
      <EmbedHeader
        shopId={shop.id}
        shopName={shop.name ?? shop.domain}
        shopStatus={shop.status}
        quotaUsed={stats.mcpCalls}
        quotaTotal={1000}
      />
      <McpUrlCard mcpUrl={mcpUrl} />
      <QuickStatsGrid stats={stats} embed />
      <EmbedFooter />
    </div>
  );
}
