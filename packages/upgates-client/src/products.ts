import type {
  Shop,
  ProductListResponse,
  ProductDetailResponse,
} from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';
import { paginateAll } from './pagination.js';
import { mapProduct, mapProductDetail, mapParameter } from './mappers.js';
import type { UpgatesParameterRaw, UpgatesProductRaw } from './types.js';

const PRODUCTS_PATH = '/api/v2/products';

/**
 * Parametry produktu žijí na subresource `/products/{code}/parameters` (NEjsou
 * inline na detailu). Best-effort: chyba/empty → prázdné pole (get_product se
 * kvůli parametrům nikdy nerozbije, jen je nevrátí). Read-back pro verify parametrů.
 */
async function fetchProductParameters(
  shop: Shop,
  code: string
): Promise<ReturnType<typeof mapParameter>[]> {
  try {
    const client = createUpgatesApiClient(shop);
    const res = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: `${PRODUCTS_PATH}/${encodeURIComponent(code)}/parameters`,
    });
    if (res.status >= 400) return [];
    const body = res.data as
      | {
          products?: Array<{ parameters?: UpgatesParameterRaw[] }>;
          parameters?: UpgatesParameterRaw[];
        }
      | undefined;
    const list = body?.products?.[0]?.parameters ?? body?.parameters ?? [];
    return list.map((p) => mapParameter(p)).filter((p) => p.name.length > 0);
  } catch {
    return [];
  }
}

function extractProducts(body: unknown): UpgatesProductRaw[] {
  const b = body as { products?: UpgatesProductRaw[] } | undefined;
  return b?.products ?? [];
}

export async function listProducts(
  shop: Shop,
  opts?: { limit?: number; page?: number }
): Promise<ProductListResponse> {
  const client = createUpgatesApiClient(shop);
  let raw: UpgatesProductRaw[];
  if (opts?.page != null) {
    const res = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: PRODUCTS_PATH,
      params: { page: opts.page },
    });
    if (res.status >= 400) {
      throw new Error(`listProducts failed: ${extractUpgatesError(res)}`);
    }
    raw = extractProducts(res.data);
  } else {
    raw = await paginateAll<UpgatesProductRaw>(
      client,
      PRODUCTS_PATH,
      {},
      extractProducts,
      'listProducts',
      opts?.limit
    );
  }
  const limited = opts?.limit != null ? raw.slice(0, opts.limit) : raw;
  return { data: limited.map((p) => mapProduct(p)) };
}

export async function getProduct(
  shop: Shop,
  guid: string
): Promise<ProductDetailResponse> {
  if (!guid) throw new Error('getProduct: missing product code');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: `${PRODUCTS_PATH}/${encodeURIComponent(guid)}`,
  });
  if (res.status >= 400) {
    throw new Error(`getProduct failed: ${extractUpgatesError(res)}`);
  }
  if (res.data == null || res.data === '') {
    throw new Error(`getProduct: empty response for product ${guid}`);
  }
  // Reálné API vrací i pro detail stránkovanou obálku `{products: [...]}`
  // (GET /products/{code} = filtrovaný list); mock vrací `{product: {...}}`.
  const body = res.data as
    | { product?: UpgatesProductRaw; products?: UpgatesProductRaw[] }
    | undefined;
  // POZOR: neexistující code = 200 + `{products: []}` (filtrovaný list). Dřív
  // se obálka propadla fallbackem na "raw produkt" a namapovala na prázdný
  // objekt — klient nepoznal, že produkt neexistuje (tester feedback). Bare
  // fallback nech jen pro tělo BEZ obálky (legacy/mock tvar).
  const hasEnvelope =
    body != null && ('product' in body || 'products' in body);
  const rawProduct = hasEnvelope
    ? (body.product ?? body.products?.[0])
    : (res.data as UpgatesProductRaw);
  if (!rawProduct) {
    throw new Error(`getProduct: product "${guid}" not found`);
  }
  const detail = mapProductDetail(rawProduct);
  // Parametry jsou na samostatném subresource → extra (best-effort) GET.
  const parameters = await fetchProductParameters(shop, rawProduct.code ?? guid);
  return {
    data: parameters.length > 0 ? { ...detail, parameters } : detail,
  };
}
