// Raw Upgates API v2 odpovědi. JSON klíče jsou lowercase snake_case.
// Tvary OVĚŘENY proti reálnému API (dev eshop dev eshop, 2026-06-07):
// objednávka = order_number/order_total/currency_id/creation_time/paid_date
// + vnořený `customer` (ico/dic), produkt = `prices[].pricelists[]`, booleany
// jsou skutečné JSON booleany (ne "Y"/"N" — to byl tvar Prism mocku). Mappery
// čtou defenzivně: reálná pole s fallbackem na původní mock tvary.

export interface UpgatesLangText {
  language?: string;
  title?: string;
  /** Mock/legacy ploché pole. Reálné API: `short_description`/`long_description`. */
  description?: string;
  /** Reálné API: krátký popis produktu. */
  short_description?: string | null;
  /** Reálné API: dlouhý popis produktu (sem zapisuje buildProductBody). */
  long_description?: string | null;
  name?: string;
}

/**
 * Reálné API: GET /api/v2/products/{code}/parameters → položka má tvar
 * `{name:{<lang>:string}, values:[{<lang>:string}, ...]}` (jazykově-klíčovaná
 * mapa, NE descriptions[] — LIVE OVĚŘENO dev eshop 2026-06-11). Parametry NEJSOU
 * inline na detailu produktu — jen na tomto subresource.
 */
export interface UpgatesParameterRaw {
  name?: Record<string, string>;
  values?: Array<Record<string, string>>;
}

export interface UpgatesOrderProductRaw {
  code?: string;
  title?: string;
  quantity?: number | string;
  /** Reálné API: jednotková cena s DPH. */
  price_per_unit_with_vat?: number | string | null;
  price_per_unit?: number | string | null;
  /** Mock/legacy tvar. */
  price_with_vat?: number | string;
  vat?: number | string;
}

/** Vnořený zákazník objednávky (reálné API). */
export interface UpgatesOrderCustomerRaw {
  email?: string | null;
  phone?: string | null;
  code?: string | null;
  customer_id?: number | null;
  firstname_invoice?: string | null;
  surname_invoice?: string | null;
  company?: string | null;
  /** IČO. */
  ico?: string | null;
  /** DIČ. */
  dic?: string | null;
  company_yn?: boolean;
}

export interface UpgatesOrderRaw {
  /** Reálné API: číslo objednávky (kanonický `code`). */
  order_number?: string;
  order_id?: number;
  /** Mock/legacy tvar. */
  code?: string;
  status?: string;
  status_id?: number;
  /** Reálné API: datum zaplacení (null = nezaplaceno). */
  paid_date?: string | null;
  /** Mock/legacy: `Y`/`N`. */
  paid_yn?: string;
  /** Reálné API: měna objednávky. */
  currency_id?: string;
  currency?: string;
  /** Reálné API: celková cena. */
  order_total?: number | string;
  total_price_with_vat?: number | string;
  invoice_number?: string | null;
  /** Reálné API: variabilní symbol platby. */
  variable_symbol?: string | null;
  /** Reálné API: sledování zásilky (null dokud není odesláno). */
  tracking_code?: string | null;
  tracking_url?: string | null;
  /** Reálné API: timestampy. */
  creation_time?: string;
  last_update_time?: string;
  /** Mock/legacy timestampy. */
  created_at?: string;
  updated_at?: string;
  /** Reálné API: vnořený zákazník. */
  customer?: UpgatesOrderCustomerRaw;
  /** Mock/legacy plochá pole zákazníka. */
  firstname?: string;
  surname?: string;
  email?: string;
  company?: string;
  /** IČO. */
  company_number?: string;
  /** DIČ. */
  vat_number?: string;
  products?: UpgatesOrderProductRaw[];
  shipment?: string | { name?: string };
  payment?: string | { name?: string };
}

/** Reálné API: cena produktu = per měna/jazyk, uvnitř pricelisty. */
export interface UpgatesPricelistRaw {
  name?: string;
  price_with_vat?: number | string | null;
  price_without_vat?: number | string | null;
  price_original?: number | string | null;
  price_sale?: number | string | null;
}

export interface UpgatesPriceRaw {
  currency?: string;
  language?: string;
  pricelists?: UpgatesPricelistRaw[];
  vat?: number | string | null;
  price_purchase?: number | string | null;
}

/** Reálné API: /api/v2/languages — zdroj eshop meta (žádný /eshop resource). */
export interface UpgatesLanguageRaw {
  language_id?: string;
  active_yn?: boolean | string;
  default_yn?: boolean | string;
  domain?: string | null;
  currency_id?: string | null;
}

export interface UpgatesProductVariantRaw {
  code?: string;
  ean?: string;
  price_with_vat?: number | string;
  stock?: number | string;
}

export interface UpgatesProductRaw {
  code?: string;
  product_id?: number;
  ean?: string | null;
  descriptions?: UpgatesLangText[];
  manufacturer?: string | null;
  /** Reálné API: ceny per měna/jazyk v pricelistech. */
  prices?: UpgatesPriceRaw[];
  /** Mock/legacy plochá cenová pole. */
  price_with_vat?: number | string;
  price_without_vat?: number | string;
  /** Původní (přeškrtnutá) cena. */
  price_original?: number | string;
  /** Akční cena. */
  price_sale?: number | string;
  /** Nákupní cena (může chybět scope). */
  price_purchase?: number | string;
  /** Sazby DPH — pole (mock/legacy; reálně `prices[].vat`). */
  vats?: Array<number | string>;
  currency?: string;
  stock?: number | string | null;
  availability?: string;
  availability_type?: string;
  categories?: Array<string | UpgatesLangText>;
  /** Reálné API posílá boolean, mock `Y`/`N`. */
  active_yn?: boolean | string;
  variants?: UpgatesProductVariantRaw[];
  // --- Write-handling pole (PUT /api/v2/products): hmotnost, číselníkové ID
  //     a obrázky. Čtou se z GET produktu kvůli merge (nikdy nemazat existující
  //     obrázky) a kvůli top-level zápisu weight/ean. Vše defenzivně volitelné.
  /** Hmotnost produktu (reálné API: number; mock/legacy může poslat string). */
  weight?: number | string | null;
  /** ID dostupnosti (číselník /api/v2/availabilities). */
  availability_id?: number | string;
  /** ID výrobce (číselník /api/v2/manufacturers; pozor: pole `manufacturer_id`). */
  manufacturer_id?: number | string;
  /** Obrázky produktu — merge základ pro PUT (zachovat file_id+position+flags). */
  images?: Array<{
    file_id?: string | number;
    position?: number;
    main_yn?: boolean;
    list_yn?: boolean;
    url?: string;
  }>;
}

export interface UpgatesCustomerRaw {
  code?: string;
  email?: string;
  firstname?: string;
  surname?: string;
  company?: string;
  company_number?: string;
  vat_number?: string;
  customer_pricelist_id?: string | number;
  /** Interní poznámka k zákazníkovi (PUT /customers pole `note`). */
  note?: string;
}

export interface UpgatesCategoryRaw {
  code?: string;
  id?: string | number;
  category_id?: string | number;
  parent_id?: string | number | null;
  parent_code?: string | null;
  position?: number | string;
  active_yn?: boolean | string;
  show_in_menu_yn?: boolean | string;
  descriptions?: UpgatesLangText[];
  name?: string;
}

export interface UpgatesStockRaw {
  id?: string | number;
  code?: string;
  name?: string;
  default_yn?: string;
}

export interface UpgatesEshopRaw {
  id?: number | string;
  name?: string;
  url?: string;
  currency?: string;
  language?: string;
  vat_payer_yn?: string;
}

/** Reálné API: GET /api/v2/pricelists položka (definice ceníku, NE per-produkt). */
export interface UpgatesPricelistDefRaw {
  id?: number | string;
  customer_pricelist_id?: number | string;
  name?: string;
  percent?: number | string | null;
  default_yn?: boolean | string;
}

/** Reálné API: GET /api/v2/vouchers položka (read). */
export interface UpgatesVoucherRaw {
  voucher_code?: string;
  active_yn?: boolean | string;
  global_yn?: boolean | string;
  for_products_in_action_yn?: boolean | string;
  /** `percentage` | `price` | `payment_shipment`. */
  type?: string;
  currency_id?: string | null;
  amount?: number | string | null;
  date_from?: string | null;
  date_to?: string | null;
  used_from?: number | string | null;
  note?: string | null;
  creation_time?: string | null;
}
