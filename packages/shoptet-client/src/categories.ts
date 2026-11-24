import type { CategoryListResponse, Shop } from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function listCategories(
  shop: Shop,
  db: PulsDb
): Promise<CategoryListResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/categories');

  if (res.status >= 400) {
    throw new Error(`listCategories failed: HTTP ${res.status}`);
  }

  return res.data as CategoryListResponse;
}
