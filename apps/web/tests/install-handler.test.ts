import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM, shops } from '@puls/db/schema';
import { handleInstall } from '~/lib/shoptet-install';
import { getDb } from '~/lib/db';
import type { Env } from '~/lib/config';

const mocks = vi.hoisted(() => ({
  install: vi.fn(async () => ({
    platform: 'shoptet' as const,
    externalId: '777001',
    domain: '777001.mock-install.example',
    adminEmail: 'mock@example.com',
    name: 'Mock',
    oauthAccessToken: 'oauth-mock-token',
    webhookSignatureKey: 'wh-mock-key',
    apiBaseUrl: 'http://mock-shoptet:4010',
  })),
}));

// handleInstall jde přes connector registry → shoptetConnector.install.
vi.mock('@puls/shoptet-client', () => ({
  shoptetConnector: {
    platform: 'shoptet',
    install: mocks.install,
  },
}));

const TEST_ACCOUNT = '777001';
const shouldRunIntegration = Boolean(process.env.DATABASE_URL?.length);

const whereTestShop = and(
  eq(shops.platform, PLATFORM.SHOPTET),
  eq(shops.platformAccountId, TEST_ACCOUNT)
);

describe.skipIf(!shouldRunIntegration)('handleInstall', () => {
  function envFixture(): Env {
    return {
      DATABASE_URL: process.env.DATABASE_URL!,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://redis:6379',
      PORT: 3000,
      NODE_ENV: 'test',
      SHOPTET_API_BASE_URL: 'http://mock-shoptet:4010',
      SHOPTET_CLIENT_ID: 'mock-client',
      SHOPTET_CLIENT_SECRET: 'mock-secret',
      SHOPTET_REDIRECT_URI: 'http://localhost/oauth/callback',
      UPGATES_SIGNATURE_TOKEN: 'puls-upgates-signature-token',
      ADMIN_EMAIL: 'admin@example.com',
      MCP_INTERNAL_URL: 'http://mcp:3001',
      MCP_PUBLIC_ORIGIN: 'http://localhost:3001',
      SMTP_PORT: 587,
      TRIAL_GRACE_DAYS: 30,
      OTP_GLOBAL_HOURLY_MAX: 50,
    };
  }

  beforeEach(async () => {
    const db = getDb();
    await db.delete(shops).where(whereTestShop);
    mocks.install.mockClear();
  });

  afterEach(async () => {
    const db = getDb();
    await db.delete(shops).where(whereTestShop);
  });

  it('inserts a shop under 500ms', async () => {
    const db = getDb();
    const out = await handleInstall(db, envFixture(), 'mock_code_1');
    expect(out.shopId.length).toBeGreaterThan(5);
    expect(out.durationMs).toBeLessThan(500);
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it('upserts reinstall for the same account', async () => {
    const db = getDb();
    const first = await handleInstall(db, envFixture(), 'code_a');
    const second = await handleInstall(db, envFixture(), 'code_b');
    expect(second.shopId).toBe(first.shopId);

    const rows = await db
      .select({ id: shops.id })
      .from(shops)
      .where(whereTestShop);
    expect(rows).toHaveLength(1);

    expect(mocks.install).toHaveBeenCalledTimes(2);
  });
});
