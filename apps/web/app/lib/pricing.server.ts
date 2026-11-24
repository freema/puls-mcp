import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { pricingTiers, shops, tierAssignments, type PlatformId } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getRedis } from '~/lib/redis';
import type { PricingTier } from '~/lib/pricing';

export type { PricingTier } from '~/lib/pricing';

/** Platform discriminator — re-alias na centrální `PlatformId` z `@puls/db`. */
export type Platform = PlatformId;

type DbTier = typeof pricingTiers.$inferSelect;

function toPricingTier(row: DbTier): PricingTier {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    priceMonthly: row.priceMonthly,
    priceYearly: row.priceYearly,
    yearlyDiscountPct: row.yearlyDiscountPct,
    currency: row.currency,
    callsPerDay: row.callsPerDay,
    maxMemoryItems: row.maxMemoryItems,
    activityRetentionDays: row.activityRetentionDays,
    maxShopsPerAccount: row.maxShopsPerAccount,
    maxConcurrentSessions: row.maxConcurrentSessions,
    supportSla: row.supportSla,
    unlocksTools: (row.unlocksTools as unknown as string[]) ?? [],
    isTrial: row.isTrial,
    trialDays: row.trialDays,
    isAssignableOnInstall: row.isAssignableOnInstall,
    features: (row.features as unknown as string[]) ?? [],
    isPublic: row.isPublic,
    isHighlighted: row.isHighlighted,
    badge: row.badge,
    sortOrder: row.sortOrder,
  };
}

export type TierAssignmentReason =
  | 'install'
  | 'reinstall_no_trial'
  | 'upgrade'
  | 'downgrade'
  | 'admin_override'
  | 'trial_expired'
  | 'trial_extended';

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_ALL = 'puls:pricing:tiers:public';
const CACHE_KEY_TIER = (id: string) => `puls:pricing:tier:${id}`;

/** Veřejné tiery (pro marketing /pricing). Trial je vyloučen — má isPublic=false. */
export async function getPublicTiers(db: DB): Promise<PricingTier[]> {
  const redis = getRedis();
  try {
    const cached = await redis.get(CACHE_KEY_ALL);
    if (cached) return JSON.parse(cached) as PricingTier[];
  } catch {
    // ignore cache failure
  }
  const rows = await db
    .select()
    .from(pricingTiers)
    .where(and(eq(pricingTiers.isPublic, true), isNull(pricingTiers.archivedAt)))
    .orderBy(pricingTiers.sortOrder);
  const mapped = rows.map(toPricingTier);
  try {
    await redis.set(CACHE_KEY_ALL, JSON.stringify(mapped), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // ignore cache failure
  }
  return mapped;
}

/** Všechny tiery včetně skrytých — pro admin. */
export async function getAllTiers(db: DB): Promise<PricingTier[]> {
  const rows = await db
    .select()
    .from(pricingTiers)
    .where(isNull(pricingTiers.archivedAt))
    .orderBy(pricingTiers.sortOrder);
  return rows.map(toPricingTier);
}

export async function getTier(db: DB, id: string): Promise<PricingTier | null> {
  const redis = getRedis();
  try {
    const cached = await redis.get(CACHE_KEY_TIER(id));
    if (cached) return JSON.parse(cached) as PricingTier;
  } catch {
    // ignore
  }
  const [row] = await db
    .select()
    .from(pricingTiers)
    .where(eq(pricingTiers.id, id))
    .limit(1);
  if (!row) return null;
  const mapped = toPricingTier(row);
  try {
    await redis.set(CACHE_KEY_TIER(id), JSON.stringify(mapped), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // ignore
  }
  return mapped;
}

export async function invalidateTierCache(id?: string): Promise<void> {
  const redis = getRedis();
  try {
    if (id) await redis.del(CACHE_KEY_TIER(id));
    await redis.del(CACHE_KEY_ALL);
  } catch {
    // ignore
  }
}

/**
 * Anti-freeride: vrátí true, pokud daný účet (platform, platformAccountId)
 * už někdy v historii měl trial tier přiřazen (i když je shop dnes uninstalled).
 */
export async function hasUsedTrial(
  db: DB,
  platform: Platform,
  platformAccountId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: tierAssignments.id })
    .from(tierAssignments)
    .where(
      and(
        eq(tierAssignments.platform, platform),
        eq(tierAssignments.platformAccountId, platformAccountId),
        eq(tierAssignments.tierId, 'trial')
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Přiřadí tier shopu, zaloguje do tier_assignments.
 * Pro trial tier nastaví trialEndsAt = now + tier.trialDays.
 */
export async function assignTier(
  db: DB,
  args: {
    shopId: string;
    platform: Platform;
    platformAccountId: string;
    tierId: string;
    reason: TierAssignmentReason;
    changedBy?: string | null;
  }
): Promise<void> {
  const tier = await getTier(db, args.tierId);
  if (!tier) throw new Error(`Tier '${args.tierId}' neexistuje`);

  const now = new Date();
  const trialEndsAt =
    tier.isTrial && tier.trialDays
      ? new Date(now.getTime() + tier.trialDays * 24 * 60 * 60 * 1000)
      : null;

  await db.transaction(async (tx) => {
    await tx
      .update(shops)
      .set({
        tierId: args.tierId,
        trialEndsAt,
        tierAssignedAt: now,
        updatedAt: now,
      })
      .where(eq(shops.id, args.shopId));

    await tx.insert(tierAssignments).values({
      shopId: args.shopId,
      platform: args.platform,
      platformAccountId: args.platformAccountId,
      tierId: args.tierId,
      reason: args.reason,
      changedBy: args.changedBy ?? 'system',
    });
  });
}

/**
 * Tier assignment pro nově instalovaný shop. Když účet už trial
 * vyčerpal, automaticky přiřadí starter (důvod: reinstall_no_trial).
 */
export async function assignTierOnInstall(
  db: DB,
  args: { shopId: string; platform: Platform; platformAccountId: string }
): Promise<{ tierId: string; reason: TierAssignmentReason }> {
  const usedTrial = await hasUsedTrial(db, args.platform, args.platformAccountId);
  const reason: TierAssignmentReason = usedTrial ? 'reinstall_no_trial' : 'install';
  const tierId = usedTrial ? 'starter' : 'trial';
  await assignTier(db, { ...args, tierId, reason });
  return { tierId, reason };
}

/** Audit log historie tieru pro shop / účet platformy. */
export async function getTierHistory(
  db: DB,
  args: { shopId?: string; platform?: Platform; platformAccountId?: string }
): Promise<(typeof tierAssignments.$inferSelect)[]> {
  if (args.shopId) {
    return db
      .select()
      .from(tierAssignments)
      .where(eq(tierAssignments.shopId, args.shopId))
      .orderBy(desc(tierAssignments.createdAt));
  }
  if (args.platform !== undefined && args.platformAccountId !== undefined) {
    return db
      .select()
      .from(tierAssignments)
      .where(
        and(
          eq(tierAssignments.platform, args.platform),
          eq(tierAssignments.platformAccountId, args.platformAccountId)
        )
      )
      .orderBy(desc(tierAssignments.createdAt));
  }
  return [];
}

/** Počet shopů na konkrétní tier. Pro admin overview. */
export async function getTierShopCounts(
  db: DB
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      tierId: shops.tierId,
      count: sql<number>`count(*)::int`,
    })
    .from(shops)
    .groupBy(shops.tierId);
  return Object.fromEntries(rows.map((r) => [r.tierId, r.count]));
}
