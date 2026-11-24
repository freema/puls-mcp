import type {
  Shop,
  CustomerListResponse,
  CustomerDetailResponse,
} from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';
import { paginateAll } from './pagination.js';
import { mapCustomer, mapCustomerDetail } from './mappers.js';
import type { UpgatesCustomerRaw } from './types.js';

const CUSTOMERS_PATH = '/api/v2/customers';

function extractCustomers(body: unknown): UpgatesCustomerRaw[] {
  const b = body as { customers?: UpgatesCustomerRaw[] } | undefined;
  return b?.customers ?? [];
}

export async function listCustomers(
  shop: Shop,
  opts?: { limit?: number }
): Promise<CustomerListResponse> {
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesCustomerRaw>(
    client,
    CUSTOMERS_PATH,
    {},
    extractCustomers,
    'listCustomers',
    opts?.limit
  );
  const limited = opts?.limit != null ? raw.slice(0, opts.limit) : raw;
  return { data: limited.map(mapCustomer) };
}

export async function getCustomer(
  shop: Shop,
  guid: string
): Promise<CustomerDetailResponse> {
  if (!guid) throw new Error('getCustomer: missing customer code');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: `${CUSTOMERS_PATH}/${encodeURIComponent(guid)}`,
  });
  if (res.status >= 400) {
    throw new Error(`getCustomer failed: ${extractUpgatesError(res)}`);
  }
  if (res.data == null || res.data === '') {
    throw new Error(`getCustomer: empty response for customer ${guid}`);
  }
  const body = res.data as { customer?: UpgatesCustomerRaw } | undefined;
  const rawCustomer = body?.customer ?? (res.data as UpgatesCustomerRaw);
  return { data: mapCustomerDetail(rawCustomer) };
}
