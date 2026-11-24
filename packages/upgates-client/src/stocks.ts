import type { Shop, StockListResponse } from '@puls/platform-core';
import { createUpgatesApiClient } from './http.js';
import { paginateAll } from './pagination.js';
import { mapStock } from './mappers.js';
import type { UpgatesStockRaw } from './types.js';

// Upgates: „stocks" = číselník dostupností/skladů (availabilities). `[O]` ověřit
// přesný resource na demo eshopu.
const STOCKS_PATH = '/api/v2/stocks';

function extractStocks(body: unknown): UpgatesStockRaw[] {
  const b = body as
    | { stocks?: UpgatesStockRaw[]; availabilities?: UpgatesStockRaw[] }
    | undefined;
  return b?.stocks ?? b?.availabilities ?? [];
}

export async function listStocks(shop: Shop): Promise<StockListResponse> {
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesStockRaw>(
    client,
    STOCKS_PATH,
    {},
    extractStocks,
    'listStocks'
  );
  if (raw.length === 0) {
    // LIVE ZJIŠTĚNO (dev eshop 2026-06-09): Upgates API v2 samostatné sklady
    // nevede — resource vrací prázdno, ale zásoba ŽIJE top-level na produktu
    // (`stock`) a updateStock ji zapisuje (stockId ignoruje). Syntetický
    // default sklad drží discovery flow konzistentní:
    // list_stocks → "default" → update_stock stockId:"default" funguje.
    return {
      data: [{ id: 'default', name: 'Default stock (product-level)', default: true }],
    };
  }
  return { data: raw.map(mapStock) };
}
