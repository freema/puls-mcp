import type {
  ProductDetailResponse,
  ProductListResponse,
  Shop,
} from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function listProducts(
  shop: Shop,
  db: PulsDb,
  opts?: { limit?: number; page?: number }
): Promise<ProductListResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/products', {
    params: {
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
      ...(opts?.page != null ? { page: opts.page } : {}),
    },
  });

  if (res.status >= 400) {
    throw new Error(`listProducts failed: HTTP ${res.status}`);
  }

  return res.data as ProductListResponse;
}

export async function getProduct(
  shop: Shop,
  db: PulsDb,
  guid: string
): Promise<ProductDetailResponse> {
  if (!guid) throw new Error('getProduct: missing product guid');
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>(
    `/api/products/${encodeURIComponent(guid)}`
  );

  if (res.status >= 400) {
    throw new Error(`getProduct failed: HTTP ${res.status}`);
  }

  return res.data as ProductDetailResponse;
}
