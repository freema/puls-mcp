import type { Shop, StockListResponse } from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function listStocks(
  shop: Shop,
  db: PulsDb
): Promise<StockListResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/stocks');

  if (res.status >= 400) {
    throw new Error(`listStocks failed: HTTP ${res.status}`);
  }

  return res.data as StockListResponse;
}
