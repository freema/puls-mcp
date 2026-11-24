import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shop } from '@puls/platform-core';

/**
 * Regrese z live tester feedbacku (2026-06-09): not-found místo prázdného
 * objektu, syntetický default sklad, voucher note při ignorovaném kódu,
 * parent hint u kategorie, výčet dostupností v chybě. HTTP vrstva je mocknutá
 * (reálné tvary odpovědí okopírované z live API).
 */
vi.mock('../src/http.js', () => ({
  createUpgatesApiClient: vi.fn(() => ({})),
  upgatesRequest: vi.fn(),
}));

import { upgatesRequest } from '../src/http.js';
import { getProduct } from '../src/products.js';
import { listStocks } from '../src/stocks.js';
import { createProduct, createVoucher, updateProduct } from '../src/writes.js';
import { createCategory } from '../src/category-writes.js';

const mockedRequest = vi.mocked(upgatesRequest);
const shop = { id: 'shop-1', apiBaseUrl: 'http://mock' } as unknown as Shop;

function respond(data: unknown, status = 200) {
  return { status, data, headers: {} } as never;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('getProduct — not found', () => {
  it('throws a clear error for 200 + {products: []} (deleted/unknown code)', async () => {
    mockedRequest.mockResolvedValueOnce(respond({ products: [] }));
    await expect(getProduct(shop, 'GONE-1')).rejects.toThrow(
      'product "GONE-1" not found'
    );
  });

  it('maps the product from the real {products: [raw]} envelope', async () => {
    mockedRequest.mockResolvedValueOnce(
      respond({
        products: [{ code: 'P-1', descriptions: [{ language: 'cs', title: 'Tričko' }] }],
      })
    );
    const res = await getProduct(shop, 'P-1');
    expect(res.data.guid).toBe('P-1');
    expect(res.data.name).toBe('Tričko');
  });

  it('still supports the mock {product: raw} envelope', async () => {
    mockedRequest.mockResolvedValueOnce(
      respond({ product: { code: 'P-2', descriptions: [] } })
    );
    const res = await getProduct(shop, 'P-2');
    expect(res.data.guid).toBe('P-2');
  });
});

describe('listStocks — synthetic default stock', () => {
  it('returns the synthetic default location when the platform has no stocks', async () => {
    // Reálné chování: resource vrací prázdno (zásoba žije na produktu).
    mockedRequest.mockResolvedValueOnce(respond({ stocks: [] }));
    const res = await listStocks(shop);
    expect(res.data).toEqual([
      { id: 'default', name: 'Default stock (product-level)', default: true },
    ]);
  });

  it('maps real rows when the platform does return stocks', async () => {
    mockedRequest.mockResolvedValueOnce(
      respond({ stocks: [{ code: 'S1', name: 'Hlavní sklad', default_yn: true }] })
    );
    const res = await listStocks(shop);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('S1');
  });
});

describe('createVoucher — platform-generated code', () => {
  it('flags via note when the platform ignored the requested code', async () => {
    // currency zadaná → přeskočí languages GET, jediný request je POST.
    mockedRequest.mockResolvedValueOnce(respond({ vouchers: ['hy6tcrlndv'] }));
    const res = await createVoucher(shop, {
      code: 'TESTSLEVA10',
      discountType: 'percent',
      discountValue: 10,
      currency: 'CZK',
    });
    expect(res.data.codes).toEqual(['hy6tcrlndv']);
    expect(res.data.code).toBe('hy6tcrlndv');
    expect(res.data.note).toContain('TESTSLEVA10');
    expect(res.data.note).toContain('hy6tcrlndv');
  });

  it('adds no note when the returned code matches the requested one', async () => {
    mockedRequest.mockResolvedValueOnce(respond({ vouchers: ['MOJESLEVA'] }));
    const res = await createVoucher(shop, {
      code: 'MOJESLEVA',
      discountType: 'percent',
      discountValue: 10,
      currency: 'CZK',
    });
    expect(res.data.note).toBeUndefined();
  });
});

describe('createCategory — parent hint', () => {
  it('appends an actionable hint when rejected without a parent', async () => {
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string };
      if (cfg.url === '/api/v2/languages') {
        return respond({
          languages: [{ language_id: 'cs', currency_id: 'CZK', default_yn: true }],
        });
      }
      // Reálná odpověď z live testu: inserted_yn false + parent_id missing.
      return respond({
        categories: [
          {
            code: 'TEST-KAT',
            inserted_yn: false,
            messages: [{ property: 'parent_id', message: 'missing' }],
          },
        ],
      });
    });
    await expect(
      createCategory(shop, { category: { code: 'TEST-KAT', name: 'Test' } })
    ).rejects.toThrow(/requires a parent category.*list_categories/);
  });

  it('keeps the raw error (no hint) when a parent WAS provided', async () => {
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string };
      if (cfg.url === '/api/v2/languages') {
        return respond({
          languages: [{ language_id: 'cs', currency_id: 'CZK', default_yn: true }],
        });
      }
      return respond({
        categories: [
          {
            code: 'TEST-KAT',
            inserted_yn: false,
            messages: [{ property: 'parent_code', message: 'not found' }],
          },
        ],
      });
    });
    await expect(
      createCategory(shop, {
        category: { code: 'TEST-KAT', name: 'Test', parentCode: 'NOPE' },
      })
    ).rejects.toThrow(/^((?!requires a parent).)*$/s);
  });
});

describe('createProduct — category required + read-back rollback', () => {
  it('rejects (no HTTP) when no category is provided', async () => {
    await expect(
      createProduct(shop, { product: { code: 'P-1', name: 'Bez kat.' } })
    ).rejects.toThrow(/at least one category is required/);
    // Guard běží PŘED jakýmkoli requestem — produkt v eshopu nevznikne.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('creates the product when the requested category lands', async () => {
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string; method?: string };
      if (cfg.url === '/api/v2/languages') {
        return respond({
          languages: [{ language_id: 'cs', currency_id: 'CZK', default_yn: true }],
        });
      }
      if (cfg.method === 'POST' && cfg.url === '/api/v2/products') {
        return respond({ products: [{ code: 'P-1', inserted_yn: true }] });
      }
      if (cfg.method === 'GET' && cfg.url === '/api/v2/products/P-1') {
        return respond({
          products: [
            {
              code: 'P-1',
              descriptions: [{ language: 'cs', title: 'Tričko' }],
              categories: [{ category_id: 28, code: 'K00036', name: 'Clothes' }],
            },
          ],
        });
      }
      // parameters subresource (best-effort)
      if (cfg.url === '/api/v2/products/P-1/parameters') {
        return respond({ products: [{ parameters: [] }] });
      }
      throw new Error(`unexpected request ${cfg.method} ${cfg.url}`);
    });

    const res = await createProduct(shop, {
      product: { code: 'P-1', name: 'Tričko', patch: { categories: [{ code: 'K00036', main: true }] } },
    });
    expect(res.data.categories).toEqual(['Clothes']);
  });

  it('rejects AND deletes the orphan when the category is silently dropped', async () => {
    const deleteCalls: unknown[] = [];
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string; method?: string; params?: unknown };
      if (cfg.url === '/api/v2/languages') {
        return respond({
          languages: [{ language_id: 'cs', currency_id: 'CZK', default_yn: true }],
        });
      }
      if (cfg.method === 'POST' && cfg.url === '/api/v2/products') {
        return respond({ products: [{ code: 'P-1', inserted_yn: true }] });
      }
      if (cfg.method === 'GET' && cfg.url === '/api/v2/products/P-1') {
        // Upgates tiše zahodil neznámý kód → produkt vznikl BEZ kategorie.
        return respond({
          products: [{ code: 'P-1', descriptions: [{ language: 'cs', title: 'Tričko' }], categories: [] }],
        });
      }
      if (cfg.url === '/api/v2/products/P-1/parameters') {
        return respond({ products: [{ parameters: [] }] });
      }
      if (cfg.method === 'DELETE' && cfg.url === '/api/v2/products') {
        deleteCalls.push(cfg.params);
        return respond({ products: [{ code: 'P-1', deleted_yn: true }] });
      }
      throw new Error(`unexpected request ${cfg.method} ${cfg.url}`);
    });

    await expect(
      createProduct(shop, {
        product: { code: 'P-1', name: 'Tričko', patch: { categories: [{ code: 'NEEXISTUJE', main: true }] } },
      })
    ).rejects.toThrow(/platform rejected the requested category/);
    // Rollback: osiřelý produkt se smaže (DELETE s codes=P-1).
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatchObject({ codes: 'P-1' });
  });
});

describe('updateProduct — patch.stock & availability error', () => {
  it('sends top-level stock in the PUT body (no silent drop)', async () => {
    const putBodies: unknown[] = [];
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string; method?: string; data?: unknown };
      if (cfg.method === 'GET' && cfg.url?.startsWith('/api/v2/products/')) {
        return respond({
          products: [
            {
              code: 'P-1',
              descriptions: [{ language: 'cs', title: 'Tričko' }],
              prices: [{ currency: 'CZK', language: 'cs' }],
            },
          ],
        });
      }
      if (cfg.method === 'PUT' && cfg.url === '/api/v2/products') {
        putBodies.push(cfg.data);
        return respond({ products: [{ code: 'P-1', updated_yn: true }] });
      }
      throw new Error(`unexpected request ${cfg.method} ${cfg.url}`);
    });

    await updateProduct(shop, { guid: 'P-1', patch: { stock: 3 } });
    expect(putBodies).toHaveLength(1);
    const body = putBodies[0] as { products: Array<Record<string, unknown>> };
    expect(body.products[0].stock).toBe(3);
  });

  it('lists available availability labels in the not-found error', async () => {
    mockedRequest.mockImplementation(async (_c, config) => {
      const cfg = config as { url?: string; method?: string };
      if (cfg.method === 'GET' && cfg.url?.startsWith('/api/v2/products/')) {
        return respond({ products: [{ code: 'P-1', descriptions: [], prices: [] }] });
      }
      if (cfg.url === '/api/v2/availabilities') {
        return respond({
          availabilities: [
            { id: 1, descriptions: [{ language: 'cs', name: 'Skladem' }] },
            { id: 2, descriptions: [{ language: 'cs', name: 'Vyprodáno' }] },
          ],
        });
      }
      throw new Error(`unexpected request ${cfg.method} ${cfg.url}`);
    });

    await expect(
      updateProduct(shop, { guid: 'P-1', patch: { availabilityLabel: 'Neexistuje' } })
    ).rejects.toThrow(/available: Skladem, Vyprodáno/);
  });
});
