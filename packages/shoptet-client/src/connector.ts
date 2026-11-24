import { randomBytes } from 'node:crypto';
import type { PlatformConnector } from '@puls/platform-core';
import { PLATFORM, SHOPTET_CAPABILITIES } from '@puls/platform-core';
import { exchangeInstallCode, fetchBasicEshop } from './auth.js';
import { listOrders, getOrder, listOrderChanges } from './orders.js';
import { listProducts, getProduct } from './products.js';
import { listCustomers, getCustomer } from './customers.js';
import { listStocks } from './stocks.js';
import { listCategories } from './categories.js';
import { getEshopInfo } from './eshop.js';
import { verifyWebhookSignature, parseShoptetWebhook } from './webhook.js';
import {
  updateOrderStatus,
  createCustomerNote,
  updateProduct,
  setActionPrice,
  createVoucher,
  updateStock,
  bulkUpdateProducts,
} from './writes.js';

/**
 * Shoptet implementace `PlatformConnector` — faithful facade nad stávajícími
 * funkcemi. Žádná změna chování: vrací přesně dnešní tvary. Tool vrstva i web
 * konzumují connector místo přímých importů z `@puls/shoptet-client`.
 */
/** Shoptet `project.url` → hostname (e.g. "https://x.myshoptet.com" → "x.myshoptet.com"). */
function normalizeDomain(projectUrl: string): string {
  try {
    const normalized = projectUrl.includes('://')
      ? projectUrl
      : `https://${projectUrl}`;
    return new URL(normalized).hostname;
  } catch {
    throw new Error(`Invalid project.url from Shoptet info: ${projectUrl}`);
  }
}

export const shoptetConnector: PlatformConnector = {
  platform: PLATFORM.SHOPTET,
  capabilities: SHOPTET_CAPABILITIES,

  install: async (input) => {
    const { oauthAccessToken } = await exchangeInstallCode({
      code: input.code,
      tokenUrl: input.oauth.tokenUrl,
      clientId: input.oauth.clientId,
      clientSecret: input.oauth.clientSecret,
      redirectUri: input.oauth.redirectUri,
    });
    const eshop = await fetchBasicEshop(input.apiBaseUrl, oauthAccessToken);
    return {
      platform: PLATFORM.SHOPTET,
      externalId: String(eshop.project.id),
      domain: normalizeDomain(eshop.project.url),
      adminEmail: eshop.user.email?.trim().toLowerCase() ?? null,
      name: eshop.user.name ?? null,
      oauthAccessToken,
      webhookSignatureKey: randomBytes(32).toString('hex'),
      apiBaseUrl: input.apiBaseUrl,
    };
  },

  orders: {
    list: (shop, db, opts) => listOrders(shop, db, opts),
    get: (shop, db, code) => getOrder(shop, db, code),
    changes: (shop, db, opts) => listOrderChanges(shop, db, opts),
  },
  products: {
    list: (shop, db, opts) => listProducts(shop, db, opts),
    get: (shop, db, guid) => getProduct(shop, db, guid),
  },
  customers: {
    list: (shop, db, opts) => listCustomers(shop, db, opts),
    get: (shop, db, guid) => getCustomer(shop, db, guid),
  },
  catalog: {
    stocks: (shop, db) => listStocks(shop, db),
    categories: (shop, db) => listCategories(shop, db),
    eshopInfo: (shop, db) => getEshopInfo(shop, db),
  },

  writes: {
    updateOrderStatus: (shop, db, args) => updateOrderStatus(shop, db, args),
    createCustomerNote: (shop, db, args) => createCustomerNote(shop, db, args),
    updateProduct: (shop, db, args) => updateProduct(shop, db, args),
    setActionPrice: (shop, db, args) => setActionPrice(shop, db, args),
    createVoucher: (shop, db, args) => createVoucher(shop, db, args),
    updateStock: (shop, db, args) => updateStock(shop, db, args),
    bulkUpdateProducts: (shop, db, items) => bulkUpdateProducts(shop, db, items),
  },

  webhook: {
    verify: (rawBody, key, signature) =>
      verifyWebhookSignature(rawBody, key, signature),
    parse: (rawUtf8) => parseShoptetWebhook(rawUtf8),
  },
};
