import type { PlatformConnector } from '@puls/platform-core';
import { PLATFORM } from '@puls/platform-core';
import { UPGATES_CAPABILITIES } from './capabilities.js';
import { listOrders, getOrder, listOrderChanges } from './orders.js';
import { listProducts, getProduct } from './products.js';
import { listCustomers, getCustomer } from './customers.js';
import { listStocks } from './stocks.js';
import { listCategories } from './categories.js';
import { listManufacturers } from './manufacturers.js';
import { getEshopInfo } from './eshop.js';
import {
  updateOrderStatus,
  updateProduct,
  createProduct,
  deleteProduct,
  updateStock,
  bulkUpdateProducts,
  createVoucher,
  deleteVoucher,
  listVouchers,
  listPricelists,
  createPricelist,
  deletePricelist,
  createCustomerNote,
  setActionPrice,
} from './writes.js';
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from './category-writes.js';
import { verifyUpgatesWebhook, parseUpgatesNormalized } from './webhook.js';

/**
 * Upgates implementace `PlatformConnector`. Read + write podmnožina ověřená
 * proti reálnému API (viz `writes.ts` a `UPGATES_CAPABILITIES`). Auth je
 * statický Basic (žádný token-exchange), proto se `db` parametr connectoru
 * nepoužívá — Upgates nepotřebuje `api_token_cache` rotaci.
 *
 * `install()` zde záměrně vyhazuje: aktivace doplňku (install/opening/uninstall/
 * versioning + `signature_v2` + získání apiUser/apiKey/apiUrl) je samostatný
 * task 03, ne odpovědnost connectoru.
 */
export const upgatesConnector: PlatformConnector = {
  platform: PLATFORM.UPGATES,
  capabilities: UPGATES_CAPABILITIES,

  // Identifikátory u Upgates jsou CODE/EAN. Neutrální tool description dostane
  // platformně specifický dovětek bez prefixu jména.
  // Platformní gotchas (LIVE OVĚŘENO dev eshop) jdou do popisu konkrétních toolů,
  // ať je model nezjišťuje pokus-omyl.
  describeTool: (name, base) => {
    const notes: Record<string, string> = {
      update_product:
        ' Upgates: weight is in WHOLE GRAMS (a decimal is rounded; e.g. 250 g, not 0.25). Identifiers are product CODE (not a GUID). New images download asynchronously — they may appear a moment later.',
      create_product:
        ' Upgates: a category is REQUIRED — pass patch.categories with at least one valid category code (use list_categories), otherwise the product is hidden in the storefront and creation is rejected. weight is in WHOLE GRAMS (e.g. 250). `code` is the unique pairing key. New images download asynchronously.',
      create_voucher:
        ' Upgates always generates the voucher code itself — a requested `code` is ignored; use the returned codes when telling customers or deleting.',
    };
    return notes[name] ? base + notes[name] : base;
  },

  install: async (_input) => {
    throw new Error(
      'Upgates install/aktivace je řešena v tasku 03 (aktivační endpointy + signature_v2), ne v connectoru'
    );
  },

  orders: {
    list: (shop, _db, opts) => listOrders(shop, opts),
    get: (shop, _db, code) => getOrder(shop, code),
    changes: (shop, _db, opts) => listOrderChanges(shop, opts),
  },
  products: {
    list: (shop, _db, opts) => listProducts(shop, opts),
    get: (shop, _db, guid) => getProduct(shop, guid),
  },
  customers: {
    list: (shop, _db, opts) => listCustomers(shop, opts),
    get: (shop, _db, guid) => getCustomer(shop, guid),
  },
  catalog: {
    stocks: (shop, _db) => listStocks(shop),
    categories: (shop, _db) => listCategories(shop),
    eshopInfo: (shop, _db) => getEshopInfo(shop),
    manufacturers: (shop, _db) => listManufacturers(shop),
  },

  // Read kupónů — pro nástroj list_vouchers (gated capability).
  vouchers: {
    list: (shop, _db, opts) => listVouchers(shop, opts),
  },

  // Write podmnožina ověřená proti reálnému API (viz writes.ts +
  // capabilities.writes — setActionPrice/createCustomerNote zůstávají false).
  // deleteVoucher je wired i když capability=false: revert create_voucher ho
  // volá přímo (capability gatuje jen samostatný nástroj delete_voucher).
  writes: {
    updateOrderStatus: (shop, _db, args) => updateOrderStatus(shop, args),
    updateProduct: (shop, _db, args) => updateProduct(shop, args),
    createProduct: (shop, _db, args) => createProduct(shop, args),
    deleteProduct: (shop, _db, args) => deleteProduct(shop, args),
    createCategory: (shop, _db, args) => createCategory(shop, args),
    updateCategory: (shop, _db, args) => updateCategory(shop, args),
    deleteCategory: (shop, _db, args) => deleteCategory(shop, args),
    updateStock: (shop, _db, args) => updateStock(shop, args),
    bulkUpdateProducts: (shop, _db, items) => bulkUpdateProducts(shop, items),
    createVoucher: (shop, _db, input) => createVoucher(shop, input),
    deleteVoucher: (shop, _db, args) => deleteVoucher(shop, args),
    listPricelists: (shop, _db) => listPricelists(shop),
    createPricelist: (shop, _db, args) => createPricelist(shop, args),
    deletePricelist: (shop, _db, args) => deletePricelist(shop, args),
    createCustomerNote: (shop, _db, args) => createCustomerNote(shop, args),
    setActionPrice: () => setActionPrice(),
  },

  webhook: {
    verify: (rawBody, key, signature) =>
      verifyUpgatesWebhook(rawBody, key, signature),
    parse: (rawUtf8) => parseUpgatesNormalized(rawUtf8),
  },
};
