import pg from 'pg';

/**
 * POSTs /api/install with a synthetic Shoptet code. The web app exchanges
 * with mock-shoptet (Prism) and persists a shop row whose adminEmail comes
 * from the mocked /eshop response (`owner@example.test`). Optionally
 * overrides adminEmail afterwards so a specific test user owns the shop.
 */
export async function installShopViaApi(args: {
  baseUrl: string;
  databaseUrl: string;
  adminEmail?: string;
}): Promise<{ shopId: string; domain: string }> {
  const code = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(
    `${args.baseUrl.replace(/\/$/, '')}/api/install?code=${encodeURIComponent(code)}`,
    { method: 'POST' }
  );
  if (!res.ok) {
    throw new Error(`install failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { ok: boolean; shopId: string };

  const client = new pg.Client({ connectionString: args.databaseUrl });
  await client.connect();
  try {
    if (args.adminEmail) {
      await client.query(`update shops set admin_email = $1 where id = $2`, [
        args.adminEmail.trim().toLowerCase(),
        body.shopId,
      ]);
    }
    const r = await client.query<{ domain: string }>(
      `select domain from shops where id = $1`,
      [body.shopId]
    );
    return { shopId: body.shopId, domain: r.rows[0]?.domain ?? '' };
  } finally {
    await client.end();
  }
}
