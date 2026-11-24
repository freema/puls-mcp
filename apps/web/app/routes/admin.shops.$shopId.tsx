import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { Form, Link, redirect, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.shops.$shopId';
import { shops, webhookNotifications } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import {
  assignTier,
  getAllTiers,
  getTier,
  getTierHistory,
} from '~/lib/pricing.server';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';

function maskSk(val: string | null | undefined) {
  if (!val) return '—';
  if (val.length <= 4) return 'sk_***';
  return `sk_${'*'.repeat(6)}${val.slice(-4)}`;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) throw new Response('Not found', { status: 404 });

  const hooks = await db
    .select()
    .from(webhookNotifications)
    .where(eq(webhookNotifications.shopId, shopId))
    .orderBy(desc(webhookNotifications.createdAt))
    .limit(50);

  const [allTiers, currentTier, tierHistory] = await Promise.all([
    getAllTiers(db),
    getTier(db, shop.tierId),
    getTierHistory(db, { shopId }),
  ]);

  return {
    shop: {
      id: shop.id,
      platform: shop.platform,
      platformAccountId: shop.platformAccountId,
      domain: shop.domain,
      name: shop.name,
      status: shop.status,
      adminEmail: shop.adminEmail,
      installedAt: shop.installedAt.toISOString(),
      oauthMasked: maskSk(shop.oauthAccessToken),
      webhookKeyMasked: maskSk(shop.webhookSignatureKey),
      mcpSecretMasked: maskSk(shop.mcpEndpointSecret),
      apiBaseUrl: shop.apiBaseUrl,
      tierId: shop.tierId,
      trialEndsAt: shop.trialEndsAt?.toISOString() ?? null,
      tierAssignedAt: shop.tierAssignedAt.toISOString(),
    },
    tiers: allTiers,
    currentTier,
    tierHistory: tierHistory.map((h) => ({
      id: h.id,
      tierId: h.tierId,
      reason: h.reason,
      changedBy: h.changedBy,
      createdAt: h.createdAt.toISOString(),
    })),
    hooks: hooks.map((h) => ({
      id: h.id,
      event: h.event,
      eventInstance: h.eventInstance,
      processed: h.processed,
      error: h.error,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireAdmin(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');

  if (intent === 'pause') {
    await db
      .update(shops)
      .set({ status: 'PAUSED', updatedAt: new Date() })
      .where(eq(shops.id, shopId));
  } else if (intent === 'resume') {
    await db
      .update(shops)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(shops.id, shopId));
  } else if (intent === 'regenerate') {
    const next = randomBytes(16).toString('hex');
    await db
      .update(shops)
      .set({ mcpEndpointSecret: next, updatedAt: new Date() })
      .where(eq(shops.id, shopId));
  } else if (intent === 'change-tier') {
    const newTierId = String(formData.get('tierId') ?? '').trim();
    if (newTierId) {
      const [shop] = await db
        .select({
          id: shops.id,
          platform: shops.platform,
          platformAccountId: shops.platformAccountId,
          currentTier: shops.tierId,
        })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1);
      if (shop && shop.currentTier !== newTierId) {
        await assignTier(db, {
          shopId: shop.id,
          platform: shop.platform,
          platformAccountId: shop.platformAccountId,
          tierId: newTierId,
          reason: 'admin_override',
          changedBy: user.email,
        });
      }
    }
  } else if (intent === 'extend-trial') {
    const days = Number(formData.get('days') ?? 7);
    const [shop] = await db
      .select({ trialEndsAt: shops.trialEndsAt })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (shop?.trialEndsAt) {
      const next = new Date(shop.trialEndsAt.getTime() + days * 24 * 60 * 60 * 1000);
      await db
        .update(shops)
        .set({ trialEndsAt: next, updatedAt: new Date() })
        .where(eq(shops.id, shopId));
    }
  }

  throw redirect(`/admin/shops/${shopId}`);
}

export default function AdminShopDetail() {
  const { shop, hooks, tiers, currentTier, tierHistory } =
    useLoaderData<typeof loader>();
  const trialEnds = shop.trialEndsAt ? new Date(shop.trialEndsAt) : null;
  const trialDaysLeft = trialEnds
    ? Math.ceil((trialEnds.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const trialExpired = trialDaysLeft !== null && trialDaysLeft <= 0;

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/admin/shops"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Obchody
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-zinc-50">
            {shop.name ?? shop.domain}
          </h1>
          <p className="text-sm text-zinc-500">{shop.domain}</p>
        </div>
        <Badge>{shop.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Form method="post">
          <input type="hidden" name="intent" value="pause" />
          <Button
            type="submit"
            variant="secondary"
            disabled={shop.status === 'PAUSED'}
          >
            Pozastavit
          </Button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="resume" />
          <Button
            type="submit"
            variant="secondary"
            disabled={shop.status === 'ACTIVE'}
          >
            Obnovit
          </Button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="regenerate" />
          <Button type="submit">Regenerovat MCP secret</Button>
        </Form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 text-sm text-zinc-400">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
          <div>Platforma: {shop.platform}</div>
          <div>Account ID: {shop.platformAccountId}</div>
          <div>Admin e-mail: {shop.adminEmail ?? '—'}</div>
          <div>
            Instalace: {new Date(shop.installedAt).toLocaleString('cs-CZ')}
          </div>
          <div>OAuth token: {shop.oauthMasked}</div>
          <div>Webhook key: {shop.webhookKeyMasked}</div>
          <div>MCP secret: {shop.mcpSecretMasked}</div>
          <div>API base: {shop.apiBaseUrl ?? 'default env'}</div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
        <h2 className="text-sm font-medium text-zinc-400">Tier & Trial</h2>
        <div className="text-sm text-zinc-300 space-y-1">
          <div>
            Aktuální tier: <strong>{currentTier?.name ?? shop.tierId}</strong>{' '}
            <span className="text-zinc-500">({shop.tierId})</span>
          </div>
          {trialEnds && (
            <div>
              Trial vyprší: {trialEnds.toLocaleString('cs-CZ')}{' '}
              {trialExpired ? (
                <span className="text-amber-400">— EXPIROVÁNO</span>
              ) : (
                <span className="text-zinc-500">({trialDaysLeft} dní)</span>
              )}
            </div>
          )}
          <div className="text-xs text-zinc-500">
            Přiřazeno: {new Date(shop.tierAssignedAt).toLocaleString('cs-CZ')}
          </div>
        </div>

        <Form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="change-tier" />
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Změnit tier (admin override)
            <select
              name="tierId"
              defaultValue={shop.tierId}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
            >
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.id})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Přiřadit
          </Button>
        </Form>

        {currentTier?.isTrial && (
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="extend-trial" />
            <input type="hidden" name="days" value="7" />
            <Button type="submit" variant="secondary">
              Prodloužit trial o 7 dní
            </Button>
          </Form>
        )}

        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">
            Historie ({tierHistory.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {tierHistory.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString('cs-CZ')} ·{' '}
                <span className="text-zinc-300">{h.tierId}</span> · {h.reason}
                {h.changedBy ? ` · ${h.changedBy}` : ''}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Webhook události (posledních 50)
        </h2>
        <ul className="space-y-2 text-xs">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-2 text-zinc-400">
              <span className="text-zinc-200">{h.event}</span>
              <span>{h.eventInstance}</span>
              <span>{h.processed ? 'processed' : 'queued'}</span>
              {h.error ? (
                <span className="text-amber-400">{h.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
