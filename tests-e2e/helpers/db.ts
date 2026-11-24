import pg from 'pg';

export type ShopRow = {
  id: string;
  webhookSignatureKey: string;
  mcpEndpointSecret: string;
};

export async function getLatestShop(
  connectionString: string,
  platform = 'shoptet'
): Promise<ShopRow | null> {
  // Scoped to a platform: otherwise a newer-installed Upgates shop (seeded by
  // the Upgates specs) would win this query and hand a Shoptet test the wrong
  // webhook key. Both callers (install/webhook specs) are Shoptet.
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<ShopRow>(
    `select id,
            webhook_signature_key as "webhookSignatureKey",
            mcp_endpoint_secret as "mcpEndpointSecret"
       from shops
      where platform = $1
      order by installed_at desc
      limit 1`,
    [platform]
  );
  await client.end();

  return res.rows[0] ?? null;
}

export type ShopByAccount = {
  id: string;
  status: string;
  tierId: string;
  adminEmail: string | null;
  platformApiKey: string | null;
};

/** Počet shopů na dané platformě (pro install/lifecycle asserty). */
export async function countShops(
  connectionString: string,
  platform: string
): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<{ count: string }>(
    `select count(*)::text as count from shops where platform = $1`,
    [platform]
  );
  await client.end();
  return Number(res.rows[0]?.count ?? '0');
}

/** Načte shop podle (platform, platform_account_id) — install/lifecycle asserty. */
export async function getShopByPlatformAccount(
  connectionString: string,
  platform: string,
  platformAccountId: string
): Promise<ShopByAccount | null> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<ShopByAccount>(
    `select id,
            status,
            tier_id as "tierId",
            admin_email as "adminEmail",
            platform_api_key as "platformApiKey"
       from shops
      where platform = $1 and platform_account_id = $2
      limit 1`,
    [platform, platformAccountId]
  );
  await client.end();
  return res.rows[0] ?? null;
}

/**
 * Smaže shop řádek (simulace post-grace cleanup cronu). `tier_assignments`
 * přežívá (shop_id → null), takže anti-freeride pak při čerstvém installu
 * pozná vyčerpaný trial.
 */
export async function deleteShopById(
  connectionString: string,
  shopId: string
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(`delete from shops where id = $1`, [shopId]);
  await client.end();
}

export async function countWebhookRows(
  connectionString: string,
  eventInstance: string
): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<{ count: string }>(
    `select count(*)::text as count from webhook_notifications where event_instance = $1`,
    [eventInstance]
  );
  await client.end();
  return Number(res.rows[0]?.count ?? '0');
}

export async function countWebhookRowsForShop(
  connectionString: string,
  shopId: string
): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<{ count: string }>(
    `select count(*)::text as count from webhook_notifications where shop_id = $1`,
    [shopId]
  );
  await client.end();
  return Number(res.rows[0]?.count ?? '0');
}

export async function getWebhookPayloadByInstance(
  connectionString: string,
  eventInstance: string
): Promise<Record<string, unknown> | null> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const res = await client.query<{ payload: unknown }>(
    `select payload
       from webhook_notifications
      where event_instance = $1
      order by created_at desc
      limit 1`,
    [eventInstance]
  );
  await client.end();
  const pl = res.rows[0]?.payload;
  if (typeof pl !== 'object' || pl === null || Array.isArray(pl)) {
    return null;
  }
  return pl as Record<string, unknown>;
}
