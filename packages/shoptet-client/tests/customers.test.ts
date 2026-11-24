import { describe, expect, it, vi } from 'vitest';
import { getCustomer, listCustomers } from '../src/customers.js';
import type { Shop } from '../src/types.js';
import type { PulsDb } from '../src/token-cache.js';
import { PLATFORM } from '@puls/db/schema';

const mockShop: Shop = {
  id: 'shop1',
  platform: PLATFORM.SHOPTET,
  platformAccountId: '1',
  domain: 'x.test',
  name: null,
  status: 'ACTIVE',
  oauthAccessToken: 'oauth',
  webhookSignatureKey: 'wh',
  apiBaseUrl: 'http://mock',
  mcpEndpointSecret: 'mcp',
  installedAt: new Date(),
  uninstalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const mockDb = {} as PulsDb;

vi.mock('../src/api.js', () => ({
  createShoptetApiClient: vi.fn(() => ({
    get: vi.fn(async (url: string) => {
      if (url === '/api/customers') {
        return {
          status: 200,
          data: {
            data: [
              { guid: 'cust-guid-001', email: 'alice@example.test', name: 'Alice' },
            ],
          },
          headers: {},
          config: {},
        };
      }
      if (url.startsWith('/api/customers/')) {
        return {
          status: 200,
          data: {
            data: {
              guid: 'cust-guid-001',
              email: 'alice@example.test',
              name: 'Alice',
              ordersCount: 3,
            },
          },
          headers: {},
          config: {},
        };
      }
      throw new Error(`unexpected url ${url}`);
    }),
  })),
}));

describe('customers client', () => {
  it('listCustomers returns parsed array', async () => {
    const res = await listCustomers(mockShop, mockDb);
    expect(res.data[0]?.email).toBe('alice@example.test');
  });

  it('getCustomer returns detail with ordersCount', async () => {
    const res = await getCustomer(mockShop, mockDb, 'cust-guid-001');
    expect(res.data.ordersCount).toBe(3);
  });
});
