import { randomBytes } from 'node:crypto';
import { PLATFORM, shops } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import type { Env } from '~/lib/config';

export type DemoShopResult = { shopId: string; domain: string };

/**
 * Dev-only: vytvoří fiktivní Upgates obchod přiřazený k danému e-mailu.
 * Endpoint je platný proti mock-upgates (Prism) — MCP volání vrátí mock data.
 */
export async function createDemoShopForEmail(
  db: DB,
  env: Env,
  email: string
): Promise<DemoShopResult> {
  const seed = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  const domain = `demo-${seed}.upgates.test`;
  const username = email.split('@')[0] ?? 'demo';

  const [created] = await db
    .insert(shops)
    .values({
      platform: PLATFORM.UPGATES,
      platformAccountId: String(seed),
      domain,
      name: `Demo · ${username}`,
      adminEmail: email.trim().toLowerCase(),
      status: 'ACTIVE',
      oauthAccessToken: 'demo-token',
      webhookSignatureKey: randomBytes(32).toString('hex'),
      apiBaseUrl: env.UPGATES_API_BASE_URL ?? `https://${domain}/api/v2`,
      mcpEndpointSecret: randomBytes(16).toString('hex'),
    })
    .returning({ id: shops.id });

  if (!created?.id) throw new Error('Failed to create demo shop');
  return { shopId: created.id, domain };
}
