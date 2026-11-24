import type { Shop, PulsDb } from '@puls/platform-core';
import { createTokenCache, isAccessTokenFresh } from '@puls/ecommerce-common';
import { fetchApiAccessToken } from './auth.js';

export type { PulsDb };
export { isAccessTokenFresh };

function resolveBaseUrl(shop: Shop): string {
  const fromShop = shop.apiBaseUrl?.trim();
  const fromEnv = process.env.SHOPTET_API_BASE_URL?.trim();
  const base = fromShop || fromEnv;
  if (!base) {
    throw new Error('Missing SHOPTET_API_BASE_URL or shop.apiBaseUrl');
  }
  return base.replace(/\/$/, '');
}

/**
 * Shoptet access token (cache-first). Mechanika (cache lookup, persist, margin)
 * žije v `@puls/ecommerce-common` engine; Shoptet dodá jen *jak* se token získá
 * (`getAccessToken` OAuth endpoint) jako `fetchToken` callback.
 */
export async function getApiAccessToken(shop: Shop, db: PulsDb): Promise<string> {
  const baseUrl = resolveBaseUrl(shop);
  const cache = createTokenCache({
    db,
    fetchToken: async () => {
      const fresh = await fetchApiAccessToken(baseUrl, shop.oauthAccessToken);
      return { accessToken: fresh.access_token, expiresInSec: fresh.expires_in };
    },
  });
  return cache.getAccessToken(shop.id);
}

/** Invaliduje cachovaný token (401 retry path) — deleguje na engine. */
export async function invalidateApiAccessToken(
  shop: Shop,
  db: PulsDb
): Promise<void> {
  const cache = createTokenCache({
    db,
    fetchToken: async () => {
      throw new Error('fetchToken not used on invalidate');
    },
  });
  await cache.invalidate(shop.id);
}
