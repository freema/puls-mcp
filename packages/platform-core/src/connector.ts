import type { PlatformId } from '@puls/db/schema';
import type { Shop, PulsDb } from './shop.js';
import type { PlatformCapabilities } from './capabilities.js';
import type {
  OrderListResponse,
  OrderDetailResponse,
  OrderChangesResponse,
  ProductListResponse,
  ProductDetailResponse,
  CustomerListResponse,
  CustomerDetailResponse,
  StockListResponse,
  ManufacturerListResponse,
  CategoryListResponse,
  EshopMetaResponse,
  CustomerNoteResponse,
  ProductPatch,
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
  CategoryCreate,
  CategoryPatch,
  CategoryWriteResponse,
  PricelistListResponse,
  PricelistMutationResponse,
  BulkPriceOp,
  BulkPriceResponse,
} from './domain.js';

/**
 * Write operace platformy. Volitelné — když `capabilities.categories.write` je
 * false, connector je nemusí poskytovat. Signatury kopírují reálné helpery.
 */
export interface PlatformWrites {
  updateOrderStatus(
    shop: Shop,
    db: PulsDb,
    args: { code: string; status: string; comment?: string }
  ): Promise<OrderDetailResponse>;
  createCustomerNote(
    shop: Shop,
    db: PulsDb,
    args: { guid: string; note: string }
  ): Promise<CustomerNoteResponse>;
  updateProduct(
    shop: Shop,
    db: PulsDb,
    args: { guid: string; patch: ProductPatch }
  ): Promise<ProductDetailResponse>;
  setActionPrice(
    shop: Shop,
    db: PulsDb,
    args: { guid: string; price: number; validFrom?: string; validTo?: string }
  ): Promise<ActionPriceResponse>;
  createVoucher(
    shop: Shop,
    db: PulsDb,
    input: VoucherCreateInput
  ): Promise<VoucherResponse>;
  updateStock(
    shop: Shop,
    db: PulsDb,
    args: { guid: string; stockId: string; quantity: number }
  ): Promise<StockUpdateResponse>;
  bulkUpdateProducts(
    shop: Shop,
    db: PulsDb,
    items: BulkProductItem[]
  ): Promise<BulkProductResult[]>;

  // --- Rozšíření (volitelné per platforma — Shoptet je nemusí implementovat,
  //     optional `?` je hlavní anti-regrese mechanismus) ---
  /** Založení produktu (POST /products). */
  createProduct?(
    shop: Shop,
    db: PulsDb,
    args: { product: ProductCreate }
  ): Promise<ProductCreateResponse>;
  /** Smazání produktu — používá se hlavně pro revert create_product. */
  deleteProduct?(
    shop: Shop,
    db: PulsDb,
    args: { code: string }
  ): Promise<{ data: { code: string; deleted: boolean } }>;
  /** Založení kategorie. */
  createCategory?(
    shop: Shop,
    db: PulsDb,
    args: { category: CategoryCreate }
  ): Promise<CategoryWriteResponse>;
  /** Úprava kategorie. */
  updateCategory?(
    shop: Shop,
    db: PulsDb,
    args: { guid: string; patch: CategoryPatch }
  ): Promise<CategoryWriteResponse>;
  /** Smazání kategorie (maže i podstrom). */
  deleteCategory?(
    shop: Shop,
    db: PulsDb,
    args: { guid: string }
  ): Promise<{ data: { guid: string; deleted: true } }>;
  /** Hromadné nastavení/úprava cen. */
  bulkSetPrices?(
    shop: Shop,
    db: PulsDb,
    args: { guids: string[]; op: BulkPriceOp; pricelistName?: string }
  ): Promise<BulkPriceResponse>;
  /** Výpis ceníků. */
  listPricelists?(shop: Shop, db: PulsDb): Promise<PricelistListResponse>;
  /** Vytvoření ceníku. */
  createPricelist?(
    shop: Shop,
    db: PulsDb,
    args: { name: string; percent?: number }
  ): Promise<PricelistMutationResponse>;
  /** Smazání ceníku (default ceník nelze). */
  deletePricelist?(
    shop: Shop,
    db: PulsDb,
    args: { id: number }
  ): Promise<PricelistMutationResponse>;
  /** Smazání kupónu(ů) — jádro revertu create_voucher (DELETE /vouchers). */
  deleteVoucher?(
    shop: Shop,
    db: PulsDb,
    args: { codes: string[] }
  ): Promise<VoucherDeleteResponse>;
}

/** Vstup install handshake. Shoptet: OAuth code + OAuth endpoint config. */
export interface PlatformInstallInput {
  code: string;
  oauth: {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  apiBaseUrl: string;
}

/**
 * Normalizovaný webhook po parse — neutrální tvar napříč platformami pro
 * lookup shopu a persist. `webhook.parse` z connectoru vrací tohle místo
 * platformně-specifického tvaru.
 */
export type NormalizedWebhook =
  | { ok: false; error: 'invalid_json' | 'invalid_shape'; issues?: unknown }
  | {
      ok: true;
      value: {
        /** Identita účtu na platformě → lookup shopu přes (platform, external_id). */
        externalId: string;
        event: string;
        /** Idempotency klíč v rámci eventu (Shoptet: eventInstance). */
        eventInstance: string;
        /** Syrový JSON dokument se všemi vendor poli (nezahozenými Zodem). */
        payload: Record<string, unknown>;
      };
    };

/** Normalizovaný shop po install handshake — neutrální tvar pro upsert do DB. */
export interface NormalizedShop {
  platform: PlatformId;
  /** Shoptet: String(project.id); Upgates: token z aktivačního payloadu. */
  externalId: string;
  domain: string;
  adminEmail: string | null;
  name: string | null;
  /** Shoptet: OAuth install token. Upgates: placeholder (Basic auth nemá token). */
  oauthAccessToken: string;
  /** Shoptet: HMAC-SHA1 klíč. Upgates: per-shop webhook secret. */
  webhookSignatureKey: string;
  apiBaseUrl: string;
  /**
   * Upgates Basic-auth credentials (`apiUser`/`apiKey` z aktivace). Null pro
   * Shoptet. `persistInstall` zašifruje `apiKey` přes `encryptSecret` před
   * zápisem do DB (login je uživatelské jméno, ukládá se jako plaintext).
   */
  apiLogin?: string | null;
  apiKey?: string | null;
}

/**
 * Jediný vstupní bod pro platformně-specifickou logiku čtení/zápisu/webhooku.
 * Tool vrstva (`apps/mcp-server/src/tools/*`) konzumuje connector, nikdy ne
 * přímo `@puls/shoptet-client`. `@puls/shoptet-client` je první implementace.
 *
 * Návratové typy jsou věrné dnešním tvarům (faithful facade) — refaktor je
 * behavior-preserving; žádný kanonický remap, který by změnil výstup nástrojů.
 */
export interface PlatformConnector {
  readonly platform: PlatformId;
  /** Deklarace schopností → podmíněná registrace nástrojů. */
  readonly capabilities: PlatformCapabilities;

  /**
   * Volitelný per-platform dovětek k description nástroje. Jména nástrojů jsou
   * platformně neutrální (`list_orders`, …), ale popisek může potřebovat
   * platformně specifickou poznámku (Shoptet: GUID/code; Upgates: CODE/EAN).
   * Default (neimplementováno) → base beze změny (Shoptet chování).
   */
  describeTool?(name: string, base: string): string;

  /** Install handshake → normalizovaný shop k upsertu. */
  install(input: PlatformInstallInput): Promise<NormalizedShop>;

  orders: {
    list(
      shop: Shop,
      db: PulsDb,
      opts?: { status?: string; limit?: number }
    ): Promise<OrderListResponse>;
    get(shop: Shop, db: PulsDb, code: string): Promise<OrderDetailResponse>;
    changes(
      shop: Shop,
      db: PulsDb,
      opts?: { from?: string; limit?: number }
    ): Promise<OrderChangesResponse>;
  };
  products: {
    list(
      shop: Shop,
      db: PulsDb,
      opts?: { limit?: number; page?: number }
    ): Promise<ProductListResponse>;
    get(shop: Shop, db: PulsDb, guid: string): Promise<ProductDetailResponse>;
  };
  customers: {
    list(
      shop: Shop,
      db: PulsDb,
      opts?: { limit?: number }
    ): Promise<CustomerListResponse>;
    get(shop: Shop, db: PulsDb, guid: string): Promise<CustomerDetailResponse>;
  };
  catalog: {
    stocks(shop: Shop, db: PulsDb): Promise<StockListResponse>;
    categories(shop: Shop, db: PulsDb): Promise<CategoryListResponse>;
    eshopInfo(shop: Shop, db: PulsDb): Promise<EshopMetaResponse>;
    /**
     * Číselník výrobců — volitelné per platforma (pro nástroj
     * `list_manufacturers`, který si klient ověří platné hodnoty před
     * create/update produktu). Platforma bez podpory nástroj neregistruje.
     */
    manufacturers?(shop: Shop, db: PulsDb): Promise<ManufacturerListResponse>;
  };

  /** Read kupónů — volitelné per platforma (pro nástroj list_vouchers). */
  vouchers?: {
    list(
      shop: Shop,
      db: PulsDb,
      opts?: { active?: boolean; page?: number; limit?: number }
    ): Promise<VoucherListResponse>;
  };

  /** Write akce — volitelné per platforma (viz capabilities). */
  writes?: PlatformWrites;

  /** Webhook ověření podpisu (Shoptet: HMAC-SHA1) + parse na neutrální tvar. */
  webhook: {
    verify(rawBody: Buffer, key: string, signature: string): boolean;
    /** Parse syrového UTF-8 body na neutrální `NormalizedWebhook`. */
    parse(rawUtf8: string): NormalizedWebhook;
  };
}
