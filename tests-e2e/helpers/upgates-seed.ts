import pg from 'pg';

export type SeededUpgatesShop = {
  shopId: string;
  domain: string;
  platformAccountId: string;
  webhookSecret: string;
};

/**
 * Seeds an Upgates shop directly into the DB. The Upgates activation flow
 * (install/opening/uninstall/versioning + signature_v2) is a separate task
 * (03-upgates-activation.md); until it lands, e2e seeds credentials directly.
 *
 * `api_base_url` points at the Prism `mock-upgates` service so MCP tools resolve
 * against it. Ownership/linkage to the logged-in user is via `admin_email`
 * (see `listShopsForEmail`). Basic-auth credentials are mock values — Prism
 * ignores auth, the connector just needs them present.
 */
export async function seedUpgatesShop(args: {
  databaseUrl: string;
  adminEmail: string;
  apiBaseUrl?: string;
}): Promise<SeededUpgatesShop> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const shopId = `upg_${suffix}`;
  const platformAccountId = `upg-demo-${suffix}`;
  const domain = `demo-${suffix}.upgates.cz`;
  const webhookSecret = `upg-wh-secret-${suffix}`;
  const apiBaseUrl = args.apiBaseUrl ?? 'http://mock-upgates:4011';

  const client = new pg.Client({ connectionString: args.databaseUrl });
  await client.connect();
  try {
    await client.query(
      `insert into shops (
         id, platform, platform_account_id, domain, admin_email,
         status, oauth_access_token, webhook_signature_key, api_base_url,
         platform_api_login, platform_api_key, mcp_endpoint_secret,
         tier_id, trial_ends_at
       ) values (
         $1, 'upgates', $2, $3, $4,
         'ACTIVE', 'upgates-no-oauth', $5, $6,
         'mock-api-user', 'mock-api-key', $7,
         'trial', now() + interval '14 days'
       )`,
      [
        shopId,
        platformAccountId,
        domain,
        args.adminEmail.trim().toLowerCase(),
        webhookSecret,
        apiBaseUrl,
        `mcp-${suffix}`,
      ]
    );
    return { shopId, domain, platformAccountId, webhookSecret };
  } finally {
    await client.end();
  }
}
