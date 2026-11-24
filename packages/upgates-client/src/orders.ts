import type {
  Shop,
  OrderListResponse,
  OrderDetailResponse,
  OrderChangesResponse,
} from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';
import { paginateAll } from './pagination.js';
import { mapOrder, mapOrderDetail } from './mappers.js';
import type { UpgatesOrderRaw } from './types.js';

const ORDERS_PATH = '/api/v2/orders';

function extractOrders(body: unknown): UpgatesOrderRaw[] {
  const b = body as { orders?: UpgatesOrderRaw[] } | undefined;
  return b?.orders ?? [];
}

export async function listOrders(
  shop: Shop,
  opts?: { status?: string; limit?: number; from?: string }
): Promise<OrderListResponse> {
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesOrderRaw>(
    client,
    ORDERS_PATH,
    {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.from ? { last_update_time_from: opts.from } : {}),
    },
    extractOrders,
    'listOrders',
    opts?.limit
  );
  const limited = opts?.limit != null ? raw.slice(0, opts.limit) : raw;
  return { data: limited.map(mapOrder) };
}

export async function getOrder(
  shop: Shop,
  code: string
): Promise<OrderDetailResponse> {
  if (!code) throw new Error('getOrder: missing order code');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: `${ORDERS_PATH}/${encodeURIComponent(code)}`,
  });
  if (res.status >= 400) {
    throw new Error(`getOrder failed: ${extractUpgatesError(res)}`);
  }
  if (res.data == null || res.data === '') {
    throw new Error(`getOrder: empty response for order ${code}`);
  }
  // Reálné API vrací i pro detail stránkovanou obálku `{orders: [...]}`
  // (GET /orders/{order_number} = filtrovaný list); mock vrací `{order: {...}}`.
  const body = res.data as
    | { order?: UpgatesOrderRaw; orders?: UpgatesOrderRaw[] }
    | undefined;
  const rawOrder =
    body?.order ?? body?.orders?.[0] ?? (res.data as UpgatesOrderRaw);
  return { data: mapOrderDetail(rawOrder) };
}

export async function listOrderChanges(
  shop: Shop,
  opts?: { from?: string; limit?: number }
): Promise<OrderChangesResponse> {
  // Upgates nemá dedikovaný changes endpoint — inkrementální sync je list
  // s `last_update_time_from`. Stáhneme VŠECHNY změněné (žádný early-exit přes
  // limit), seřadíme dle `updated_at` vzestupně a uřízneme na `limit`, ať vybraný
  // podset jsou časově NEJSTARŠÍ změny. `cursor` = max(changedAt) vráceného
  // podsetu, aby `from = cursor` při dalším syncu nepřeskočil zahozené změny.
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesOrderRaw>(
    client,
    ORDERS_PATH,
    { ...(opts?.from ? { last_update_time_from: opts.from } : {}) },
    extractOrders,
    'listOrderChanges'
  );
  // ISO-8601 timestampy se řadí lexikograficky. Reálné API:
  // `last_update_time`; mock/legacy: `updated_at`.
  const changedAt = (o: UpgatesOrderRaw) =>
    o.last_update_time ?? o.updated_at ?? '';
  const sorted = [...raw].sort((a, b) =>
    changedAt(a).localeCompare(changedAt(b))
  );
  const limited = opts?.limit != null ? sorted.slice(0, opts.limit) : sorted;
  const last = limited[limited.length - 1];
  const cursor = last ? changedAt(last) || undefined : undefined;
  return {
    data: {
      cursor,
      changes: limited.map((o) => ({
        code: o.order_number ?? o.code ?? '',
        changeType: 'updated',
        changedAt: changedAt(o),
      })),
    },
  };
}
