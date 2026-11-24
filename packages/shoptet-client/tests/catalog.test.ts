import { describe, expect, it, vi } from 'vitest';
import { listStocks } from '../src/stocks.js';
import { listCategories } from '../src/categories.js';
import { getEshopInfo } from '../src/eshop.js';
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
      if (url === '/api/stocks') {
        return {
          status: 200,
          data: { data: [{ id: 'stock-main', name: 'Hlavní', default: true }] },
          headers: {},
          config: {},
        };
      }
      if (url === '/api/categories') {
        return {
          status: 200,
          data: {
            data: [{ guid: 'cat-1', name: 'Elektronika', parentGuid: null }],
          },
          headers: {},
          config: {},
        };
      }
      if (url === '/api/eshop') {
        return {
          status: 200,
          data: {
            data: {
              id: 123,
              name: 'Mock e-shop',
              url: 'https://example.test',
              currency: 'CZK',
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

describe('catalog client', () => {
  it('listStocks works', async () => {
    const res = await listStocks(mockShop, mockDb);
    expect(res.data[0]?.id).toBe('stock-main');
  });

  it('listCategories works', async () => {
    const res = await listCategories(mockShop, mockDb);
    expect(res.data[0]?.name).toBe('Elektronika');
  });

  it('getEshopInfo works', async () => {
    const res = await getEshopInfo(mockShop, mockDb);
    expect(res.data.currency).toBe('CZK');
  });
});
