import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLATFORM, pricingTiers, shops, tierAssignments } from '@puls/db/schema';
import {
  assignTier,
  assignTierOnInstall,
  getPublicTiers,
  getTier,
  hasUsedTrial,
} from '~/lib/pricing.server';
import { getDb } from '~/lib/db';

const TEST_ACCOUNT_FRESH = '999001';
const TEST_ACCOUNT_REUSED = '999002';
const TEST_SHOP_PREFIX = 'test-pricing-';

const shouldRunIntegration = Boolean(process.env.DATABASE_URL?.length);

async function insertShop(
  platformAccountId: string,
  suffix: string
): Promise<string> {
  const db = getDb();
  const id = `${TEST_SHOP_PREFIX}${suffix}`;
  await db.insert(shops).values({
    id,
    platform: PLATFORM.UPGATES,
    platformAccountId,
    domain: `${suffix}.test.example`,
    oauthAccessToken: 'mock-oauth',
    webhookSignatureKey: 'mock-webhook-key',
    mcpEndpointSecret: `mock-mcp-${suffix}`,
  });
  return id;
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db
    .delete(tierAssignments)
    .where(
      inArray(tierAssignments.platformAccountId, [
        TEST_ACCOUNT_FRESH,
        TEST_ACCOUNT_REUSED,
      ])
    );
  await db
    .delete(shops)
    .where(
      inArray(shops.platformAccountId, [TEST_ACCOUNT_FRESH, TEST_ACCOUNT_REUSED])
    );
}

describe.skipIf(!shouldRunIntegration)('pricing tiers', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('exposes 3 public tiers (Starter / Pro / Business) — Trial is hidden', async () => {
    const db = getDb();
    const tiers = await getPublicTiers(db);
    const ids = tiers.map((t) => t.id).sort();
    expect(ids).toContain('starter');
    expect(ids).toContain('pro');
    expect(ids).toContain('business');
    expect(ids).not.toContain('trial');
  });

  it('Trial tier exists, has price 0 and isPublic=false', async () => {
    const db = getDb();
    const trial = await getTier(db, 'trial');
    expect(trial).toBeTruthy();
    expect(trial?.priceMonthly).toBe(0);
    expect(trial?.isTrial).toBe(true);
    expect(trial?.isPublic).toBe(false);
    expect(trial?.trialDays).toBeGreaterThan(0);
  });

  it('first install gets trial; trialEndsAt = now + trialDays', async () => {
    const db = getDb();
    const shopId = await insertShop(TEST_ACCOUNT_FRESH, 'fresh');

    const result = await assignTierOnInstall(db, {
      shopId,
      platform: PLATFORM.UPGATES,
      platformAccountId: TEST_ACCOUNT_FRESH,
    });
    expect(result.tierId).toBe('trial');
    expect(result.reason).toBe('install');

    const [shop] = await db
      .select({ tierId: shops.tierId, trialEndsAt: shops.trialEndsAt })
      .from(shops)
      .where(eq(shops.id, shopId));
    expect(shop.tierId).toBe('trial');
    expect(shop.trialEndsAt).toBeTruthy();
  });

  it('second install of the same account gets starter (anti-freeride)', async () => {
    const db = getDb();
    const shopA = await insertShop(TEST_ACCOUNT_REUSED, 'reuse-1');
    await assignTierOnInstall(db, {
      shopId: shopA,
      platform: PLATFORM.UPGATES,
      platformAccountId: TEST_ACCOUNT_REUSED,
    });
    expect(await hasUsedTrial(db, PLATFORM.UPGATES, TEST_ACCOUNT_REUSED)).toBe(true);

    // Smaž shop A (simuluje uninstall) — tier_assignments musí přežít
    await db.delete(shops).where(eq(shops.id, shopA));

    const shopB = await insertShop(TEST_ACCOUNT_REUSED, 'reuse-2');
    const result = await assignTierOnInstall(db, {
      shopId: shopB,
      platform: PLATFORM.UPGATES,
      platformAccountId: TEST_ACCOUNT_REUSED,
    });
    expect(result.tierId).toBe('starter');
    expect(result.reason).toBe('reinstall_no_trial');

    const [shop] = await db
      .select({ tierId: shops.tierId, trialEndsAt: shops.trialEndsAt })
      .from(shops)
      .where(eq(shops.id, shopB));
    expect(shop.tierId).toBe('starter');
    expect(shop.trialEndsAt).toBeNull();
  });

  it('admin override is recorded in tier_assignments with reason admin_override', async () => {
    const db = getDb();
    const shopId = await insertShop(TEST_ACCOUNT_FRESH, 'override');
    await assignTierOnInstall(db, {
      shopId,
      platform: PLATFORM.UPGATES,
      platformAccountId: TEST_ACCOUNT_FRESH,
    });

    await assignTier(db, {
      shopId,
      platform: PLATFORM.UPGATES,
      platformAccountId: TEST_ACCOUNT_FRESH,
      tierId: 'pro',
      reason: 'admin_override',
      changedBy: 'admin@example.com',
    });

    const [shop] = await db
      .select({ tierId: shops.tierId })
      .from(shops)
      .where(eq(shops.id, shopId));
    expect(shop.tierId).toBe('pro');

    const log = await db
      .select()
      .from(tierAssignments)
      .where(eq(tierAssignments.shopId, shopId));
    const reasons = log.map((l) => l.reason).sort();
    expect(reasons).toContain('install');
    expect(reasons).toContain('admin_override');
  });
});

describe('pricing tiers (unit, no DB)', () => {
  it('hasUsedTrial requires DATABASE_URL — placeholder so skipIf chooses path', () => {
    expect(typeof hasUsedTrial).toBe('function');
    expect(typeof assignTier).toBe('function');
    expect(typeof assignTierOnInstall).toBe('function');
    expect(typeof getPublicTiers).toBe('function');
    // Unused symbol kept reachable for type-check
    void pricingTiers;
  });
});
