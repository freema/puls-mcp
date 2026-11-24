/* eslint-disable no-console */
/**
 * Dev fixtures. Idempotent: re-running upserts the same rows.
 *
 * Usage:
 *   pnpm --filter web db:seed
 *   # or inside compose: docker compose exec app pnpm db:seed
 */
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  oauthClients,
  PLATFORM,
  shops,
  users,
} from '@puls/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAIL ?? 'admin@example.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const PRIMARY_ADMIN = ADMIN_EMAILS[0]!;

async function main() {
  const pg = postgres(DATABASE_URL!, { max: 1 });
  const db = drizzle(pg);

  for (const email of ADMIN_EMAILS) {
    console.log(`→ seeding admin user ${email}`);
    const [user] = await db
      .insert(users)
      .values({ email })
      .onConflictDoUpdate({
        target: users.email,
        set: { email },
      })
      .returning({ id: users.id, email: users.email });
    console.log(`  user.id = ${user!.id}`);
  }

  const fixtures = [
    { platformAccountId: '1000001', domain: 'demo-acme.example.com', name: 'Demo · Acme s.r.o.' },
    { platformAccountId: '1000002', domain: 'demo-bistro.example.com', name: 'Demo · Bistro Praha' },
    { platformAccountId: '1000003', domain: 'demo-kavarna.example.com', name: 'Demo · Kavárna U Tří lip' },
  ] as const;

  for (const f of fixtures) {
    console.log(`→ seeding shop ${f.domain}`);
    await db
      .insert(shops)
      .values({
        platform: PLATFORM.UPGATES,
        platformAccountId: f.platformAccountId,
        domain: f.domain,
        name: f.name,
        adminEmail: PRIMARY_ADMIN,
        status: 'ACTIVE',
        oauthAccessToken: `demo-token-${f.platformAccountId}`,
        webhookSignatureKey: randomBytes(32).toString('hex'),
        apiBaseUrl:
          process.env.UPGATES_API_BASE_URL ?? 'http://mock-upgates:4011',
        mcpEndpointSecret: `demo-mcp-secret-${f.platformAccountId}`,
      })
      .onConflictDoUpdate({
        target: [shops.platform, shops.platformAccountId],
        set: { name: f.name, adminEmail: PRIMARY_ADMIN, status: 'ACTIVE' },
      });
  }

  console.log('→ seeding OAuth client (Claude / Cursor / Inspector)');
  await db
    .insert(oauthClients)
    .values({
      clientId: 'dev-mcp-inspector',
      clientSecret: null,
      clientName: 'MCP Inspector (dev)',
      redirectUris: JSON.stringify([
        'http://localhost:6274/oauth/callback',
        'http://127.0.0.1:6274/oauth/callback',
      ]),
      scope: 'mcp',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: oauthClients.clientId,
      set: { clientName: 'MCP Inspector (dev)', isActive: true },
    });

  console.log('✓ seed complete');
  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
