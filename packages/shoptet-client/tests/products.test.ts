import { describe, expect, it, vi } from 'vitest';
import { listProducts, getProduct } from '../src/products.js';
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
      if (url === '/api/products') {
        return {
          status: 200,
          data: {
            data: [
              { guid: 'prod-guid-001', name: 'Mock Product A', price: '199.00' },
            ],
          },
          headers: {},
          config: {},
        };
      }
      if (url.startsWith('/api/products/')) {
        return {
          status: 200,
          data: {
            data: {
              guid: 'prod-guid-001',
              name: 'Mock Product A',
              description: 'd',
              price: '199.00',
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

describe('products client', () => {
  it('listProducts returns parsed array', async () => {
    const res = await listProducts(mockShop, mockDb, { limit: 10 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.guid).toBe('prod-guid-001');
  });

  it('getProduct returns detail with description', async () => {
    const res = await getProduct(mockShop, mockDb, 'prod-guid-001');
    expect(res.data.description).toBe('d');
  });

  it('getProduct rejects empty guid', async () => {
    await expect(getProduct(mockShop, mockDb, '')).rejects.toThrow(
      /missing product guid/
    );
  });
});
