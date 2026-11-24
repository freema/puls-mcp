// Každá platforma deklaruje, co umí. Registrace nástrojů (apps/mcp-server) pak
// podmíněně registruje kategorie i jednotlivé write akce podle capabilities —
// write kategorie musí gracefully degradovat tam, kde ji platforma neumí.

/**
 * Všechna pole `ProductPatch` (update/create_product). Platforma deklaruje
 * SVOJI podmnožinu přes `capabilities.productPatchFields` → tool vrstva podle ní
 * staví per-platform Zod schéma + popis (Shoptet umí jen základ, Upgates vše).
 * Pořadí = pořadí v popisu nástroje. Klíče musí odpovídat `ProductPatch`.
 */
export const PRODUCT_PATCH_FIELDS = [
  'name',
  'description',
  'priceWithVat',
  'visibility',
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
] as const;
export type ProductPatchField = (typeof PRODUCT_PATCH_FIELDS)[number];

export interface PlatformCapabilities {
  /** Které tool kategorie connector podporuje. */
  categories: {
    orders: boolean;
    products: boolean;
    customers: boolean;
    catalog: boolean;
    insights: boolean;
    write: boolean;
    /** Memory je naše vrstva — vždy true, držíme jednotně. */
    memory: boolean;
  };
  /** Granularita write akcí — když write=true, ale platforma neumí např. voucher. */
  writes: {
    updateOrderStatus: boolean;
    createCustomerNote: boolean;
    updateProduct: boolean;
    setActionPrice: boolean;
    createVoucher: boolean;
    updateStock: boolean;
    bulkUpdateProducts: boolean;
    // --- Rozšíření (Upgates write expanze 2026-06) ---
    /** Založení produktu (POST /products). */
    createProduct: boolean;
    /** Smazání produktu (interní — revert create_product). */
    deleteProduct: boolean;
    /** Založení kategorie. */
    createCategory: boolean;
    /** Úprava kategorie. */
    updateCategory: boolean;
    /** Smazání kategorie. */
    deleteCategory: boolean;
    /** Hromadné nastavení/úprava cen (set/adjust). */
    bulkSetPrices: boolean;
    /** Správa ceníků (list/create/delete). */
    managePricelists: boolean;
    /** Procentní sleva produktu bez časového okna. */
    setProductDiscount: boolean;
    /** Smazání kupónu (DELETE /vouchers) — jádro revertu create_voucher. */
    deleteVoucher: boolean;
  };
  /** Inkrementální sync přes `since` (orders.changes). */
  incrementalSync: boolean;
  /**
   * Která pole `ProductPatch` platforma reálně umí zapsat — řídí per-platform
   * schéma a popis update/create_product. Když není uvedeno, tool vrstva použije
   * PLNÝ list (`PRODUCT_PATCH_FIELDS`) = původní superset chování (zpětně
   * kompatibilní pro mocky/testy). Platforma s užší množinou ji vyjmenuje, aby
   * model nedostal argumenty, které platforma stejně odmítne (žádný slepý pokus).
   */
  productPatchFields?: readonly ProductPatchField[];
}

/** Shoptet umí všechno co dnes — zachování chování (žádná regrese). */
export const SHOPTET_CAPABILITIES: PlatformCapabilities = {
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
    updateOrderStatus: true,
    createCustomerNote: true,
    updateProduct: true,
    setActionPrice: true,
    createVoucher: true,
    updateStock: true,
    bulkUpdateProducts: true,
    // Shoptet create/manage akce zatím neimplementované → false (graceful
    // degradace, nástroj se nezaregistruje). bulkSetPrices=true: nástroj
    // bulk_set_prices loopuje přes ověřený updateProduct (Shoptet), non-Default
    // pricelistName vyhodí srozumitelnou chybu (reject list v updateProduct).
    createProduct: false,
    deleteProduct: false,
    createCategory: false,
    updateCategory: false,
    deleteCategory: false,
    bulkSetPrices: true,
    managePricelists: false,
    setProductDiscount: false,
    deleteVoucher: false,
  },
  incrementalSync: true,
  // Shoptet update_product dnes umí jen základní pole — zbytek (ean/weight/
  // manufacturer/images/categories/parameters/…) writes.ts tvrdě odmítá. Schéma
  // proto tato pole vůbec nenabídne (místo runtime "not supported on Shoptet").
  // `stock` má vlastní cestu update_stock, do patche nepatří.
  productPatchFields: ['name', 'description', 'priceWithVat', 'visibility'],
};
