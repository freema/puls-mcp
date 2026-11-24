// Neutrální e-commerce doménové tvary — kontrakt, který `PlatformConnector`
// vrací. Nejsou Shoptet-specifické: Shoptet je dnes splňuje strukturálně
// (`code`/`guid`/`totalPrice` jsou rozumně generické), Upgates connector na ně
// namapuje svoje API. Tvary musí zůstat shodné s tím, co tool vrstva čeká —
// `pnpm typecheck` chytí jakýkoli drift v implementaci connectoru.

/** Platform discriminator — re-export JEDINÉHO zdroje pravdy z `@puls/db`. */
export type { PlatformId } from '@puls/db/schema';

// --- Orders -----------------------------------------------------------------

export interface Order {
  code: string;
  status: string;
  totalPrice?: string | number;
}
export interface OrderListResponse {
  data: Order[];
}
export interface OrderItem {
  name: string;
  amount?: number;
  unitPrice?: string | number;
}
export interface OrderDetail extends Order {
  creationTime?: string;
  currency?: string;
  /** Zaplaceno — Upgates `paid_date` (null = nezaplaceno). Shoptet ho nevyplňuje. */
  paid?: boolean;
  /** Číslo faktury, pokud byla vystavena (Upgates `invoice_number`). */
  invoiceNumber?: string;
  /** Variabilní symbol platby (Upgates `variable_symbol`). */
  variableSymbol?: string;
  /** Sledovací kód zásilky, pokud byla odeslána (Upgates `tracking_code`). */
  trackingCode?: string;
  /** URL pro sledování zásilky (Upgates `tracking_url`). */
  trackingUrl?: string;
  // Read enrichment — Upgates nese tato pole na detailu objednávky (vše optional).
  /** Interní poznámka k objednávce (Upgates `internal_note`). */
  internalNote?: string;
  /** Číslo případu / reklamace (Upgates `case_number`). */
  caseNumber?: string;
  /** URL detailu objednávky v administraci (Upgates `admin_url`). */
  adminUrl?: string;
  /** Vyřízeno (Upgates `resolved_yn`). */
  resolved?: boolean;
  /** Název dopravy (Upgates `shipment.name`). */
  shipmentName?: string;
  /** Název platby (Upgates `payment.name`). */
  paymentName?: string;
  /** Přílohy objednávky (faktury/doklady) — Upgates `attachments[]`. */
  attachments?: Array<{ name?: string; url?: string }>;
  customer?: {
    email?: string;
    name?: string;
    // B2B pole — volitelná. Shoptet je nevyplňuje, Upgates ano (nativní IČO/DIČ).
    company?: string;
    /** IČO. */
    companyId?: string;
    /** DIČ. */
    vatId?: string;
  };
  items?: OrderItem[];
}
export interface OrderDetailResponse {
  data: OrderDetail;
}
export interface OrderChange {
  code: string;
  changeType: string;
  changedAt: string;
}
export interface OrderChangesResponse {
  data: { cursor?: string; changes: OrderChange[] };
}

// --- Products ---------------------------------------------------------------

/** Varianta produktu — u Upgates plnohodnotný produkt s vlastní cenou/skladem. */
export interface ProductVariant {
  /** CODE varianty (primární čitelný identifikátor). */
  code: string;
  ean?: string;
  /** Cena varianty s DPH. */
  priceWithVat?: number;
  /** Skladová zásoba varianty. */
  stock?: number;
}
export interface Product {
  guid: string;
  name: string;
  code?: string;
  price?: string | number;
  currency?: string;
  visible?: boolean;
  // Volitelná pole — Upgates je vyplňuje, Shoptet ne.
  ean?: string;
  stock?: number;
  /** Bohatší cenová struktura — Upgates. */
  priceWithoutVat?: number;
  priceOriginal?: number;
  priceSale?: number;
  /** Sazby DPH (pole) — Upgates. */
  vatRates?: number[];
  /** Název dostupnosti (číselník) — Upgates `AVAILABILITY`. */
  availabilityLabel?: string;
  /** Název výrobce — Upgates `manufacturer`. Shoptet nevyplňuje. */
  manufacturer?: string;
}
export interface ProductListResponse {
  data: Product[];
}
/** Obrázek produktu (Upgates `images[]`) — read projekce pro audit/verify. */
export interface ProductImage {
  url?: string;
  /** Hlavní obrázek (Upgates `main_yn`). */
  main?: boolean;
  position?: number;
}
export interface ProductDetail extends Product {
  /** Dlouhý popis (Upgates `descriptions[].long_description`). */
  description?: string;
  /** Krátký popis (Upgates `descriptions[].short_description`). */
  shortDescription?: string;
  /** Hmotnost (Upgates top-level `weight`). Read-back pro verify weightu. */
  weight?: number;
  categories?: string[];
  /** Obrázky produktu (Upgates `images[]`) — read-back pro verify obrázků. */
  images?: ProductImage[];
  /** Parametry produktu (Upgates subresource `/products/{code}/parameters`). */
  parameters?: ProductParameterValue[];
  /** Varianty — každá je plnohodnotný produkt s vlastní cenou/skladem (Upgates). */
  variants?: ProductVariant[];
}
export interface ProductDetailResponse {
  data: ProductDetail;
}

// --- Customers --------------------------------------------------------------

export interface Customer {
  guid: string;
  email: string;
  name?: string;
}
export interface CustomerListResponse {
  data: Customer[];
}
export interface CustomerDetail extends Customer {
  phone?: string;
  ordersCount?: number;
  // B2B pole — volitelná (Upgates nativně, Shoptet ne).
  company?: string;
  /** IČO. */
  companyId?: string;
  /** DIČ. */
  vatId?: string;
  /** Interní poznámka k zákazníkovi (Upgates `note`) — read-back pro audit. */
  note?: string;
}
export interface CustomerDetailResponse {
  data: CustomerDetail;
}

// --- Catalog ----------------------------------------------------------------

export interface Stock {
  id: string;
  name: string;
  default?: boolean;
  /** Název dostupnosti (číselník `availabilities`) — Upgates. */
  availabilityLabel?: string;
}
export interface StockListResponse {
  data: Stock[];
}
export interface Manufacturer {
  id: string;
  name: string;
}
export interface ManufacturerListResponse {
  data: Manufacturer[];
}
export interface Category {
  guid: string;
  name: string;
  parentGuid?: string | null;
  visible?: boolean;
  /** Čitelný kód kategorie (Upgates `code`) — párovací klíč pro write. */
  code?: string;
  /** Pořadí v rámci rodiče (Upgates `position`). */
  position?: number;
  /** Zobrazit v menu (Upgates `show_in_menu_yn`). */
  showInMenu?: boolean;
}
export interface CategoryListResponse {
  data: Category[];
}
export interface EshopMeta {
  id: number;
  name: string;
  url: string;
  currency?: string;
  language?: string;
  vatPayer?: boolean;
}
export interface EshopMetaResponse {
  data: EshopMeta;
}

// --- Write akce (response shapes) -------------------------------------------

export interface CustomerNoteResponse {
  data: { guid: string; note: string; createdAt?: string };
}
/** Reference na kategorii ve write těle produktu (Upgates `categories[]`). */
export interface ProductCategoryRef {
  /** Kategorie přes code (preferováno) NEBO numerické id. */
  code?: string;
  id?: number;
  /** Hlavní kategorie produktu (Upgates `main_yn`). */
  main?: boolean;
  position?: number;
}
/** Hodnota parametru produktu (Upgates `parameters[]`). */
export interface ProductParameterValue {
  /** Název parametru (např. "Barva"). */
  name: string;
  /** Hodnota (např. "Černá"). */
  value: string;
}
export interface ProductPatch {
  name?: string;
  description?: string;
  priceWithVat?: number;
  visibility?: 'visible' | 'hidden';
  /** EAN / čárový kód produktu. */
  ean?: string;
  /** Hmotnost produktu (kg nebo výchozí jednotka e-shopu). */
  weight?: number;
  /** Skladová zásoba (absolutní počet kusů). Upgates: top-level `stock` na
   *  produktu. Shoptet patch neumí → connector vyhodí srozumitelnou chybu
   *  s odkazem na update_stock (žádný tichý no-op). */
  stock?: number;
  /** Lidský název dostupnosti (např. 'Skladem', 'In stock'). Connector ho řeší na availability_id. */
  availabilityLabel?: string;
  /** Název výrobce (např. 'Sony'). Connector ho řeší na manufacturer_id. */
  manufacturer?: string;
  /** URL obrázků k PŘIDÁNÍ — existující obrázky se zachovají. */
  addImageUrls?: string[];
  /** URL obrázku, který se má nastavit jako hlavní (main_yn=true), ostatním main_yn=false. */
  mainImageUrl?: string;
  /** Přiřazení produktu do kategorií (Upgates `categories[]`). */
  categories?: ProductCategoryRef[];
  /** Parametry produktu (Upgates `parameters[]`). */
  parameters?: ProductParameterValue[];
  /** Cílový ceník pro priceWithVat (default 'Default'). */
  pricelistName?: string;
  /** Procentní sleva produktu (Upgates `product_discount`). 0 = bez slevy, BEZ časového okna. */
  productDiscountPercent?: number;
}
/** Kontrakt pro založení produktu (POST). `code` = unikátní párovací klíč. */
export interface ProductCreate {
  code: string;
  name: string;
  /** Zbytek polí přes ProductPatch (description/price/visibility/ean/weight/
   *  availability/manufacturer/images/categories/parameters). */
  patch?: ProductPatch;
  stock?: number;
}
export interface ProductCreateResponse {
  data: ProductDetail;
}
export interface ActionPriceResponse {
  data: { guid: string; price: number; validFrom?: string; validTo?: string };
}
export type VoucherDiscountType = 'percent' | 'amount' | 'free_shipping_payment';
/** Vstup pro založení kupónu (rich — Upgates POST /vouchers). */
export interface VoucherCreateInput {
  /** Volitelný — když chybí, platforma kód(y) vygeneruje a vrátí. */
  code?: string;
  discountType: VoucherDiscountType;
  /** U free_shipping_payment se neposílá (nebo 0). */
  discountValue?: number;
  /** Počet kupónů (Upgates `count`, default 1). */
  count?: number;
  /** ISO 4217; default dořeší connector z jazyka eshopu. */
  currency?: string;
  /** Opakované použití (Upgates `global_yn`). */
  reusable?: boolean;
  /** Aktivní (Upgates `active_yn`, default true). */
  active?: boolean;
  /** Použitelný pro produkty v akci (Upgates `for_products_in_action_yn`). */
  appliesToActionProducts?: boolean;
  /** Minimální hodnota objednávky (Upgates `used_from`). */
  minOrderValue?: number;
  /** Platnost od (Upgates `date_from`). */
  validFrom?: string;
  /** Platnost do (Upgates `date_to`). */
  validUntil?: string;
  note?: string;
}
export interface VoucherResponse {
  data: {
    /** Vygenerované kódy z response `vouchers[]` (zdroj pravdy pro revert). */
    codes: string[];
    /** Back-compat: codes[0] (web dashboard čte after.code). */
    code?: string;
    discountType: VoucherDiscountType;
    discountValue?: number;
    currency?: string;
    count?: number;
    validFrom?: string;
    validUntil?: string;
    /** Upozornění pro klienta — např. že platforma ignorovala požadovaný kód
     *  a vygenerovala vlastní (Upgates). */
    note?: string;
  };
}
/** Položka výpisu kupónů (read). */
export interface VoucherSummary {
  code: string;
  active?: boolean;
  reusable?: boolean;
  discountType?: VoucherDiscountType;
  discountValue?: number;
  currency?: string;
  validFrom?: string;
  validUntil?: string;
  minOrderValue?: number;
  note?: string;
  createdAt?: string;
}
export interface VoucherListResponse {
  data: VoucherSummary[];
}
export interface VoucherDeleteResponse {
  data: {
    results: Array<{ code: string; deleted: boolean; message?: string }>;
  };
}

// --- Kategorie (write) ------------------------------------------------------

export interface CategoryDescriptionPatch {
  /** Default = jazyk eshopu. */
  language?: string;
  /** descriptions[].name */
  name?: string;
  /** name_h1 */
  nameH1?: string;
  /** short_description_text */
  shortDescription?: string;
  /** description_text */
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoUrl?: string;
}
export interface CategoryCreate {
  code: string;
  /** Shorthand → descriptions[].name (default lang). */
  name: string;
  /** parent_code (preferováno pro tree). */
  parentCode?: string;
  /** = parent_id. */
  parentGuid?: string;
  position?: number;
  /** active_yn (default true). */
  active?: boolean;
  /** show_in_menu_yn. */
  showInMenu?: boolean;
  descriptions?: CategoryDescriptionPatch[];
  /** images[].url (async stažení). */
  imageUrls?: string[];
}
export interface CategoryPatch {
  name?: string;
  parentCode?: string;
  parentGuid?: string;
  position?: number;
  active?: boolean;
  showInMenu?: boolean;
  descriptions?: CategoryDescriptionPatch[];
  imageUrls?: string[];
}
export interface CategoryWriteResponse {
  data: { guid: string; code: string; name?: string; parentGuid?: string | null };
}

// --- Ceny / ceníky (write) --------------------------------------------------

export interface Pricelist {
  id: number;
  name: string;
  percent?: number;
  isDefault?: boolean;
}
export interface PricelistListResponse {
  data: Pricelist[];
}
export interface PricelistMutationResponse {
  data: { name?: string; id?: number; created?: boolean; deleted?: boolean };
}
export type BulkPriceOp =
  | { mode: 'set'; value: number }
  | { mode: 'adjustPercent'; value: number }
  | { mode: 'adjustAmount'; value: number };
export interface BulkPriceResultItem {
  guid: string;
  status: 'ok' | 'error';
  before?: number;
  after?: number;
  error?: string;
}
export interface BulkPriceResponse {
  data: BulkPriceResultItem[];
}
export interface StockUpdateResponse {
  data: { guid: string; stockId: string; quantity: number };
}
export interface BulkProductItem {
  guid: string;
  patch: ProductPatch;
}
export type BulkProductResult =
  | { guid: string; status: 'ok'; data: ProductDetail }
  | { guid: string; status: 'error'; error: string };
