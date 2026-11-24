import {
  type PlatformCapabilities,
  PRODUCT_PATCH_FIELDS,
} from '@puls/platform-core';

/**
 * Upgates capabilities — read (orders/products/customers/catalog) + insights
 * + memory + WRITE (podmnožina ověřená proti reálnému API, dev eshop
 * 2026-06-07 — viz `writes.ts`).
 *
 * Write výjimky (false → nástroj se neregistruje, graceful degradace):
 * - `setActionPrice` — akční cena s platností od/do v API v2 NEEXISTUJE
 *   (`price_sale` je computed, sleva jen přes `product_discount` bez termínů) →
 *   trvale `false` (poctivost > falešná capability).
 * - `createCustomerNote` a nové create/delete akce (produkt/kategorie/ceník/voucher)
 *   jsou IMPLEMENTOVANÉ (tvary z oficiální dokumentace), ale capability zůstává
 *   `false` do dávkového LIVE ověření proti dev eshop — pak se flipnou na `true`.
 *
 * Insights jsou zapnuté: `sales_summary`/`low_stock`/`top_customers` agregují
 * živě nad `connector.orders.list/get` + `products.list` + `catalog.stocks` —
 * tedy nad reálnými Upgates daty (mapper plní `creationTime`/`totalPrice`/
 * `customer`/`items`), žádné fake data.
 */
export const UPGATES_CAPABILITIES: PlatformCapabilities = {
  categories: {
    orders: true,
    products: true,
    customers: true,
    catalog: true,
    insights: true,
    write: true,
    memory: true,
  },
  writes: {
    // Task 15: order write VYPNUTO u Upgates — uživatel ho nechce a změna stavu
    // u Upgates rozesílá zákazníkovi e-mail/SMS (nereverzibilní vedlejší efekt,
    // nepatří do našeho immediate+audit+revert modelu). Connector metoda zůstává
    // v rozhraní, ale nástroj update_order_status se u Upgates neregistruje.
    updateOrderStatus: false,
    createCustomerNote: false,
    updateProduct: true,
    setActionPrice: false,
    createVoucher: true,
    updateStock: true,
    bulkUpdateProducts: true,
    // LIVE OVĚŘENO proti dev eshop (2026-06-08, 10/10 + ceníky + parametry) →
    // flipnuto na true. createCustomerNote zůstává false (eshop má 0 zákazníků,
    // read-back/append-vs-replace nešlo ověřit). setActionPrice trvale false
    // (API v2 nemá časové okno na ceně).
    createProduct: true,
    deleteProduct: true,
    createCategory: true,
    updateCategory: true,
    deleteCategory: true,
    bulkSetPrices: true,
    managePricelists: true,
    setProductDiscount: true,
    deleteVoucher: true,
  },
  incrementalSync: true,
  // Upgates umí celý ProductPatch (ověřeno proti dev eshop). Platformní gotchas
  // (weight = celé gramy, atd.) doplňuje connector.describeTool do popisu.
  productPatchFields: [...PRODUCT_PATCH_FIELDS],
};
