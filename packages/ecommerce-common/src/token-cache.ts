import { eq } from 'drizzle-orm';
import { apiTokenCache } from '@puls/db/schema';
import type { PulsDb } from '@puls/platform-core';

/** Default proaktivní refresh margin: token se obnoví 60s před expirací. */
const DEFAULT_MARGIN_MS = 60_000;

/** Fresh token + jeho životnost (sekundy) — návrat z `fetchToken` callbacku. */
export interface FreshToken {
  accessToken: string;
  expiresInSec: number;
}

/**
 * 60s proaktivní refresh margin vs `expiresAt`. Exportováno kvůli unit testům
 * (Shoptet `token-cache.test.ts` na tom závisí — re-exportujeme přes wrapper).
 */
export function isAccessTokenFresh(
  expiresAt: Date,
  nowMs: number,
  marginMs: number = DEFAULT_MARGIN_MS
): boolean {
  return expiresAt.getTime() > nowMs + marginMs;
}

export interface TokenCacheOptions {
  db: PulsDb;
  /**
   * Jak získat fresh token, když cache miss/expirace. Doménově specifické —
   * Shoptet OAuth `getAccessToken`, jiná platforma cokoliv. Engine sám neví, jak
   * se token získává; jen ho persistuje a invaliduje.
   */
  fetchToken: () => Promise<FreshToken>;
  marginMs?: number;
}

/**
 * Token cache engine nad platform-agnostic tabulkou `api_token_cache`. Vrátí
 * cachovaný token, pokud je čerstvý (mimo margin), jinak `fetchToken` → persist
 * (upsert per `shopId`) → vrátí fresh. Doménově neutrální: *jak* se token získá
 * je výhradně callback `fetchToken`.
 */
export function createTokenCache(opts: TokenCacheOptions) {
  const { db, fetchToken, marginMs = DEFAULT_MARGIN_MS } = opts;

  return {
    /** Vrátí platný access token pro daný shop (cache-first, jinak fetch+persist). */
    async getAccessToken(shopId: string): Promise<string> {
      const now = Date.now();

      const [cached] = await db
        .select()
        .from(apiTokenCache)
        .where(eq(apiTokenCache.shopId, shopId))
        .limit(1);

      if (cached && isAccessTokenFresh(cached.expiresAt, now, marginMs)) {
        return cached.accessToken;
      }

      const fresh = await fetchToken();
      const expiresAt = new Date(now + fresh.expiresInSec * 1000);

      await db
        .insert(apiTokenCache)
        .values({
          shopId,
          accessToken: fresh.accessToken,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: apiTokenCache.shopId,
          set: {
            accessToken: fresh.accessToken,
            expiresAt,
          },
        });

      return fresh.accessToken;
    },

    /** Invaliduje cachovaný token (smaže řádek) — používá 401 retry interceptor. */
    async invalidate(shopId: string): Promise<void> {
      await db.delete(apiTokenCache).where(eq(apiTokenCache.shopId, shopId));
    },
  };
}

export type TokenCache = ReturnType<typeof createTokenCache>;
