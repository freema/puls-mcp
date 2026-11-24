import { eq } from 'drizzle-orm';
import { Outlet, useLoaderData } from 'react-router';
import type { Route } from './+types/dashboard.$shopId';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { getRedis } from '~/lib/redis';
import { loadDashboardStats } from '~/lib/dashboard-stats.server';
import { getTier } from '~/lib/pricing.server';
import { ClientSidebar } from '~/components/dashboard/client-sidebar';
import { ClientTopBar } from '~/components/dashboard/client-top-bar';
import { TrialBanner } from '~/components/dashboard/trial-banner';

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
  const stats = await loadDashboardStats(redis, shopId, callsPerDay);

  const trialEndsAtMs = shop.trialEndsAt ? shop.trialEndsAt.getTime() : null;
  const now = Date.now();
  const trialActive =
    Boolean(tier?.isTrial) && trialEndsAtMs !== null && trialEndsAtMs > now;
  const trialExpired =
    Boolean(tier?.isTrial) && trialEndsAtMs !== null && trialEndsAtMs <= now;

  return {
    shop: {
      id: shop.id,
      domain: shop.domain,
      name: shop.name,
      status: shop.status,
      tierId: shop.tierId,
      trialEndsAt: shop.trialEndsAt?.toISOString() ?? null,
    },
    tier: tier
      ? {
          id: tier.id,
          name: tier.name,
          isTrial: tier.isTrial,
          callsPerDay: tier.callsPerDay,
        }
      : null,
    trial: { active: trialActive, expired: trialExpired },
    stats,
    email: user.email,
  };
}

export default function DashboardShopLayout() {
  const { shop, stats, tier, trial, email } = useLoaderData<typeof loader>();

  return (
    <>
      <ClientTopBar
        shopName={shop.name ?? shop.domain}
        email={email}
        quotaUsed={stats.callsToday}
        quotaTotal={stats.callsPerDay}
      />
      <div
        className="dashboard-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 240px) minmax(0, 1fr)',
          minHeight: 'calc(100dvh - 64px)',
          alignItems: 'stretch',
        }}
      >
        <ClientSidebar shopId={shop.id} />
        <main
          style={{
            padding: 'clamp(20px, 3vw, 40px)',
            minWidth: 0,
            maxWidth: 1280,
            width: '100%',
          }}
        >
          {trial.expired ? (
            <TrialBanner
              variant="expired"
              tierName={tier?.name ?? shop.tierId}
            />
          ) : trial.active && shop.trialEndsAt ? (
            <TrialBanner
              variant="active"
              tierName={tier?.name ?? shop.tierId}
              endsAt={shop.trialEndsAt}
            />
          ) : null}
          {trial.expired ? null : <Outlet />}
        </main>
      </div>
    </>
  );
}
