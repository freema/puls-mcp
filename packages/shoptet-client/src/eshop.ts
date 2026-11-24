import type { EshopMetaResponse, Shop } from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function getEshopInfo(
  shop: Shop,
  db: PulsDb
): Promise<EshopMetaResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/eshop');

  if (res.status >= 400) {
    throw new Error(`getEshopInfo failed: HTTP ${res.status}`);
  }

  return res.data as EshopMetaResponse;
}
