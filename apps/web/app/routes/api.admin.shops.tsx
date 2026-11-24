import { desc } from 'drizzle-orm';
import type { Route } from './+types/api.admin.shops';
import { shops } from '@puls/db/schema';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { requireAdminApiKey } from '~/lib/admin-api/keys.server';
import {
  ProvisionError,
  provisionUpgatesShop,
} from '~/lib/admin/provision-shop.server';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdminApiKey(db, request);

  const rows = await db
    .select({
      id: shops.id,
      platform: shops.platform,
      platformAccountId: shops.platformAccountId,
      domain: shops.domain,
      name: shops.name,
      adminEmail: shops.adminEmail,
      status: shops.status,
      installedAt: shops.installedAt,
    })
    .from(shops)
    .orderBy(desc(shops.installedAt));

  return Response.json({
    count: rows.length,
    shops: rows.map((s) => ({
      ...s,
      installedAt: s.installedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/admin/shops — ruční provisioning Upgates eshopu přes admin API
 * (Bearer `pmcp_admin_…`). Stejná logika jako formulář v /admin/shops, jen
 * řízená z terminálu. Body (JSON):
 *   { platform: "upgates", apiUrl, apiUser, apiKey, adminEmail, tierId,
 *     name?, token? }
 */
export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const key = await requireAdminApiKey(db, request);

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const platform = String(body.platform ?? 'upgates');
  if (platform !== 'upgates') {
    return Response.json(
      { error: "only platform 'upgates' is supported via this endpoint" },
      { status: 400 }
    );
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  try {
    const result = await provisionUpgatesShop(
      db,
      getConfig(),
      {
        apiUrl: str(body.apiUrl),
        apiUser: str(body.apiUser),
        apiKey: str(body.apiKey),
        adminEmail: str(body.adminEmail),
        tierId: str(body.tierId) || 'pro',
        token: str(body.token) || null,
        name: str(body.name) || null,
      },
      `admin-api:${key.label}`
    );
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    return Response.json(
      {
        ok: false,
        error: `provisioning failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      },
      { status: 500 }
    );
  }
}
