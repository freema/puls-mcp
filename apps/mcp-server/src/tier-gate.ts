import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PulsDb, Shop } from '@puls/platform-core';
import { pricingTiers } from '@puls/db/schema';

export type TierInfo = typeof pricingTiers.$inferSelect;

export type GateOutcome =
  | { ok: true }
  | { ok: false; reason: 'trial_expired' | 'rate_limited' | 'tool_locked'; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (redisClient === undefined) {
    try {
      redisClient = new Redis(url, { maxRetriesPerRequest: 2 });
    } catch {
      redisClient = null;
    }
  }
  return redisClient;
}

/** Načte tier shopu. 60s in-memory cache. */
const tierCache = new Map<string, { value: TierInfo; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function loadTierForShop(
  db: PulsDb,
  shop: Shop
): Promise<TierInfo | null> {
  const tierId = (shop as unknown as { tierId?: string }).tierId ?? 'trial';
  const cached = tierCache.get(tierId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [row] = await db
    .select()
    .from(pricingTiers)
    .where(eq(pricingTiers.id, tierId))
    .limit(1);
  if (!row) return null;
  tierCache.set(tierId, { value: row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}

/** Trial expirace: pokud `now > trialEndsAt`, shop = PAUSED. */
export function isTrialExpired(shop: Shop, tier: TierInfo): boolean {
  if (!tier.isTrial) return false;
  const ends = (shop as unknown as { trialEndsAt?: Date | null }).trialEndsAt;
  if (!ends) return false;
  return new Date(ends).getTime() <= Date.now();
}

/**
 * Denní rate-limit přes Redis. Klíč expiruje na konci UTC dne.
 * Pokud Redis není dostupný, **fail-open** (puls neblokujeme za výpadek
 * infra), ale zalogujeme.
 */
export async function checkDailyRateLimit(
  shopId: string,
  callsPerDay: number
): Promise<{ ok: boolean; used: number; limit: number }> {
  const r = getRedis();
  if (!r) return { ok: true, used: 0, limit: callsPerDay };
  const day = new Date().toISOString().slice(0, 10);
  const key = `puls:rl:mcp-shop:${shopId}:${day}`;
  try {
    const n = await r.incr(key);
    if (n === 1) await r.pexpire(key, DAY_MS);
    return { ok: n <= callsPerDay, used: n, limit: callsPerDay };
  } catch {
    return { ok: true, used: 0, limit: callsPerDay };
  }
}

/** Side-effect free check (pro UI) — vrátí dnešní stav bez incrementu. */
export async function getDailyUsage(shopId: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const key = `puls:rl:mcp-shop:${shopId}:${day}`;
  try {
    const v = await r.get(key);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

/**
 * Wrapne `server.tool` tak, aby každý handler před spuštěním:
 *   1) ověřil, že tier není expirovaný trial,
 *   2) checkl denní limit přes Redis,
 *   3) ověřil, že tool není v premium listě tieru, který shop nemá.
 *
 * Při porušení vrátí MCP textový error response místo skutečného volání.
 */
export function withTierGate(
  server: McpServer,
  shop: Shop,
  tier: TierInfo
): McpServer {
  const original = server.tool.bind(server) as (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: unknown, extra: unknown) => unknown
  ) => unknown;

  const PREMIUM_TOOLS = new Set<string>(); // dnes prázdné, future-proof

  (server as unknown as { tool: typeof original }).tool = (
    name,
    description,
    schema,
    handler
  ) => {
    const wrapped = async (args: unknown, extra: unknown) => {
      const gate = await runGate(shop, tier, name, PREMIUM_TOOLS);
      if (!gate.ok) {
        return {
          content: [{ type: 'text' as const, text: gate.message }],
          isError: true,
        };
      }
      return handler(args, extra);
    };
    return original(name, description, schema, wrapped as never);
  };
  return server;
}

async function runGate(
  shop: Shop,
  tier: TierInfo,
  toolName: string,
  premiumTools: Set<string>
): Promise<GateOutcome> {
  if (isTrialExpired(shop, tier)) {
    return {
      ok: false,
      reason: 'trial_expired',
      message:
        'Zkušební období Puls vypršelo. Aktivujte placený tarif na pulsmcp.com.',
    };
  }

  if (premiumTools.has(toolName)) {
    const unlocks = (tier.unlocksTools as unknown as string[]) ?? [];
    if (!unlocks.includes(toolName)) {
      return {
        ok: false,
        reason: 'tool_locked',
        message: `Nástroj „${toolName}" je dostupný pouze ve vyšším tarifu.`,
      };
    }
  }

  const rl = await checkDailyRateLimit(shop.id, tier.callsPerDay);
  if (!rl.ok) {
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Denní limit ${rl.limit} volání pro tarif „${tier.name}" je vyčerpán. Zkuste to zítra nebo přejděte na vyšší plán.`,
    };
  }

  return { ok: true };
}
