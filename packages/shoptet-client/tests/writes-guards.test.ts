import { describe, expect, it } from 'vitest';
import { updateProduct, updateStock, createVoucher } from '../src/writes.js';
import type { Shop } from '../src/types.js';
import type { PulsDb } from '../src/token-cache.js';

/**
 * Guardy běží PŘED vytvořením HTTP klienta → testy bez mocků. Kontrakt po
 * tester feedbacku: žádný silent no-op — nepodporované pole = srozumitelná
 * chyba s nasměrováním.
 */
const shop = { id: 'shop-1' } as unknown as Shop;
const db = {} as unknown as PulsDb;

describe('Shoptet updateProduct guards', () => {
  it('rejects patch.stock with a pointer to update_stock', async () => {
    await expect(
      updateProduct(shop, db, { guid: 'p1', patch: { stock: 3 } })
    ).rejects.toThrow(/stock.*not supported on Shoptet.*update_stock/s);
  });

  it('rejects other unsupported fields by name', async () => {
    await expect(
      updateProduct(shop, db, { guid: 'p1', patch: { manufacturer: 'Sony' } })
    ).rejects.toThrow(/manufacturer.*not supported on Shoptet/);
  });
});

describe('Shoptet updateStock guards', () => {
  it('rejects the "default" stockId with a pointer to list_stocks', async () => {
    await expect(
      updateStock(shop, db, { guid: 'p1', stockId: 'default', quantity: 5 })
    ).rejects.toThrow(/specific stockId.*list_stocks/);
  });
});

describe('Shoptet createVoucher guards', () => {
  it('requires an explicit voucher code (English message)', async () => {
    await expect(
      createVoucher(shop, db, { discountType: 'percent', discountValue: 10 })
    ).rejects.toThrow('Shoptet requires an explicit voucher code');
  });
});
