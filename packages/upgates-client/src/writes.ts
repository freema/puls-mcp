import type {
  Shop,
  OrderDetailResponse,
  CustomerNoteResponse,
  ProductDetailResponse,
  ProductCreate,
  ProductCreateResponse,
  ActionPriceResponse,
  VoucherCreateInput,
  VoucherResponse,
  VoucherListResponse,
  VoucherDeleteResponse,
  StockUpdateResponse,
  BulkProductItem,
  BulkProductResult,
  ProductPatch,
  PricelistListResponse,
  PricelistMutationResponse,
} from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { paginateAll } from './pagination.js';
import { extractUpgatesError } from './errors.js';
import {
  MANUFACTURERS_PATH,
  extractManufacturers,
} from './manufacturers.js';
import { getOrder } from './orders.js';
import { getProduct } from './products.js';
import { mapVoucherSummary, mapPricelist } from './mappers.js';
import type {
  UpgatesLanguageRaw,
  UpgatesPriceRaw,
  UpgatesProductRaw,
  UpgatesVoucherRaw,
  UpgatesPricelistDefRaw,
} from './types.js';

/**
 * Upgates write operace — VŠECHNY tvary OVĚŘENY proti reálnému API
 * (dev eshop dev eshop, 2026-06-07):
 *
 * - `PUT /api/v2/orders`   body `{orders:[{order_number, status_id, ...}]}`
 *   → `{orders:[{updated_yn: true}]}`; číselník stavů `GET /api/v2/order-statuses`
 *   (`{order_statuses:[{id, type, descriptions:[{language_id, name}]}]}`).
 * - `PUT /api/v2/products` body `{products:[{code, ...patch}]}`; ceny POUZE
 *   přes `prices:[{currency, language, pricelists:[{name, price_with_vat}]}]`
 *   — bez `currency` je update tichý no-op! `stock` je top-level pole.
 * - `POST /api/v2/vouchers` body je PLOCHÝ objekt (žádný array wrapper):
 *   `{code, type: 'percentage'|'price', currency_id, amount}` → `{vouchers:[id]}`.
 *
 * Neověřené (capability = false, doptat na konzultaci s Upgates):
 * - akční cena s platností od/do (`price_sale` je computed/no-op, sleva jde
 *   jen přes `product_discount` bez termínů),
 * - poznámka k zákazníkovi (customers write tvar neověřen).
 */

const ORDERS_PATH = '/api/v2/orders';
const ORDER_STATUSES_PATH = '/api/v2/order-statuses';
const PRODUCTS_PATH = '/api/v2/products';
const VOUCHERS_PATH = '/api/v2/vouchers';
const AVAILABILITIES_PATH = '/api/v2/availabilities';
const PRICELISTS_PATH = '/api/v2/pricelists';
const CUSTOMERS_PATH = '/api/v2/customers';

type UpgatesOrderStatusRaw = {
  id?: number;
  type?: string;
  descriptions?: Array<{ language_id?: string; name?: string }>;
};

type UpgatesWriteResultRow = {
  order_number?: string;
  code?: string;
  /** Response řádek zákazníka (PUT /customers) nemá code/order_number, ale email. */
  email?: string;
  updated_yn?: boolean;
  messages?: Array<{ property?: string; message?: string; level?: string }>;
};

function writeErrors(rows: UpgatesWriteResultRow[] | undefined): string | null {
  const failed = (rows ?? []).filter((r) => r.updated_yn === false);
  if (failed.length === 0) return null;
  return failed
    .map(
      (r) =>
        `${r.order_number ?? r.code ?? r.email ?? '?'}: ${(r.messages ?? [])
          .map((m) => `${m.property ?? ''} ${m.message ?? ''}`.trim())
          .join('; ') || 'update rejected'}`
    )
    .join(' | ');
}

/** `status` (lidský název nebo systémový type) → Upgates `status_id`. */
async function resolveStatusId(
  client: ReturnType<typeof createUpgatesApiClient>,
  status: string
): Promise<number> {
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: ORDER_STATUSES_PATH,
  });
  if (res.status >= 400) {
    throw new Error(`updateOrderStatus failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as
    | { order_statuses?: UpgatesOrderStatusRaw[] }
    | undefined;
  const statuses = body?.order_statuses ?? [];
  const wanted = status.trim().toLowerCase();
  const match = statuses.find(
    (s) =>
      s.type?.toLowerCase() === wanted ||
      (s.descriptions ?? []).some((d) => d.name?.toLowerCase() === wanted)
  );
  if (match?.id == null) {
    const available = statuses
      .flatMap((s) => (s.descriptions ?? []).map((d) => d.name))
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `updateOrderStatus: unknown status "${status}" (available: ${available})`
    );
  }
  return match.id;
}

export async function updateOrderStatus(
  shop: Shop,
  args: { code: string; status: string; comment?: string }
): Promise<OrderDetailResponse> {
  if (!args.code) throw new Error('updateOrderStatus: missing order code');
  if (!args.status) throw new Error('updateOrderStatus: missing status');

  const client = createUpgatesApiClient(shop);
  const statusId = await resolveStatusId(client, args.status);

  const res = await upgatesRequest<unknown>(client, {
    method: 'PUT',
    url: ORDERS_PATH,
    data: {
      orders: [
        {
          order_number: args.code,
          status_id: statusId,
          ...(args.comment ? { internal_note: args.comment } : {}),
        },
      ],
    },
  });
  if (res.status >= 400) {
    throw new Error(`updateOrderStatus failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as { orders?: UpgatesWriteResultRow[] } | undefined;
  const err = writeErrors(body?.orders);
  if (err) throw new Error(`updateOrderStatus rejected: ${err}`);

  return getOrder(shop, args.code);
}

/**
 * Postaví tělo produktu (PUT i POST) z kanonického `ProductPatch`. Jazykové/
 * měnové bloky se berou z `raw` (u update z GET produktu; u create ze syntetického
 * raw s default jazykem/měnou eshopu) — name/description do VŠECH jazyků, cena do
 * všech price bloků (ceník dle `pricelistName`, default 'Default').
 *
 * `resolved` nese hodnoty dořešené PŘED stavbou (vyžadují extra GETy):
 * `availabilityId`/`manufacturerId` z číselníků a kompletní pole `images` (merge
 * existujících + nových). Když pole není zadané, do těla se nepřidá (defenzivní).
 */
function buildProductBody(
  raw: UpgatesProductRaw,
  code: string,
  patch: ProductPatch,
  resolved?: {
    availabilityId?: number;
    manufacturerId?: number;
    images?: Array<Record<string, unknown>>;
  }
): Record<string, unknown> {
  const out: Record<string, unknown> = { code };
  const langs = (raw.descriptions ?? [])
    .map((d) => d.language)
    .filter((l): l is string => !!l);
  const fallbackLangs = langs.length > 0 ? langs : ['cs'];
  const primaryLang = fallbackLangs[0];

  if (patch.name !== undefined || patch.description !== undefined) {
    out.descriptions = fallbackLangs.map((language) => ({
      language,
      ...(patch.name !== undefined ? { title: patch.name } : {}),
      ...(patch.description !== undefined
        ? { long_description: patch.description }
        : {}),
    }));
  }

  const pricelistName = patch.pricelistName ?? 'Default';
  if (
    patch.priceWithVat !== undefined ||
    patch.productDiscountPercent !== undefined
  ) {
    const blocks: UpgatesPriceRaw[] =
      raw.prices && raw.prices.length > 0
        ? raw.prices
        : [{ currency: undefined, language: undefined }];
    out.prices = blocks.map((b) => ({
      currency: b.currency,
      language: b.language,
      pricelists: [
        {
          name: pricelistName,
          // LIVE OVĚŘENO (dev eshop 2026-06-08): zapisovatelné pole je
          // `price_original` — `price_with_vat`/`price_without_vat` jsou computed
          // (zápis sám o sobě = no-op, cena zůstane 0). Píšeme obojí pro robustnost.
          ...(patch.priceWithVat !== undefined
            ? {
                price_original: patch.priceWithVat,
                price_with_vat: patch.priceWithVat,
              }
            : {}),
          // product_discount = % sleva BEZ časového okna (LIVE OVĚŘENO: zapíše se).
          ...(patch.productDiscountPercent !== undefined
            ? { product_discount: patch.productDiscountPercent }
            : {}),
        },
      ],
    }));
  }

  if (patch.visibility !== undefined) {
    out.active_yn = patch.visibility === 'visible';
  }

  // EAN a hmotnost jsou top-level pole na produktu (PUT/POST /api/v2/products).
  if (patch.ean !== undefined) {
    out.ean = patch.ean;
  }
  if (patch.weight !== undefined) {
    // LIVE OVĚŘENO (dev eshop 2026-06-11): `weight` je INTEGER v hmotnostní
    // jednotce eshopu (typicky gramy). Desetinné číslo i string API TIŠE ZAHODÍ
    // (updated_yn:true, weight zůstane null = silent no-op). Proto zaokrouhlujeme
    // na integer — hodnota se tím reálně zapíše místo nenápadného zmizení.
    out.weight = Math.round(patch.weight);
  }
  // Skladová zásoba — top-level `stock` (stejný zápis používá updateStock,
  // LIVE OVĚŘENO). Bez tohohle by patch.stock byl tichý no-op (tester feedback).
  if (patch.stock !== undefined) {
    out.stock = patch.stock;
  }

  // Kategorizace (Upgates `categories[]`). Párování přes code (preferováno) / id.
  if (patch.categories !== undefined) {
    out.categories = patch.categories.map((c) => ({
      ...(c.id !== undefined ? { category_id: c.id } : {}),
      ...(c.code !== undefined ? { code: c.code } : {}),
      ...(c.main !== undefined ? { main_yn: c.main } : {}),
      ...(c.position !== undefined ? { position: c.position } : {}),
    }));
  }

  // Parametry (Upgates `parameters[]` — inline descriptions/values v primárním
  // jazyce). LIVE-VERIFY: zda parametr smí vzniknout inline, nebo musí existovat.
  if (patch.parameters !== undefined) {
    out.parameters = patch.parameters.map((p) => ({
      descriptions: [{ language: primaryLang, name: p.name }],
      values: [{ descriptions: [{ language: primaryLang, value: p.value }] }],
    }));
  }

  // Dořešená číselníková ID / obrázky — přidat jen když jsou definované.
  if (resolved?.availabilityId !== undefined) {
    out.availability_id = resolved.availabilityId;
  }
  if (resolved?.manufacturerId !== undefined) {
    out.manufacturer_id = resolved.manufacturerId;
  }
  if (resolved?.images !== undefined) {
    out.images = resolved.images;
  }

  return out;
}

/** Společný zápis produktů (PUT update / POST create) přes `{products:[...]}`. */
async function writeProducts(
  shop: Shop,
  items: Array<Record<string, unknown>>,
  method: 'PUT' | 'POST',
  label: string
): Promise<void> {
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method,
    url: PRODUCTS_PATH,
    data: { products: items },
  });
  if (res.status >= 400) {
    throw new Error(`${label} failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as { products?: UpgatesWriteResultRow[] } | undefined;
  const err = writeErrors(body?.products);
  if (err) throw new Error(`${label} rejected: ${err}`);
}

async function putProducts(
  shop: Shop,
  items: Array<Record<string, unknown>>
): Promise<void> {
  return writeProducts(shop, items, 'PUT', 'updateProduct');
}

// --- Číselníky pro dořešení lidských názvů na ID ----------------------------

/** Reálné API: /api/v2/availabilities → {availabilities:[{id, descriptions:[{name}]}]}. */
type UpgatesAvailabilityRaw = {
  id?: number | string;
  descriptions?: Array<{ language?: string; name?: string }>;
};

/**
 * Dořeší lidský název dostupnosti (`availabilityLabel`) na `availability_id`
 * přes GET /api/v2/availabilities. Shoda na `descriptions[].name` (case-insensitive
 * trim). Když nenalezeno → srozumitelná chyba.
 */
async function resolveAvailabilityId(
  client: ReturnType<typeof createUpgatesApiClient>,
  label: string
): Promise<number> {
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: AVAILABILITIES_PATH,
  });
  if (res.status >= 400) {
    throw new Error(`updateProduct failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as
    | { availabilities?: UpgatesAvailabilityRaw[] }
    | undefined;
  const list = body?.availabilities ?? [];
  const wanted = label.trim().toLowerCase();
  const match = list.find((a) =>
    (a.descriptions ?? []).some(
      (d) => (d.name ?? '').trim().toLowerCase() === wanted
    )
  );
  if (match?.id == null) {
    // Výčet platných labelů přímo v chybě (stejný pattern jako resolveStatusId)
    // — klient se nemusí doptávat dalším nástrojem.
    const available = list
      .flatMap((a) => (a.descriptions ?? []).map((d) => d.name))
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `availability label "${label}" not found in the shop configuration (available: ${available || 'none'})`
    );
  }
  return Number(match.id);
}

/**
 * Dořeší název výrobce (`manufacturer`) na `manufacturer_id` přes GET
 * /api/v2/manufacturers. Shoda na `name` (case-insensitive trim). Pozor: pole
 * ID je `manufacturer_id` (NE `id`). Když nenalezeno → srozumitelná chyba.
 */
async function resolveManufacturerId(
  client: ReturnType<typeof createUpgatesApiClient>,
  manufacturer: string
): Promise<number> {
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: MANUFACTURERS_PATH,
  });
  if (res.status >= 400) {
    throw new Error(`updateProduct failed: ${extractUpgatesError(res)}`);
  }
  const list = extractManufacturers(res.data);
  const wanted = manufacturer.trim().toLowerCase();
  const match = list.find(
    (m) => (m.name ?? '').trim().toLowerCase() === wanted
  );
  if (match?.manufacturer_id == null) {
    throw new Error(
      `manufacturer "${manufacturer}" not found in the shop catalog — use list_manufacturers to get valid values`
    );
  }
  return Number(match.manufacturer_id);
}

/**
 * Sestaví PLNÉ pole `images` pro PUT z aktuálních obrázků produktu (`raw.images`)
 * + nově přidávaných URL. NIKDY nemaže existující obrázky — zachovává jejich
 * `file_id`, `position`, `main_yn`, `list_yn`. Nové obrázky jdou jen jako `{url}`.
 *
 * Když je zadané `mainImageUrl`, nastaví `main_yn=true` na obrázku se shodnou URL
 * (mezi existujícími i nově přidávanými) a `main_yn=false` všem ostatním. Když se
 * `mainImageUrl` nenajde, hodí srozumitelnou chybu (jinak by se hlavní obrázek
 * tiše neaplikoval). LEKCE z API: obrázek bez `main_yn=true` se na frontu nezobrazí.
 */
function buildMergedImages(
  raw: UpgatesProductRaw,
  addImageUrls: string[] | undefined,
  mainImageUrl: string | undefined
): Array<Record<string, unknown>> {
  // Základ = existující obrázky (zachovat všechna identifikační pole).
  const existing: Array<Record<string, unknown>> = (raw.images ?? []).map(
    (img) => ({
      ...(img.file_id !== undefined ? { file_id: img.file_id } : {}),
      ...(img.position !== undefined ? { position: img.position } : {}),
      ...(img.main_yn !== undefined ? { main_yn: img.main_yn } : {}),
      ...(img.list_yn !== undefined ? { list_yn: img.list_yn } : {}),
      ...(img.url !== undefined ? { url: img.url } : {}),
    })
  );

  // Nové obrázky — pouze jako {url}, file_id přidělí Upgates při importu.
  const added: Array<Record<string, unknown>> = (addImageUrls ?? []).map(
    (url) => ({ url })
  );

  const merged = [...existing, ...added];

  if (mainImageUrl !== undefined) {
    let found = false;
    for (const img of merged) {
      if (img.url === mainImageUrl) {
        img.main_yn = true;
        found = true;
      } else {
        img.main_yn = false;
      }
    }
    if (!found) {
      throw new Error(
        'updateProduct: mainImageUrl not found among the product images'
      );
    }
  }

  return merged;
}

export async function updateProduct(
  shop: Shop,
  args: { guid: string; patch: ProductPatch }
): Promise<ProductDetailResponse> {
  if (!args.guid) throw new Error('updateProduct: missing product guid');
  if (!args.patch || Object.keys(args.patch).length === 0) {
    throw new Error('updateProduct: empty patch');
  }
  // GET nejdřív: jazykové mutace a měnové bloky se musí zrcadlit z reálného
  // stavu produktu, jinak je cenový update tichý no-op (chybějící currency).
  const client = createUpgatesApiClient(shop);
  const current = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: `${PRODUCTS_PATH}/${encodeURIComponent(args.guid)}`,
  });
  if (current.status >= 400) {
    throw new Error(`updateProduct failed: ${extractUpgatesError(current)}`);
  }
  const body = current.data as
    | { product?: UpgatesProductRaw; products?: UpgatesProductRaw[] }
    | undefined;
  const raw = body?.product ?? body?.products?.[0];
  if (!raw) throw new Error(`updateProduct: product ${args.guid} not found`);

  // Dořešení polí, která vyžadují extra GETy (číselníky) nebo merge obrázků.
  // Vše defenzivně: extra requesty se posílají jen když je odpovídající pole zadané.
  let availabilityId: number | undefined;
  if (args.patch.availabilityLabel !== undefined) {
    availabilityId = await resolveAvailabilityId(
      client,
      args.patch.availabilityLabel
    );
  }

  let manufacturerId: number | undefined;
  if (args.patch.manufacturer !== undefined) {
    manufacturerId = await resolveManufacturerId(client, args.patch.manufacturer);
  }

  let images: Array<Record<string, unknown>> | undefined;
  if (
    args.patch.addImageUrls !== undefined ||
    args.patch.mainImageUrl !== undefined
  ) {
    images = buildMergedImages(
      raw,
      args.patch.addImageUrls,
      args.patch.mainImageUrl
    );
  }

  await putProducts(shop, [
    buildProductBody(raw, args.guid, args.patch, {
      availabilityId,
      manufacturerId,
      images,
    }),
  ]);
  return getProduct(shop, args.guid);
}

/** Default jazyk + měna eshopu z `/api/v2/languages` (pro create produktu i kategorie). */
export async function resolveDefaultLangCurrency(
  client: ReturnType<typeof createUpgatesApiClient>
): Promise<{ language: string; currency: string }> {
  const langRes = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: '/api/v2/languages',
  });
  const langs =
    (langRes.data as { languages?: UpgatesLanguageRaw[] } | undefined)
      ?.languages ?? [];
  const def =
    langs.find((l) => l.default_yn === true) ?? langs.find(() => true);
  return {
    language: def?.language_id ?? 'cs',
    currency: def?.currency_id ?? 'CZK',
  };
}

/**
 * Založí produkt přes `POST /api/v2/products`. `code` je unikátní párovací klíč.
 * Nový produkt nemá GET stav → syntetický `raw` s default jazykem/měnou eshopu,
 * aby cenové/jazykové bloky vznikly správně (jinak je cenový zápis tichý no-op).
 * Číselníky (availability/manufacturer) a obrázky se dořeší stejně jako u update.
 *
 * KATEGORIE JSOU POVINNÉ (LIVE OVĚŘENO dev eshop 2026-06-13): produkt bez
 * kategorie vznikne s `categories: []` a je v eshopu NEVIDITELNÝ (nezobrazí se
 * v žádném výpisu) — pro provozovatele je to nepoužitelný stav ("no go"). Navíc
 * Upgates POST/PUT NEZNÁMÝ kód kategorie TIŠE ZAHODÍ (200, produkt bez kategorie,
 * žádná chyba). Proto: (1) vyžadujeme aspoň jednu kategorii PŘED zápisem,
 * (2) po zápisu read-back ověří, že kategorie reálně přistála — když ne (neplatný
 * kód), osiřelý produkt smažeme a vyhodíme srozumitelnou chybu (atomická sémantika:
 * buď produkt vznikne S kategorií, nebo nevznikne vůbec).
 */
export async function createProduct(
  shop: Shop,
  args: { product: ProductCreate }
): Promise<ProductCreateResponse> {
  const p = args.product;
  if (!p.code) throw new Error('createProduct: missing product code');
  if (!p.name) throw new Error('createProduct: missing product name');

  const patch: ProductPatch = { name: p.name, ...(p.patch ?? {}) };
  const requestedCategories = patch.categories ?? [];
  if (requestedCategories.length === 0) {
    throw new Error(
      'createProduct: at least one category is required on this platform — a product without a category is hidden in the storefront. Pass patch.categories (e.g. [{ code: "K00036", main: true }]); use list_categories to pick a valid code.'
    );
  }

  const client = createUpgatesApiClient(shop);
  const { language, currency } = await resolveDefaultLangCurrency(client);

  const syntheticRaw: UpgatesProductRaw = {
    descriptions: [{ language }],
    prices: [{ currency, language }],
    images: [],
  };

  let availabilityId: number | undefined;
  if (patch.availabilityLabel !== undefined) {
    availabilityId = await resolveAvailabilityId(client, patch.availabilityLabel);
  }
  let manufacturerId: number | undefined;
  if (patch.manufacturer !== undefined) {
    manufacturerId = await resolveManufacturerId(client, patch.manufacturer);
  }
  let images: Array<Record<string, unknown>> | undefined;
  if (patch.addImageUrls !== undefined || patch.mainImageUrl !== undefined) {
    images = buildMergedImages(syntheticRaw, patch.addImageUrls, patch.mainImageUrl);
  }

  const body = buildProductBody(syntheticRaw, p.code, patch, {
    availabilityId,
    manufacturerId,
    images,
  });
  if (p.stock !== undefined) body.stock = p.stock;

  await writeProducts(shop, [body], 'POST', 'createProduct');
  const detail = (await getProduct(shop, p.code)).data;

  // Read-back guard: neznámý/zastaralý kód kategorie Upgates tiše zahodí →
  // produkt by zůstal bez kategorie (neviditelný). Smaž osiřelý produkt a vrať
  // jasnou chybu místo falešného úspěchu (revert create by jinak mazal něco,
  // o čem klient neví, že je rozbité).
  if ((detail.categories?.length ?? 0) === 0) {
    await deleteProduct(shop, { code: p.code }).catch(() => {});
    throw new Error(
      `createProduct: the platform rejected the requested category (unknown/stale code in ${JSON.stringify(
        requestedCategories
      )}) — the product was NOT created. Use list_categories for valid codes, then retry.`
    );
  }

  return { data: detail };
}

/**
 * Smaže produkt přes `DELETE /api/v2/products?code=`. Používá se hlavně jako
 * revert `create_product`. Response tvar je LIVE-VERIFY → 2xx = úspěch.
 */
export async function deleteProduct(
  shop: Shop,
  args: { code: string }
): Promise<{ data: { code: string; deleted: boolean } }> {
  if (!args.code) throw new Error('deleteProduct: missing product code');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'DELETE',
    url: PRODUCTS_PATH,
    // LIVE OVĚŘENO: products DELETE bere `codes` (plurál), NE `code`
    // (API: "Unknown parameter, did you mean 'codes'?"). Kategorie naopak `code`.
    params: { codes: args.code },
  });
  if (res.status >= 400) {
    throw new Error(`deleteProduct failed: ${extractUpgatesError(res)}`);
  }
  // Response: {products:[{code, deleted_yn, messages}]}.
  const row = (
    res.data as
      | {
          products?: Array<{
            deleted_yn?: boolean;
            messages?: Array<{ message?: string }>;
          }>;
        }
      | undefined
  )?.products?.[0];
  if (row && row.deleted_yn === false) {
    const msg = (row.messages ?? [])
      .map((m) => m.message ?? '')
      .filter(Boolean)
      .join('; ');
    throw new Error(`deleteProduct rejected: ${msg || 'unknown'}`);
  }
  return { data: { code: args.code, deleted: row?.deleted_yn !== false } };
}

export async function updateStock(
  shop: Shop,
  args: { guid: string; stockId: string; quantity: number }
): Promise<StockUpdateResponse> {
  if (!args.guid) throw new Error('updateStock: missing product guid');
  if (!Number.isFinite(args.quantity)) {
    throw new Error('updateStock: invalid quantity');
  }
  // Upgates API v2 vede sklad jako top-level `stock` na produktu; per-sklad
  // rozpad (`stockId`) API nepodporuje → stockId se ignoruje (default sklad).
  await putProducts(shop, [{ code: args.guid, stock: args.quantity }]);
  return {
    data: { guid: args.guid, stockId: args.stockId || 'default', quantity: args.quantity },
  };
}

export async function bulkUpdateProducts(
  shop: Shop,
  items: BulkProductItem[]
): Promise<BulkProductResult[]> {
  const results: BulkProductResult[] = [];
  for (const item of items) {
    try {
      const res = await updateProduct(shop, item);
      results.push({ guid: item.guid, status: 'ok', data: res.data });
    } catch (e) {
      results.push({
        guid: item.guid,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/** Neutrální typ slevy → Upgates `type` v POST /vouchers. */
function voucherApiType(
  t: VoucherCreateInput['discountType']
): 'percentage' | 'price' | 'payment_shipment' {
  if (t === 'percent') return 'percentage';
  if (t === 'amount') return 'price';
  return 'payment_shipment';
}

export async function createVoucher(
  shop: Shop,
  input: VoucherCreateInput
): Promise<VoucherResponse> {
  const isShipping = input.discountType === 'free_shipping_payment';
  if (!isShipping) {
    if (!Number.isFinite(input.discountValue ?? NaN) || (input.discountValue ?? 0) <= 0) {
      throw new Error('createVoucher: invalid discountValue');
    }
    if (input.discountType === 'percent' && (input.discountValue ?? 0) > 100) {
      throw new Error('createVoucher: percent discountValue must be <= 100');
    }
  }
  const client = createUpgatesApiClient(shop);

  // Měna je povinná — preferuj zadanou, jinak měna defaultního jazyka eshopu.
  let currency = input.currency;
  if (!currency) {
    const langRes = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: '/api/v2/languages',
    });
    const langs =
      (langRes.data as { languages?: UpgatesLanguageRaw[] } | undefined)
        ?.languages ?? [];
    const def =
      langs.find((l) => l.default_yn === true) ?? langs.find(() => true);
    currency = def?.currency_id ?? 'CZK';
  }

  const res = await upgatesRequest<unknown>(client, {
    method: 'POST',
    url: VOUCHERS_PATH,
    // POZOR: na rozdíl od orders/products je body PLOCHÝ objekt.
    data: {
      ...(input.code ? { code: input.code } : {}),
      type: voucherApiType(input.discountType),
      currency_id: currency,
      amount: isShipping ? (input.discountValue ?? 0) : input.discountValue,
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.active !== undefined ? { active_yn: input.active } : {}),
      ...(input.reusable !== undefined ? { global_yn: input.reusable } : {}),
      ...(input.appliesToActionProducts !== undefined
        ? { for_products_in_action_yn: input.appliesToActionProducts }
        : {}),
      ...(input.minOrderValue !== undefined ? { used_from: input.minOrderValue } : {}),
      ...(input.validFrom ? { date_from: input.validFrom } : {}),
      ...(input.validUntil ? { date_to: input.validUntil } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
  });
  if (res.status >= 400) {
    throw new Error(`createVoucher failed: ${extractUpgatesError(res)}`);
  }
  // Response: {vouchers: ["KÓD1","KÓD2",...]} — Upgates kódy VŽDY GENERUJE.
  // LIVE OVĚŘENO (dev eshop 2026-06-10): endpoint tiše ignoruje neznámé parametry
  // (`code`, `voucher_code`, `prefix` i bogus pole) → explicitní kód NELZE zadat.
  const body = res.data as { vouchers?: unknown } | undefined;
  const codes = Array.isArray(body?.vouchers)
    ? (body.vouchers as unknown[]).filter(
        (c): c is string => typeof c === 'string' && c.length > 0
      )
    : [];
  // Fallback: když API kódy nevrátí, ale klient zadal vlastní code.
  const finalCodes = codes.length > 0 ? codes : input.code ? [input.code] : [];
  // LIVE ZJIŠTĚNO (tester 2026-06-09): Upgates požadovaný `code` ignoruje a
  // generuje vlastní — bez explicitní note by klient mazal/komunikoval špatný kód.
  const codeIgnored =
    input.code !== undefined &&
    codes.length > 0 &&
    !codes.includes(input.code);
  return {
    data: {
      codes: finalCodes,
      code: finalCodes[0],
      ...(codeIgnored
        ? {
            note: `The platform ignored the requested code "${input.code}" and generated its own (${codes.join(', ')}) — use the returned codes (e.g. for delete_voucher or when telling customers).`,
          }
        : {}),
      discountType: input.discountType,
      ...(input.discountValue !== undefined
        ? { discountValue: input.discountValue }
        : {}),
      currency,
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    },
  };
}

/**
 * Smaže kupón(y) přes `DELETE /api/v2/vouchers?voucher_codes=a;b`. Jádro revertu
 * `create_voucher` (čte kódy z `result.codes`). Response `{vouchers:[{code,
 * deleted_yn, messages}]}`.
 */
export async function deleteVoucher(
  shop: Shop,
  args: { codes: string[] }
): Promise<VoucherDeleteResponse> {
  const codes = (args.codes ?? []).filter(
    (c) => typeof c === 'string' && c.length > 0
  );
  if (codes.length === 0) throw new Error('deleteVoucher: missing voucher codes');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'DELETE',
    url: VOUCHERS_PATH,
    params: { voucher_codes: codes.join(';') },
  });
  if (res.status >= 400) {
    throw new Error(`deleteVoucher failed: ${extractUpgatesError(res)}`);
  }
  const rows =
    (
      res.data as
        | {
            vouchers?: Array<{
              code?: string;
              deleted_yn?: boolean;
              messages?: Array<{ message?: string }>;
            }>;
          }
        | undefined
    )?.vouchers ?? [];
  const results =
    rows.length > 0
      ? rows.map((r) => ({
          code: r.code ?? '',
          deleted: r.deleted_yn === true,
          ...(r.messages && r.messages.length > 0
            ? {
                message: r.messages
                  .map((m) => m.message ?? '')
                  .filter(Boolean)
                  .join('; '),
              }
            : {}),
        }))
      : codes.map((code) => ({ code, deleted: true }));
  return { data: { results } };
}

/** Výpis kupónů přes `GET /api/v2/vouchers` (paginace). Read-only. */
export async function listVouchers(
  shop: Shop,
  opts?: { active?: boolean; page?: number; limit?: number }
): Promise<VoucherListResponse> {
  const client = createUpgatesApiClient(shop);
  const params: Record<string, unknown> = {};
  // Filtr aktivních — formát `active_yn` je LIVE-VERIFY (yes/no vs Y/N).
  if (opts?.active !== undefined) params.active_yn = opts.active ? 'yes' : 'no';
  const raw = await paginateAll<UpgatesVoucherRaw>(
    client,
    VOUCHERS_PATH,
    params,
    (body) =>
      (body as { vouchers?: UpgatesVoucherRaw[] } | undefined)?.vouchers ?? [],
    'listVouchers',
    opts?.limit
  );
  const items = (opts?.limit ? raw.slice(0, opts.limit) : raw).map(
    mapVoucherSummary
  );
  return { data: items };
}

// --- Ceníky (pricelists) ----------------------------------------------------

/** Výpis ceníků přes `GET /api/v2/pricelists`. */
export async function listPricelists(
  shop: Shop
): Promise<PricelistListResponse> {
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesPricelistDefRaw>(
    client,
    PRICELISTS_PATH,
    {},
    (body) =>
      (body as { pricelists?: UpgatesPricelistDefRaw[] } | undefined)
        ?.pricelists ?? [],
    'listPricelists'
  );
  return { data: raw.map(mapPricelist) };
}

/** Vytvoří ceník přes `POST /api/v2/pricelists` body `{pricelists:[{name, percent}]}`. */
export async function createPricelist(
  shop: Shop,
  args: { name: string; percent?: number }
): Promise<PricelistMutationResponse> {
  if (!args.name?.trim()) throw new Error('createPricelist: missing name');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'POST',
    url: PRICELISTS_PATH,
    data: {
      pricelists: [
        {
          name: args.name,
          ...(args.percent !== undefined ? { percent: args.percent } : {}),
        },
      ],
    },
  });
  if (res.status >= 400) {
    throw new Error(`createPricelist failed: ${extractUpgatesError(res)}`);
  }
  const row = (
    res.data as
      | {
          pricelists?: Array<{
            customer_pricelist_id?: number | string;
            name?: string;
            created_yn?: boolean;
            messages?: Array<{ message?: string }>;
          }>;
        }
      | undefined
  )?.pricelists?.[0];
  if (row && row.created_yn === false) {
    const msg = (row.messages ?? [])
      .map((m) => m.message ?? '')
      .filter(Boolean)
      .join('; ');
    throw new Error(`createPricelist rejected: ${msg || 'unknown'}`);
  }
  return {
    data: {
      name: args.name,
      id:
        row?.customer_pricelist_id !== undefined
          ? Number(row.customer_pricelist_id)
          : undefined,
      created: row?.created_yn !== false,
    },
  };
}

/** Smaže ceník přes `DELETE /api/v2/pricelists/{id}` (default ceník nelze). */
export async function deletePricelist(
  shop: Shop,
  args: { id: number }
): Promise<PricelistMutationResponse> {
  if (!Number.isFinite(args.id)) throw new Error('deletePricelist: invalid id');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'DELETE',
    url: `${PRICELISTS_PATH}/${args.id}`,
  });
  if (res.status >= 400) {
    throw new Error(`deletePricelist failed: ${extractUpgatesError(res)}`);
  }
  const row = (
    res.data as
      | {
          pricelists?: Array<{
            id?: number | string;
            deleted?: boolean;
            messages?: Array<{ message?: string }>;
          }>;
        }
      | undefined
  )?.pricelists?.[0];
  if (row && row.deleted === false) {
    const msg = (row.messages ?? [])
      .map((m) => m.message ?? '')
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `deletePricelist rejected (the default pricelist cannot be deleted?): ${msg || 'unknown'}`
    );
  }
  return { data: { id: args.id, deleted: row?.deleted !== false } };
}

/**
 * Zapíše poznámku k zákazníkovi přes `PUT /api/v2/customers`. DOKUMENTOVANÉ pole
 * je `note` (NE `customer_note` — to je jen ve vnořeném customer bloku OBJEDNÁVKY).
 * Identifikátor zákazníka = `code` (= `Customer.guid`). Response řádek nese `email`.
 *
 * Capability `createCustomerNote` zůstává `false` do LIVE ověření (dev eshop má
 * 0 zákazníků → read-back/append-vs-replace nejde otestovat bez testovacího zákazníka).
 */
export async function createCustomerNote(
  shop: Shop,
  args: { guid: string; note: string }
): Promise<CustomerNoteResponse> {
  if (!args.guid) throw new Error('createCustomerNote: missing customer code');
  if (!args.note) throw new Error('createCustomerNote: missing note');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'PUT',
    url: CUSTOMERS_PATH,
    data: { customers: [{ code: args.guid, note: args.note }] },
  });
  if (res.status >= 400) {
    throw new Error(`createCustomerNote failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as { customers?: UpgatesWriteResultRow[] } | undefined;
  const err = writeErrors(body?.customers);
  if (err) throw new Error(`createCustomerNote rejected: ${err}`);
  return { data: { guid: args.guid, note: args.note } };
}

export async function setActionPrice(): Promise<ActionPriceResponse> {
  // Capability `setActionPrice: false`. ZJIŠTĚNO proti reálnému API: pricelist
  // nese `price_sale`/`product_discount`/`product_discount_real` + top-level
  // `action_currently_yn`, ale ŽÁDNÁ pole platnosti od/do — API v2 tedy akci
  // s termíny (validFrom/validTo dle kontraktu) neumí vyjádřit. Otázka na
  // konzultaci: jak nastavit akční cenu s časovým oknem (jiný endpoint?).
  throw new Error(
    'setActionPrice is not supported on Upgates yet (API v2 nemá pole platnosti akce od/do)'
  );
}
