import type {
  CustomerDetailResponse,
  CustomerListResponse,
  Shop,
} from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function listCustomers(
  shop: Shop,
  db: PulsDb,
  opts?: { limit?: number }
): Promise<CustomerListResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/customers', {
    params: {
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
    },
  });

  if (res.status >= 400) {
    throw new Error(`listCustomers failed: HTTP ${res.status}`);
  }

  return res.data as CustomerListResponse;
}

export async function getCustomer(
  shop: Shop,
  db: PulsDb,
  guid: string
): Promise<CustomerDetailResponse> {
  if (!guid) throw new Error('getCustomer: missing customer guid');
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>(
    `/api/customers/${encodeURIComponent(guid)}`
  );

  if (res.status >= 400) {
    throw new Error(`getCustomer failed: HTTP ${res.status}`);
  }

  return res.data as CustomerDetailResponse;
}
