import type {
  Order,
  OrderDetail,
  OrderItem,
  Product,
  ProductDetail,
  ProductImage,
  ProductParameterValue,
  ProductVariant,
  Customer,
  CustomerDetail,
  Category,
  Stock,
  EshopMeta,
  VoucherSummary,
  VoucherDiscountType,
  Pricelist,
} from '@puls/platform-core';
import { pickLanguage } from './lang.js';
import type {
  UpgatesOrderRaw,
  UpgatesOrderProductRaw,
  UpgatesParameterRaw,
  UpgatesProductRaw,
  UpgatesProductVariantRaw,
  UpgatesCustomerRaw,
  UpgatesCategoryRaw,
  UpgatesStockRaw,
  UpgatesEshopRaw,
  UpgatesLanguageRaw,
  UpgatesVoucherRaw,
  UpgatesPricelistDefRaw,
} from './types.js';

const DEFAULT_LANG = 'cs';

function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Reálné Upgates API posílá JSON booleany; Prism mock `Y`/`N` stringy. */
function yn(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  return typeof v === 'string' && (v.toUpperCase() === 'Y' || v === 'true');
}

function fullName(firstname?: string, surname?: string): string | undefined {
  const name = [firstname, surname].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : undefined;
}

// --- Orders -----------------------------------------------------------------

export function mapOrder(raw: UpgatesOrderRaw): Order {
  return {
    // Reálné API: `order_number`; mock/legacy: `code`.
    code: raw.order_number ?? raw.code ?? '',
    status: raw.status ?? '',
    totalPrice: toNumber(raw.order_total ?? raw.total_price_with_vat),
  };
}

function mapOrderItem(p: UpgatesOrderProductRaw): OrderItem {
  return {
    name: p.title ?? '',
    amount: toNumber(p.quantity),
    unitPrice: toNumber(p.price_per_unit_with_vat ?? p.price_with_vat),
  };
}

export function mapOrderDetail(raw: UpgatesOrderRaw): OrderDetail {
  const c = raw.customer; // reálné API: vnořený zákazník
  return {
    ...mapOrder(raw),
    creationTime: raw.creation_time ?? raw.created_at,
    currency: raw.currency_id ?? raw.currency,
    // Reálné API: `paid_date` (null = nezaplaceno); mock: `paid_yn` Y/N.
    paid: raw.paid_date != null ? true : yn(raw.paid_yn),
    // Fulfillment/účetní pole — Upgates je nese top-level (null dokud nevznikne).
    invoiceNumber: raw.invoice_number ?? undefined,
    variableSymbol: raw.variable_symbol ?? undefined,
    trackingCode: raw.tracking_code ?? undefined,
    trackingUrl: raw.tracking_url ?? undefined,

    customer: {
      email: c?.email ?? raw.email ?? undefined,
      name:
        fullName(
          c?.firstname_invoice ?? raw.firstname ?? undefined,
          c?.surname_invoice ?? raw.surname ?? undefined
        ),
      company: c?.company ?? raw.company ?? undefined,
      companyId: c?.ico ?? raw.company_number ?? undefined, // IČO — B2B nativní u Upgates
      vatId: c?.dic ?? raw.vat_number ?? undefined, // DIČ
    },
    items: (raw.products ?? []).map(mapOrderItem),
  };
}

// --- Products ---------------------------------------------------------------

function mapVatRates(vats: UpgatesProductRaw['vats']): number[] | undefined {
  if (!Array.isArray(vats)) return undefined;
  const rates = vats
    .map(toNumber)
    .filter((n): n is number => n !== undefined);
  return rates.length > 0 ? rates : undefined;
}

export function mapProductVariant(raw: UpgatesProductVariantRaw): ProductVariant {
  return {
    code: raw.code ?? '',
    ean: raw.ean,
    priceWithVat: toNumber(raw.price_with_vat),
    stock: toNumber(raw.stock),
  };
}

/**
 * Reálné API: cena je v `prices[]` per měna/jazyk, uvnitř `pricelists[]`
 * (zákazník bez přiřazeného ceníku = "Default"). Vyber price-blok podle
 * jazyka administrace (fallback první) a v něm Default pricelist (fallback
 * první). Mock/legacy plochá pole zůstávají jako fallback.
 */
function pickPrice(raw: UpgatesProductRaw, adminLang: string) {
  const prices = raw.prices;
  if (!Array.isArray(prices) || prices.length === 0) return undefined;
  const block =
    prices.find((p) => p.language === adminLang) ??
    prices.find((p) => p.language === DEFAULT_LANG) ??
    prices[0];
  const lists = block?.pricelists ?? [];
  const list = lists.find((l) => l.name === 'Default') ?? lists[0];
  return { block, list };
}

export function mapProduct(
  raw: UpgatesProductRaw,
  adminLang: string = DEFAULT_LANG
): Product {
  const desc = pickLanguage(raw.descriptions, adminLang, DEFAULT_LANG);
  const price = pickPrice(raw, adminLang);
  const vatFromPrices = toNumber(price?.block?.vat);
  return {
    guid: raw.code ?? '',
    name: desc?.title ?? '',
    code: raw.code,
    ean: raw.ean ?? undefined,
    price: toNumber(price?.list?.price_with_vat ?? raw.price_with_vat),
    priceWithoutVat: toNumber(
      price?.list?.price_without_vat ?? raw.price_without_vat
    ),
    priceOriginal: toNumber(price?.list?.price_original ?? raw.price_original),
    priceSale: toNumber(price?.list?.price_sale ?? raw.price_sale),
    vatRates:
      vatFromPrices !== undefined ? [vatFromPrices] : mapVatRates(raw.vats),
    availabilityLabel: raw.availability,
    manufacturer: raw.manufacturer ?? undefined,
    currency: price?.block?.currency ?? raw.currency,
    stock: toNumber(raw.stock),
    visible: yn(raw.active_yn),
  };
}

/** Obrázek produktu (Upgates `images[]`) → kanonický ProductImage. */
function mapProductImage(
  img: NonNullable<UpgatesProductRaw['images']>[number]
): ProductImage {
  return {
    ...(img.url !== undefined ? { url: img.url } : {}),
    ...(img.main_yn !== undefined ? { main: yn(img.main_yn) } : {}),
    ...(img.position !== undefined ? { position: toNumber(img.position) } : {}),
  };
}

/** Z jazykově-klíčované mapy `{en:..,cs:..}` vybere hodnotu dle jazyka admina. */
function pickLangMap(
  map: Record<string, string> | undefined,
  adminLang: string
): string | undefined {
  if (!map) return undefined;
  return map[adminLang] ?? map[DEFAULT_LANG] ?? Object.values(map)[0];
}

/**
 * Parametr produktu ze subresource `/products/{code}/parameters`. Reálný tvar:
 * `{name:{<lang>:string}, values:[{<lang>:string}]}`. Více hodnot (list parametr)
 * spojí do jednoho stringu čárkou. Název i hodnota dle jazyka administrace.
 */
export function mapParameter(
  raw: UpgatesParameterRaw,
  adminLang: string = DEFAULT_LANG
): ProductParameterValue {
  const name = pickLangMap(raw.name, adminLang) ?? '';
  const values = (raw.values ?? [])
    .map((v) => pickLangMap(v, adminLang))
    .filter((v): v is string => !!v);
  return { name, value: values.join(', ') };
}

export function mapProductDetail(
  raw: UpgatesProductRaw,
  adminLang: string = DEFAULT_LANG
): ProductDetail {
  const desc = pickLanguage(raw.descriptions, adminLang, DEFAULT_LANG);
  const categories = (raw.categories ?? [])
    .map((c) =>
      typeof c === 'string'
        ? c
        : (pickLanguage([c], adminLang, DEFAULT_LANG)?.name ?? c.name ?? '')
    )
    .filter((name): name is string => name.length > 0);
  // Každá varianta = plnohodnotný produkt s vlastní cenou/skladem/EAN.
  const variants = (raw.variants ?? []).map(mapProductVariant);
  const images = (raw.images ?? []).map(mapProductImage);
  // Reálné API: dlouhý popis je `long_description` (sem zapisuje buildProductBody),
  // krátký `short_description`. Mock/legacy ploché `description` zůstává fallback.
  // (`?? undefined` převede null z API na vynechané pole.)
  const description = desc?.long_description ?? desc?.description ?? undefined;
  const shortDescription = desc?.short_description ?? undefined;
  const weight = toNumber(raw.weight);
  return {
    ...mapProduct(raw, adminLang),
    ...(description != null ? { description } : {}),
    ...(shortDescription != null ? { shortDescription } : {}),
    ...(weight !== undefined ? { weight } : {}),
    categories,
    ...(images.length > 0 ? { images } : {}),
    ...(variants.length > 0 ? { variants } : {}),
  };
}

// --- Customers --------------------------------------------------------------

export function mapCustomer(raw: UpgatesCustomerRaw): Customer {
  return {
    guid: raw.code ?? '',
    email: raw.email ?? '',
    name: fullName(raw.firstname, raw.surname),
  };
}

export function mapCustomerDetail(raw: UpgatesCustomerRaw): CustomerDetail {
  return {
    ...mapCustomer(raw),
    company: raw.company,
    companyId: raw.company_number,
    vatId: raw.vat_number,
    note: raw.note ?? undefined,
  };
}

// --- Categories -------------------------------------------------------------

export function mapCategory(
  raw: UpgatesCategoryRaw,
  adminLang: string = DEFAULT_LANG
): Category {
  const desc = pickLanguage(raw.descriptions, adminLang, DEFAULT_LANG);
  return {
    guid: String(raw.code ?? raw.category_id ?? raw.id ?? ''),
    name: desc?.name ?? raw.name ?? '',
    parentGuid: raw.parent_id != null ? String(raw.parent_id) : null,
    code: raw.code ?? undefined,
    position: toNumber(raw.position),
    showInMenu:
      raw.show_in_menu_yn !== undefined ? yn(raw.show_in_menu_yn) : undefined,
    visible: raw.active_yn !== undefined ? yn(raw.active_yn) : undefined,
  };
}

// --- Stock / Availability ---------------------------------------------------

export function mapStock(raw: UpgatesStockRaw): Stock {
  return {
    id: String(raw.code ?? raw.id ?? ''),
    name: raw.name ?? '',
    default: yn(raw.default_yn),
    // `availabilities` resource: name = lidský label dostupnosti („Skladem").
    availabilityLabel: raw.name,
  };
}

// --- Vouchers (read) --------------------------------------------------------

/** Upgates `type` → neutrální VoucherDiscountType. */
function voucherDiscountType(t: string | undefined): VoucherDiscountType | undefined {
  if (t === 'percentage') return 'percent';
  if (t === 'price') return 'amount';
  if (t === 'payment_shipment') return 'free_shipping_payment';
  return undefined;
}

export function mapVoucherSummary(raw: UpgatesVoucherRaw): VoucherSummary {
  return {
    code: raw.voucher_code ?? '',
    active: yn(raw.active_yn),
    reusable: yn(raw.global_yn),
    discountType: voucherDiscountType(raw.type),
    discountValue: toNumber(raw.amount),
    currency: raw.currency_id ?? undefined,
    validFrom: raw.date_from ?? undefined,
    validUntil: raw.date_to ?? undefined,
    minOrderValue: toNumber(raw.used_from),
    note: raw.note ?? undefined,
    createdAt: raw.creation_time ?? undefined,
  };
}

// --- Pricelists (read) ------------------------------------------------------

export function mapPricelist(raw: UpgatesPricelistDefRaw): Pricelist {
  return {
    id: Number(raw.id ?? raw.customer_pricelist_id ?? 0),
    name: raw.name ?? '',
    percent: toNumber(raw.percent),
    isDefault: yn(raw.default_yn),
  };
}

// --- Eshop meta -------------------------------------------------------------

export function mapEshop(raw: UpgatesEshopRaw): EshopMeta {
  return {
    id: toNumber(raw.id) ?? 0,
    name: raw.name ?? '',
    url: raw.url ?? '',
    currency: raw.currency,
    language: raw.language,
    vatPayer: yn(raw.vat_payer_yn),
  };
}

/**
 * Reálné Upgates API žádný `/eshop` resource NEMÁ (ověřeno: 403 i pro
 * /eshops, /eshop-info, /properties). Eshop meta se skládá z
 * `/api/v2/languages` (default jazyk nese doménu eshopu i měnu) + jména
 * shopu z naší DB. `vatPayer` reálné API neexponuje → false.
 */
export function mapEshopFromLanguages(
  langs: UpgatesLanguageRaw[],
  shopName: string | null | undefined
): EshopMeta {
  const def =
    langs.find((l) => yn(l.default_yn)) ??
    langs.find((l) => yn(l.active_yn)) ??
    langs[0];
  return {
    id: 0, // Upgates nemá numerické eshop id v API v2
    name: shopName ?? def?.domain ?? '',
    url: def?.domain ?? '',
    currency: def?.currency_id ?? undefined,
    language: def?.language_id ?? undefined,
    vatPayer: false,
  };
}
