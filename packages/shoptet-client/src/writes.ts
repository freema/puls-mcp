import { createShoptetApiClient } from './api.js';
// Kanonické typy jsou jediný zdroj pravdy (shoptet i upgates importují odsud).
import type {
  ProductPatch,
  VoucherCreateInput,
  VoucherResponse,
  VoucherDiscountType,
} from '@puls/platform-core';
import type { PulsDb } from './token-cache.js';
import type { OrderDetailResponse, ProductDetailResponse, Shop } from './types.js';

// Re-export, aby src/index.ts dál vystavoval typy z `./writes.js` beze změny
// veřejného rozhraní balíčku — typy jsou ale kanonické z @puls/platform-core.
export type { ProductPatch, VoucherCreateInput, VoucherResponse, VoucherDiscountType };

/**
 * Mutating helpers for the Shoptet API. Kept in their own module so that the
 * tool layer can gate them behind a separate consent category ("write").
 */

export type CustomerNoteResponse = {
  data: {
    guid: string;
    note: string;
    createdAt?: string;
  };
};

export type ActionPriceResponse = {
  data: {
    guid: string;
    price: number;
    validFrom?: string;
    validTo?: string;
  };
};

export type StockUpdateResponse = {
  data: {
    guid: string;
    stockId: string;
    quantity: number;
  };
};

export type BulkProductItem = { guid: string; patch: ProductPatch };

export type BulkProductResult =
  | { guid: string; status: 'ok'; data: ProductDetailResponse['data'] }
  | { guid: string; status: 'error'; error: string };

async function callWithRetry<T>(
  fn: () => Promise<{ status: number; data: unknown }>,
  label: string,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  // 4xx neretryujeme, 5xx + síťové chyby ano (max `maxRetries` pokusů).
  // Backoff je lineární — Shoptet `Retry-After` honoruje až axios interceptor.
  while (true) {
    let res: { status: number; data: unknown };
    try {
      res = await fn();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw new Error(
          `${label} failed: network error — ${err instanceof Error ? err.message : 'unknown'}`
        );
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }
    if (res.status < 400) return res.data as T;
    if (res.status >= 500 && attempt < maxRetries) {
      attempt += 1;
      await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }
    const detail =
      typeof res.data === 'string'
        ? ` — ${res.data}`
        : res.data && typeof res.data === 'object'
          ? ` — ${JSON.stringify(res.data).slice(0, 300)}`
          : '';
    throw new Error(`${label} failed: HTTP ${res.status}${detail}`);
  }
}

export async function updateOrderStatus(
  shop: Shop,
  db: PulsDb,
  args: { code: string; status: string; comment?: string }
): Promise<OrderDetailResponse> {
  if (!args.code) throw new Error('updateOrderStatus: missing order code');
  if (!args.status) throw new Error('updateOrderStatus: missing status');

  const client = createShoptetApiClient(shop, db);
  return callWithRetry<OrderDetailResponse>(
    () =>
      client.patch<unknown>(
        `/api/orders/${encodeURIComponent(args.code)}`,
        {
          data: {
            status: args.status,
            ...(args.comment ? { comment: args.comment } : {}),
          },
        }
      ),
    'updateOrderStatus'
  );
}

export async function createCustomerNote(
  shop: Shop,
  db: PulsDb,
  args: { guid: string; note: string }
): Promise<CustomerNoteResponse> {
  if (!args.guid) throw new Error('createCustomerNote: missing customer guid');
  if (!args.note?.trim()) throw new Error('createCustomerNote: empty note');

  const client = createShoptetApiClient(shop, db);
  return callWithRetry<CustomerNoteResponse>(
    () =>
      client.post<unknown>(
        `/api/customers/${encodeURIComponent(args.guid)}/notes`,
        { data: { note: args.note } }
      ),
    'createCustomerNote'
  );
}

export async function updateProduct(
  shop: Shop,
  db: PulsDb,
  args: { guid: string; patch: ProductPatch }
): Promise<ProductDetailResponse> {
  if (!args.guid) throw new Error('updateProduct: missing product guid');
  if (!args.patch || Object.keys(args.patch).length === 0) {
    throw new Error('updateProduct: empty patch');
  }
  // Nová pole kanonického ProductPatch zatím Shoptet API neumí — místo tiché
  // ignorace vyhodíme srozumitelnou chybu (žádný silent no-op).
  const unsupported = [
    'ean',
    'weight',
    'stock',
    'availabilityLabel',
    'manufacturer',
    'addImageUrls',
    'mainImageUrl',
    'categories',
    'parameters',
    'pricelistName',
    'productDiscountPercent',
  ];
  const rejected = unsupported.filter((f) => f in args.patch);
  if (rejected.length > 0) {
    // `stock` má na Shoptetu vlastní cestu — nasměruj klienta místo slepé chyby.
    const stockHint = rejected.includes('stock')
      ? ' (to change stock, use update_stock with a stockId from list_stocks)'
      : '';
    throw new Error(
      `updateProduct: field(s) ${rejected.join(', ')} are not supported on Shoptet yet${stockHint}`
    );
  }
  const client = createShoptetApiClient(shop, db);
  return callWithRetry<ProductDetailResponse>(
    () =>
      client.patch<unknown>(
        `/api/products/${encodeURIComponent(args.guid)}`,
        { data: args.patch }
      ),
    'updateProduct'
  );
}

export async function setActionPrice(
  shop: Shop,
  db: PulsDb,
  args: { guid: string; price: number; validFrom?: string; validTo?: string }
): Promise<ActionPriceResponse> {
  if (!args.guid) throw new Error('setActionPrice: missing product guid');
  if (!Number.isFinite(args.price) || args.price < 0) {
    throw new Error('setActionPrice: price must be a non-negative number');
  }
  const client = createShoptetApiClient(shop, db);
  return callWithRetry<ActionPriceResponse>(
    () =>
      client.put<unknown>(
        `/api/products/${encodeURIComponent(args.guid)}/action-price`,
        {
          data: {
            price: args.price,
            ...(args.validFrom ? { validFrom: args.validFrom } : {}),
            ...(args.validTo ? { validTo: args.validTo } : {}),
          },
        }
      ),
    'setActionPrice'
  );
}

export async function createVoucher(
  shop: Shop,
  db: PulsDb,
  input: VoucherCreateInput
): Promise<VoucherResponse> {
  if (!input.code?.trim()) {
    throw new Error('createVoucher: Shoptet requires an explicit voucher code');
  }
  // Upgates-only pole, která Shoptet API neumí → srozumitelná chyba (no silent no-op).
  const unsupported: string[] = [];
  if (input.discountType === 'free_shipping_payment') unsupported.push('discountType=free_shipping_payment');
  if (input.count !== undefined && input.count !== 1) unsupported.push('count>1');
  if (input.reusable !== undefined) unsupported.push('reusable');
  if (input.minOrderValue !== undefined) unsupported.push('minOrderValue');
  if (input.appliesToActionProducts !== undefined) unsupported.push('appliesToActionProducts');
  if (input.currency !== undefined) unsupported.push('currency');
  if (input.active !== undefined) unsupported.push('active');
  if (input.validFrom !== undefined) unsupported.push('validFrom');
  if (input.note !== undefined) unsupported.push('note');
  if (unsupported.length > 0) {
    throw new Error(
      `createVoucher: field(s) ${unsupported.join(', ')} are not supported on Shoptet`
    );
  }
  if (input.discountType !== 'percent' && input.discountType !== 'amount') {
    throw new Error('createVoucher: discountType must be "percent" or "amount"');
  }
  if (!Number.isFinite(input.discountValue) || (input.discountValue ?? 0) <= 0) {
    throw new Error('createVoucher: discountValue must be > 0');
  }
  const client = createShoptetApiClient(shop, db);
  await callWithRetry<unknown>(
    () =>
      client.post<unknown>('/api/vouchers', {
        data: {
          code: input.code,
          discountType: input.discountType,
          discountValue: input.discountValue,
          ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        },
      }),
    'createVoucher'
  );
  // Vrať kanonický tvar (codes[] = jeden zadaný kód; Shoptet kód negeneruje).
  return {
    data: {
      codes: [input.code],
      code: input.code,
      discountType: input.discountType,
      discountValue: input.discountValue,
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    },
  };
}

export async function updateStock(
  shop: Shop,
  db: PulsDb,
  args: { guid: string; stockId: string; quantity: number }
): Promise<StockUpdateResponse> {
  if (!args.guid) throw new Error('updateStock: missing product guid');
  if (!args.stockId) throw new Error('updateStock: missing stockId');
  // Tool-layer default "default" platí pro platformy s jedním product-level
  // skladem (Upgates) — Shoptet chce reálné stockId, fail-fast s nasměrováním.
  if (args.stockId === 'default') {
    throw new Error(
      'updateStock: Shoptet requires a specific stockId — use list_stocks to discover stock ids'
    );
  }
  if (!Number.isFinite(args.quantity)) {
    throw new Error('updateStock: quantity must be a number');
  }
  const client = createShoptetApiClient(shop, db);
  return callWithRetry<StockUpdateResponse>(
    () =>
      client.patch<unknown>(
        `/api/products/${encodeURIComponent(args.guid)}/stock`,
        { data: { stockId: args.stockId, quantity: args.quantity } }
      ),
    'updateStock'
  );
}

export async function bulkUpdateProducts(
  shop: Shop,
  db: PulsDb,
  items: BulkProductItem[]
): Promise<BulkProductResult[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('bulkUpdateProducts: items must be a non-empty array');
  }
  if (items.length > 50) {
    throw new Error('bulkUpdateProducts: max 50 items per call');
  }
  const results: BulkProductResult[] = [];
  for (const item of items) {
    try {
      const data = await updateProduct(shop, db, item);
      results.push({ guid: item.guid, status: 'ok', data: data.data });
    } catch (err) {
      results.push({
        guid: item.guid,
        status: 'error',
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
  return results;
}
