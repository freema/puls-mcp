export {
  exchangeInstallCode,
  fetchApiAccessToken,
  fetchBasicEshop,
} from './auth.js';
export type { ExchangeInstallCodeParams } from './auth.js';
export { createShoptetApiClient } from './api.js';
export { shoptetConnector } from './connector.js';
export { getApiAccessToken, isAccessTokenFresh } from './token-cache.js';
export type { PulsDb } from './token-cache.js';
export { listOrders, getOrder, listOrderChanges } from './orders.js';
export { listProducts, getProduct } from './products.js';
export { listCustomers, getCustomer } from './customers.js';
export { listStocks } from './stocks.js';
export { listCategories } from './categories.js';
export { getEshopInfo } from './eshop.js';
export { verifyWebhookSignature, parseShoptetWebhook } from './webhook.js';
export {
  updateOrderStatus,
  createCustomerNote,
  updateProduct,
  setActionPrice,
  createVoucher,
  updateStock,
  bulkUpdateProducts,
} from './writes.js';
export type {
  CustomerNoteResponse,
  ProductPatch,
  ActionPriceResponse,
  VoucherDiscountType,
  VoucherResponse,
  StockUpdateResponse,
  BulkProductItem,
  BulkProductResult,
} from './writes.js';
export type {
  Order,
  OrderListResponse,
  OrderDetail,
  OrderDetailResponse,
  OrderChange,
  OrderChangesResponse,
  Product,
  ProductListResponse,
  ProductDetail,
  ProductDetailResponse,
  Customer,
  CustomerListResponse,
  CustomerDetail,
  CustomerDetailResponse,
  Stock,
  StockListResponse,
  Category,
  CategoryListResponse,
  EshopMeta,
  EshopMetaResponse,
  TokenResponse,
  EshopInfoResponse,
} from './types.js';

import type { PulsDb } from './token-cache.js';
import {
  listOrders as fetchOrders,
  getOrder as fetchOrder,
  listOrderChanges as fetchOrderChanges,
} from './orders.js';
import {
  listProducts as fetchProducts,
  getProduct as fetchProduct,
} from './products.js';
import {
  listCustomers as fetchCustomers,
  getCustomer as fetchCustomer,
} from './customers.js';
import { listStocks as fetchStocks } from './stocks.js';
import { listCategories as fetchCategories } from './categories.js';
import { getEshopInfo as fetchEshopInfo } from './eshop.js';
import type { Shop } from './types.js';

export class ShoptetClient {
  constructor(
    private readonly shop: Shop,
    private readonly db: PulsDb
  ) {}

  listOrders(opts?: { status?: string; limit?: number }) {
    return fetchOrders(this.shop, this.db, opts);
  }

  getOrder(code: string) {
    return fetchOrder(this.shop, this.db, code);
  }

  listOrderChanges(opts?: { from?: string; limit?: number }) {
    return fetchOrderChanges(this.shop, this.db, opts);
  }

  listProducts(opts?: { limit?: number; page?: number }) {
    return fetchProducts(this.shop, this.db, opts);
  }

  getProduct(guid: string) {
    return fetchProduct(this.shop, this.db, guid);
  }

  listCustomers(opts?: { limit?: number }) {
    return fetchCustomers(this.shop, this.db, opts);
  }

  getCustomer(guid: string) {
    return fetchCustomer(this.shop, this.db, guid);
  }

  listStocks() {
    return fetchStocks(this.shop, this.db);
  }

  listCategories() {
    return fetchCategories(this.shop, this.db);
  }

  getEshopInfo() {
    return fetchEshopInfo(this.shop, this.db);
  }
}
