import pg from 'pg';

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for Playwright global setup');
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  await client.query(`
    TRUNCATE TABLE
      mcp_tool_calls,
      shop_memory_items,
      shop_memory,
      oauth_access_tokens,
      oauth_authorization_codes,
      oauth_pending_sessions,
      oauth_clients,
      webhook_notifications,
      tier_assignments,
      api_token_cache,
      sessions,
      shops,
      users
    RESTART IDENTITY CASCADE;
  `);

  await client.end();
}
