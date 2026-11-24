import type {
  OrderChangesResponse,
  OrderDetailResponse,
  OrderListResponse,
  Shop,
} from './types.js';
import { createShoptetApiClient } from './api.js';
import type { PulsDb } from './token-cache.js';

export async function listOrders(
  shop: Shop,
  db: PulsDb,
  opts?: { status?: string; limit?: number }
): Promise<OrderListResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/orders', {
    params: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
    },
  });

  if (res.status >= 400) {
    throw new Error(`listOrders failed: HTTP ${res.status}`);
  }

  return res.data as OrderListResponse;
}

export async function getOrder(
  shop: Shop,
  db: PulsDb,
  code: string
): Promise<OrderDetailResponse> {
  if (!code) throw new Error('getOrder: missing order code');
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>(
    `/api/orders/${encodeURIComponent(code)}`
  );

  if (res.status >= 400) {
    throw new Error(`getOrder failed: HTTP ${res.status}`);
  }

  return res.data as OrderDetailResponse;
}

export async function listOrderChanges(
  shop: Shop,
  db: PulsDb,
  opts?: { from?: string; limit?: number }
): Promise<OrderChangesResponse> {
  const client = createShoptetApiClient(shop, db);
  const res = await client.get<unknown>('/api/orders/changes', {
    params: {
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
    },
  });

  if (res.status >= 400) {
    throw new Error(`listOrderChanges failed: HTTP ${res.status}`);
  }

  return res.data as OrderChangesResponse;
}
