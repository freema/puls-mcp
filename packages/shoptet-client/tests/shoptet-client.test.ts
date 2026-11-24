import { describe, expect, it, vi } from 'vitest';
import { listOrders } from '../src/orders.js';
import type { Shop } from '../src/types.js';
import type { PulsDb } from '../src/token-cache.js';
import { PLATFORM } from '@puls/db/schema';

vi.mock('../src/api.js', () => ({
  createShoptetApiClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: [{ code: 'MOCK-ORDER-001', status: 'paid', totalPrice: '10' }],
      },
      headers: { 'x-ratelimit-bucket-filling': '1/10' },
      config: {},
    }),
  })),
}));

describe('listOrders', () => {
  it('parses prism-like JSON payload', async () => {
    const shop = {
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
    } satisfies Shop;

    const db = {} as PulsDb;
    const res = await listOrders(shop, db, {});
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.code).toBe('MOCK-ORDER-001');
  });
});
