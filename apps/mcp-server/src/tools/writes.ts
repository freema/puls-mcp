import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  PlatformConnector,
  ProductPatch,
  ProductPatchField,
  ProductCreate,
  VoucherCreateInput,
  CategoryCreate,
  CategoryPatch,
  PulsDb,
  Shop,
} from '@puls/platform-core';
import { isRateLimitError, PRODUCT_PATCH_FIELDS } from '@puls/platform-core';
import { writeLog } from '@puls/db/schema';
import { toolError, toolOk, withRequestLogging, withWrite } from './usage.js';
import { registerRevertTool } from './revert.js';

/**
 * Mutující nástroje — gated za "write" consent kategorií. Každý nástroj:
 *   1) Musí být volán s confirm:"yes" (Zod literal + runtime guard) jako
 *      pojistka proti náhodnému zápisu.
 *   2) Zapisuje OKAMŽITĚ (synchronně) — žádná schvalovací fronta. Před zápisem
 *      načte BEFORE stav, po zápisu spočítá AFTER a vše zaloguje do `write_log`
 *      (audit log se statusem applied|reverted|failed). Revert přes nástroj
 *      `revert_write` obnoví BEFORE stav.
 *
 * Tier gating (trial tier write nástroje vůbec neregistruje, anti-freeride) běží
 * na JEDNOM místě — v `createShopMcpServer` (puls-mcp.ts) přes `trialBlocksWrites`
 * v době registrace. Sem se `registerWriteTools` zavolá jen pro placené tiery.
 */
export function registerWriteTools(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  // Platforma bez write capability nezaregistruje žádné write nástroje.
  if (!connector.writes) return;
  // Tier gating (anti-freeride) je vyřešen volajícím (puls-mcp.ts) — tady už
  // víme, že shop je na placeném tieru.
  // Granulární gating: každý write nástroj se registruje jen když ho platforma
  // deklaruje v `capabilities.writes`. Platforma s plnou write sadou má všechny
  // `true` (žádná regrese); platforma, která umí jen část write akcí,
  // gracefully degraduje per-nástroj.
  const w = connector.capabilities.writes;
  if (w.updateOrderStatus) registerOrderStatusTool(server, shop, connector, db);
  if (w.createCustomerNote) registerCustomerNoteTool(server, shop, connector, db);
  if (w.updateProduct) registerUpdateProductTool(server, shop, connector, db);
  if (w.createProduct) registerCreateProductTool(server, shop, connector, db);
  if (w.createCategory) registerCreateCategoryTool(server, shop, connector, db);
  if (w.updateCategory) registerUpdateCategoryTool(server, shop, connector, db);
  if (w.deleteCategory) registerDeleteCategoryTool(server, shop, connector, db);
  if (w.setActionPrice) registerActionPriceTool(server, shop, connector, db);
  if (w.createVoucher) registerVoucherTool(server, shop, connector, db);
  if (w.deleteVoucher) registerDeleteVoucherTool(server, shop, connector, db);
  if (w.updateStock) registerStockTool(server, shop, connector, db);
  if (w.bulkUpdateProducts)
    registerBulkUpdateProductsTool(server, shop, connector, db);
  if (w.bulkSetPrices) registerBulkSetPricesTool(server, shop, connector, db);
  if (w.setProductDiscount)
    registerSetProductDiscountTool(server, shop, connector, db);
  if (w.managePricelists) {
    registerListPricelistsTool(server, shop, connector, db);
    registerCreatePricelistTool(server, shop, connector, db);
    registerDeletePricelistTool(server, shop, connector, db);
  }

  // revert_write není v capabilities.writes mapě — registruje se bezpodmínečně
  // v rámci registerWriteTools, jakmile platforma umí writes a shop není trial.
  registerRevertTool(server, shop, connector, db);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Výsledek logovaného okamžitého zápisu vracený nástrojem. */
type WriteOk = {
  ok: true;
  applied: 'immediate';
  write_log_id: string;
  result?: unknown;
};

function confirmField() {
  return z
    .literal('yes')
    .describe('Must be exactly "yes" — guards against accidental writes.');
}

/**
 * Dovětek do popisu KAŽDÉHO write nástroje — klienti se po výpadku spojení
 * bojí opakovat zápis (tester to vědomě odmítl udělat). Dedup okno viz
 * IDEMPOTENCY_WINDOW_MS (idempotency.ts).
 */
const RETRY_NOTE =
  ' Retry-safe: repeating the identical call within 5 minutes returns the original result instead of writing twice.';

/**
 * Zaloguje provedený (nebo selhaný) zápis do `write_log` a vrátí id řádku.
 * Status `applied` = happy path, `failed` = API chyba (before/after dle volání).
 */
async function logWrite(
  db: PulsDb,
  entry: {
    shopId: string;
    tool: string;
    args: Record<string, unknown>;
    before: unknown;
    after: unknown;
    result: unknown;
    status: 'applied' | 'failed';
    error?: string;
  }
): Promise<string> {
  const [row] = await db
    .insert(writeLog)
    .values({
      shopId: entry.shopId,
      tool: entry.tool,
      args: entry.args,
      before: entry.before,
      after: entry.after,
      result: entry.result,
      status: entry.status,
      error: entry.error ?? null,
    })
    .returning({ id: writeLog.id });
  if (!row) throw new Error('Failed to insert write_log row');
  return row.id;
}

/** Bezpečné načtení produktu (BEFORE stav) — chyba GET nikdy neshodí zápis. */
async function safeGetProduct(
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb,
  guid: string
): Promise<Record<string, unknown> | null> {
  try {
    const r = await connector.products.get(shop, db, guid);
    return (r.data as unknown as Record<string, unknown>) ?? null;
  } catch (err) {
    if (isRateLimitError(err)) throw err; // rate-limit nepolykat → fail-fast ven
    return null;
  }
}

/** Bezpečné načtení objednávky (BEFORE stav) — chyba GET nikdy neshodí zápis. */
async function safeGetOrder(
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb,
  code: string
): Promise<Record<string, unknown> | null> {
  try {
    const r = await connector.orders.get(shop, db, code);
    return (r.data as unknown as Record<string, unknown>) ?? null;
  } catch (err) {
    if (isRateLimitError(err)) throw err; // rate-limit nepolykat → fail-fast ven
    return null;
  }
}

/** Bezpečné načtení zákazníka (BEFORE stav) — chyba GET nikdy neshodí zápis. */
async function safeGetCustomer(
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb,
  guid: string
): Promise<Record<string, unknown> | null> {
  try {
    const r = await connector.customers.get(shop, db, guid);
    return (r.data as unknown as Record<string, unknown>) ?? null;
  } catch (err) {
    if (isRateLimitError(err)) throw err; // rate-limit nepolykat → fail-fast ven
    return null;
  }
}

/**
 * Bezpečné načtení kategorie (BEFORE stav). Upgates nemá single-GET na kategorii
 * → filtr přes seznam `catalog.categories` podle guid/code. Chyba nikdy neshodí zápis.
 */
async function safeGetCategory(
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb,
  guid: string
): Promise<Record<string, unknown> | null> {
  try {
    const r = await connector.catalog.categories(shop, db);
    const found = r.data.find((c) => c.guid === guid || c.code === guid);
    return found ? (found as unknown as Record<string, unknown>) : null;
  } catch (err) {
    if (isRateLimitError(err)) throw err; // rate-limit nepolykat → fail-fast ven
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bounded-concurrency map pro bulk zápisy
// ---------------------------------------------------------------------------

/**
 * Kolik položek bulku zpracovávat najednou. Reálným stropem pro Upgates je
 * sdílený HTTP concurrency gate (≤3) v upgates-clientu — tohle jen omezuje
 * fan-out na úrovni položek (a tím i počet souběžných DB zápisů). Sekvenční
 * zpracování bylo příčinou, proč velký bulk přetekl timeout proxy.
 */
const BULK_CONCURRENCY = 6;

/**
 * Zpracuje `items` přes worker-pool o velikosti `concurrency`, zachová pořadí
 * výsledků (index = index položky). `fn` MÁ chytat per-item chyby a vracet
 * error-výsledek; když `fn` VYHODÍ (signál „zastav celý bulk", typicky
 * rate-limit), pool přestane brát nové položky a chyba se po doběhnutí
 * rozdělaných položek propaguje ven (stejná sémantika jako dřív sekvenční
 * `throw` ze smyčky).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  // Pole místo `let` proměnné: closure mutace se snáz typuje (žádné narrowing
  // na null) a drží první „zastav celý bulk" chybu.
  const abortError: unknown[] = [];

  const worker = async (): Promise<void> => {
    while (true) {
      if (abortError.length > 0) return;
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (abortError.length === 0) abortError.push(err);
        return;
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (abortError.length > 0) throw abortError[0];
  return results;
}

// ---------------------------------------------------------------------------
// Rozšířený patch schema pro produkty (update_product + bulk_update_products)
// ---------------------------------------------------------------------------

const productCategoryRefSchema = z
  .object({
    code: z.string().min(1).max(100).optional(),
    id: z.number().int().positive().optional(),
    main: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine((c) => c.code !== undefined || c.id !== undefined, {
    message: 'category ref needs code or id',
  });

const productParameterSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().min(1).max(500),
});

// Master shape — JEDEN zdroj pravdy pro všechna pole ProductPatch. Per-platform
// schéma z něj vybírá podmnožinu (viz buildProductPatchSchema). `satisfies`
// hlídá, že tu nechybí žádné pole z PRODUCT_PATCH_FIELDS (compile-time úplnost).
const PRODUCT_PATCH_SHAPE = {
  name: z.string().min(1).max(200),
  description: z.string().max(20_000),
  priceWithVat: z.number().nonnegative(),
  visibility: z.enum(['visible', 'hidden']),
  ean: z.string().min(1).max(20),
  weight: z.number().positive(),
  stock: z
    .number()
    .nonnegative()
    .describe('Absolute stock quantity (replaces the current value).'),
  availabilityLabel: z.string().min(1).max(100),
  manufacturer: z.string().min(1).max(200),
  addImageUrls: z.string().url().array(),
  mainImageUrl: z.string().url(),
  categories: productCategoryRefSchema.array().max(50),
  parameters: productParameterSchema.array().max(50),
  pricelistName: z.string().min(1).max(100),
  productDiscountPercent: z.number().min(0).max(100),
} satisfies Record<ProductPatchField, z.ZodTypeAny>;

/**
 * Per-platform Zod schéma patche — obsahuje JEN pole, která platforma umí zapsat
 * (`capabilities.productPatchFields`). Tím model nedostane argumenty, které by
 * platforma stejně odmítla (Shoptet: jen name/description/price/visibility).
 * `.strict()` = neznámé pole = hlasitá chyba (jinak Zod tiše stripne a klient si
 * myslí, že se zapsalo — tester: patch.stock se "ignoroval", přesně tahle past).
 */
export function buildProductPatchSchema(fields: readonly ProductPatchField[]) {
  const shape: z.ZodRawShape = {};
  for (const f of fields) shape[f] = PRODUCT_PATCH_SHAPE[f].optional();
  return z
    .object(shape)
    .strict()
    .refine((p) => Object.keys(p).length > 0, {
      message: 'patch must contain at least one field',
    });
}

/** Pole patche podporovaná platformou (fallback = plný superset = staré chování). */
function patchFieldsFor(
  connector: PlatformConnector
): readonly ProductPatchField[] {
  return connector.capabilities.productPatchFields ?? PRODUCT_PATCH_FIELDS;
}

/** Dovětek do popisu: výčet editovatelných polí na DANÉ platformě. */
function editableFieldsNote(fields: readonly ProductPatchField[]): string {
  return ` Editable fields on this store: ${fields.join(', ')}.`;
}

// Plný superset — kontrakt pro testy (product-patch-schema.test.ts) + default.
export const productPatchSchema = buildProductPatchSchema(PRODUCT_PATCH_FIELDS);

// ---------------------------------------------------------------------------
// Tool: update_order_status (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerOrderStatusTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'update_order_status',
    'WRITE — change the status of an existing order. Applied immediately and logged to the write history (revertable via revert_write). Common statuses: "new", "processing", "paid", "shipped", "completed", "cancelled".' +
      RETRY_NOTE,
    {
      code: z.string().min(1).describe('Order code to update.'),
      status: z.string().min(1).describe('New status value.'),
      comment: z
        .string()
        .max(500)
        .optional()
        .describe('Optional internal note attached to the change.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'update_order_status',
        args,
        {
          code: args.code,
          status: args.status,
          comment: args.comment ?? null,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          const callArgs = {
            code: args.code,
            status: args.status,
            ...(args.comment ? { comment: args.comment } : {}),
          };
          const before = await safeGetOrder(shop, connector, db, args.code);

          try {
            const data = await connector.writes!.updateOrderStatus(
              shop,
              db,
              callArgs
            );
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'update_order_status',
              args: callArgs,
              before,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'updateOrderStatus failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'update_order_status',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: create_customer_note (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerCustomerNoteTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'create_customer_note',
    'WRITE — append an internal note to a customer record. Applied immediately and logged to the write history. Note: customer notes cannot be reverted.' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Customer identifier.'),
      note: z
        .string()
        .min(1)
        .max(2000)
        .describe('Note text (visible in the platform admin).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'create_customer_note',
        args,
        {
          guid: args.guid,
          note_preview:
            args.note.length > 200
              ? `${args.note.slice(0, 200)}…`
              : args.note,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          const callArgs = { guid: args.guid, note: args.note };
          const before = await safeGetCustomer(shop, connector, db, args.guid);

          try {
            const data = await connector.writes!.createCustomerNote(
              shop,
              db,
              callArgs
            );
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'create_customer_note',
              args: callArgs,
              before,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'createCustomerNote failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'create_customer_note',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: update_product (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerUpdateProductTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  const fields = patchFieldsFor(connector);
  server.tool(
    'update_product',
    'WRITE — update product fields. Applied immediately and logged to the write history (revertable via revert_write). Unknown patch fields are rejected (never silently ignored).' +
      editableFieldsNote(fields) +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Product identifier.'),
      patch: buildProductPatchSchema(fields).describe(
        'Partial update — pass only fields you want to change.'
      ),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'update_product',
        args,
        {
          guid: args.guid,
          patch: args.patch,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          const callArgs = { guid: args.guid, patch: args.patch as ProductPatch };
          const before = await safeGetProduct(shop, connector, db, args.guid);

          try {
            const data = await connector.writes!.updateProduct(
              shop,
              db,
              callArgs
            );
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'update_product',
              args: callArgs,
              before,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'updateProduct failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'update_product',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: create_product (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerCreateProductTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  const fields = patchFieldsFor(connector);
  server.tool(
    'create_product',
    'WRITE — create a new product (code + name required). Applied immediately and logged to the write history (revertable via revert_write — deletes the created product).' +
      editableFieldsNote(fields) +
      RETRY_NOTE,
    {
      code: z
        .string()
        .min(1)
        .max(100)
        .describe('Unique product code (pairing key, required).'),
      name: z.string().min(1).max(200).describe('Product name.'),
      patch: buildProductPatchSchema(fields)
        .optional()
        .describe('Optional additional fields (price, images, categories, ...).'),
      stock: z.number().nonnegative().optional().describe('Initial stock quantity.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'create_product',
        args,
        { code: args.code, name: args.name, patch: args.patch ?? null },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.createProduct) {
            return toolError('create_product not supported on this platform.');
          }

          const product: ProductCreate = {
            code: args.code,
            name: args.name,
            ...(args.patch ? { patch: args.patch as ProductPatch } : {}),
            ...(args.stock !== undefined ? { stock: args.stock } : {}),
          };
          const callArgs = { product };
          // BEFORE = null — produkt předtím neexistoval.

          try {
            const data = await connector.writes.createProduct(shop, db, callArgs);
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'create_product',
              args: callArgs,
              before: null,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'createProduct failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'create_product',
              args: callArgs,
              before: null,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: set_action_price (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerActionPriceTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'set_action_price',
    'WRITE — set a temporary action (sale) price on a product, optionally with validFrom/validTo. Applied immediately and logged to the write history (revertable via revert_write).' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Product identifier.'),
      price: z.number().nonnegative().describe('Action price (incl. VAT).'),
      validFrom: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 start (with timezone offset).'),
      validTo: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('ISO 8601 end (with timezone offset).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'set_action_price',
        args,
        {
          guid: args.guid,
          price: args.price,
          validFrom: args.validFrom ?? null,
          validTo: args.validTo ?? null,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          const callArgs = {
            guid: args.guid,
            price: args.price,
            ...(args.validFrom ? { validFrom: args.validFrom } : {}),
            ...(args.validTo ? { validTo: args.validTo } : {}),
          };
          const before = await safeGetProduct(shop, connector, db, args.guid);

          try {
            const data = await connector.writes!.setActionPrice(
              shop,
              db,
              callArgs
            );
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'set_action_price',
              args: callArgs,
              before,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'setActionPrice failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'set_action_price',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: create_voucher (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerVoucherTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'create_voucher',
    'WRITE — create a discount voucher: percent, absolute amount, or free shipping+payment. Optional code, count, currency, reusable flag, min order value, validFrom/validUntil. IMPORTANT: some platforms (e.g. Upgates) ignore the requested code and generate their own — ALWAYS use the `codes` returned in the result (a `note` flags this). Applied immediately and logged to the write history (revert deletes the voucher where supported).' +
      RETRY_NOTE,
    {
      code: z
        .string()
        .min(2)
        .max(64)
        .optional()
        .describe('Voucher code (visible at checkout). Omit to let the platform generate it.'),
      discountType: z
        .enum(['percent', 'amount', 'free_shipping_payment'])
        .describe('"percent" = % off, "amount" = absolute, "free_shipping_payment" = free shipping+payment.'),
      discountValue: z
        .number()
        .positive()
        .optional()
        .describe('Discount amount (required for percent/amount; percent 0–100). Omit for free_shipping_payment.'),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many unique vouchers to generate (default 1). Cannot combine with an explicit code.'),
      currency: z
        .string()
        .length(3)
        .optional()
        .describe('ISO 4217 currency (defaults to shop currency).'),
      reusable: z.boolean().optional().describe('Can be used repeatedly (global voucher).'),
      active: z.boolean().optional().describe('Active flag (default true).'),
      appliesToActionProducts: z
        .boolean()
        .optional()
        .describe('Usable on products already in a sale.'),
      minOrderValue: z
        .number()
        .nonnegative()
        .optional()
        .describe('Minimum order value to apply the voucher.'),
      validFrom: z
        .string()
        .optional()
        .describe('Valid-from date (YYYY-MM-DD).'),
      validUntil: z
        .string()
        .optional()
        .describe('Expiry date (YYYY-MM-DD).'),
      note: z.string().max(500).optional().describe('Internal note.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'create_voucher',
        args,
        {
          code: args.code ?? null,
          discountType: args.discountType,
          discountValue: args.discountValue ?? null,
          count: args.count ?? null,
          validFrom: args.validFrom ?? null,
          validUntil: args.validUntil ?? null,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (args.discountType !== 'free_shipping_payment') {
            if (args.discountValue === undefined || args.discountValue <= 0) {
              return toolError(
                'discountValue is required and must be > 0 for percent/amount vouchers.'
              );
            }
            if (args.discountType === 'percent' && args.discountValue > 100) {
              return toolError('Percent voucher discountValue must be <= 100.');
            }
          }
          if (args.code && (args.count ?? 1) > 1) {
            return toolError(
              'Cannot combine an explicit code with count > 1 (the platform generates codes).'
            );
          }

          const callArgs: VoucherCreateInput = {
            ...(args.code ? { code: args.code } : {}),
            discountType: args.discountType,
            ...(args.discountValue !== undefined
              ? { discountValue: args.discountValue }
              : {}),
            ...(args.count !== undefined ? { count: args.count } : {}),
            ...(args.currency ? { currency: args.currency } : {}),
            ...(args.reusable !== undefined ? { reusable: args.reusable } : {}),
            ...(args.active !== undefined ? { active: args.active } : {}),
            ...(args.appliesToActionProducts !== undefined
              ? { appliesToActionProducts: args.appliesToActionProducts }
              : {}),
            ...(args.minOrderValue !== undefined
              ? { minOrderValue: args.minOrderValue }
              : {}),
            ...(args.validFrom ? { validFrom: args.validFrom } : {}),
            ...(args.validUntil ? { validUntil: args.validUntil } : {}),
            ...(args.note ? { note: args.note } : {}),
          };
          // BEFORE = null — vytváříme nový záznam, který předtím neexistoval.

          try {
            const data = await connector.writes!.createVoucher(
              shop,
              db,
              callArgs
            );
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'create_voucher',
              args: callArgs as unknown as Record<string, unknown>,
              before: null,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'createVoucher failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'create_voucher',
              args: callArgs as unknown as Record<string, unknown>,
              before: null,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: delete_voucher (okamžitý zápis, NEreverzibilní)
// ---------------------------------------------------------------------------

function registerDeleteVoucherTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'delete_voucher',
    'WRITE — permanently delete one or more discount vouchers by code. Applied immediately and logged to the write history. NOTE: deleting a voucher cannot be reverted.' +
      RETRY_NOTE,
    {
      codes: z
        .string()
        .min(1)
        .max(64)
        .array()
        .min(1)
        .max(100)
        .describe('Voucher codes to delete.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'delete_voucher',
        args,
        { count: args.codes.length },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.deleteVoucher) {
            return toolError('delete_voucher not supported on this platform.');
          }

          const callArgs = { codes: args.codes };
          // BEFORE = snapshot z výpisu (audit smazaných kupónů), best-effort.
          let before: unknown = null;
          if (connector.vouchers?.list) {
            try {
              const list = await connector.vouchers.list(shop, db);
              before = list.data.filter((v) => args.codes.includes(v.code));
            } catch {
              before = null;
            }
          }

          try {
            const data = await connector.writes.deleteVoucher(shop, db, callArgs);
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_voucher',
              args: callArgs,
              before,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'deleteVoucher failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_voucher',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: update_stock (okamžitý zápis)
// ---------------------------------------------------------------------------

function registerStockTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'update_stock',
    'WRITE — set the stock quantity for a product. Applied immediately and logged to the write history (revertable via revert_write). On platforms with a single product-level stock (list_stocks shows one "default" location) the stockId can be omitted.' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Product identifier.'),
      stockId: z
        .string()
        .min(1)
        .default('default')
        .describe(
          'Stock location id (use list_stocks to discover). Defaults to "default" — correct for platforms with a single product-level stock.'
        ),
      quantity: z
        .number()
        .describe('Absolute quantity (replaces current value).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'update_stock',
        args,
        {
          guid: args.guid,
          stockId: args.stockId,
          quantity: args.quantity,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          const callArgs = {
            guid: args.guid,
            stockId: args.stockId,
            quantity: args.quantity,
          };
          // BEFORE produktu kvůli původnímu množství (product.stock) pro revert.
          const before = await safeGetProduct(shop, connector, db, args.guid);

          try {
            const data = await connector.writes!.updateStock(shop, db, callArgs);
            const after = data.data;
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'update_stock',
              args: callArgs,
              before,
              after,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'updateStock failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'update_stock',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: bulk_update_products (okamžitý zápis, per-item write_log)
// ---------------------------------------------------------------------------

function registerBulkUpdateProductsTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  const fields = patchFieldsFor(connector);
  const itemSchema = z.object({
    guid: z.string().min(1),
    patch: buildProductPatchSchema(fields),
  });

  server.tool(
    'bulk_update_products',
    'WRITE — apply patches to multiple products (max 50). Each product is applied immediately and logged as a separate write history entry (each revertable via revert_write).' +
      editableFieldsNote(fields) +
      RETRY_NOTE,
    {
      items: z
        .array(itemSchema)
        .min(1)
        .max(50)
        .describe('List of {guid, patch} updates (1–50 items).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'bulk_update_products',
        args,
        { count: args.items.length },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }

          type BulkUpdateResult =
            | { guid: string; status: 'ok'; write_log_id: string; data: unknown }
            | { guid: string; status: 'error'; write_log_id: string; error: string };

          // Položky běží paralelně (omezeno BULK_CONCURRENCY; Upgates HTTP gate
          // drží ≤3). Rate-limit z item fn probublá ven → celý bulk fail-fast.
          const results = await mapWithConcurrency<
            (typeof args.items)[number],
            BulkUpdateResult
          >(args.items, BULK_CONCURRENCY, async (item) => {
            const itemArgs = {
              guid: item.guid,
              patch: item.patch as ProductPatch,
            };
            const before = await safeGetProduct(shop, connector, db, item.guid);
            try {
              const data = await connector.writes!.updateProduct(
                shop,
                db,
                itemArgs
              );
              // Každý item = SAMOSTATNÝ write_log řádek tool:'update_product'.
              const id = await logWrite(db, {
                shopId: shop.id,
                tool: 'update_product',
                args: itemArgs,
                before,
                after: data.data,
                result: data.data,
                status: 'applied',
              });
              return {
                guid: item.guid,
                status: 'ok',
                write_log_id: id,
                data: data.data,
              };
            } catch (err) {
              // Rate-limit = zastav celý bulk a vrať jasnou hlášku (nepokračuj
              // v zápisu, jinak se další položky stejně fail-fastnou a matou).
              if (isRateLimitError(err)) throw err;
              const msg =
                err instanceof Error ? err.message : 'updateProduct failed';
              const id = await logWrite(db, {
                shopId: shop.id,
                tool: 'update_product',
                args: itemArgs,
                before,
                after: null,
                result: null,
                status: 'failed',
                error: msg,
              });
              return {
                guid: item.guid,
                status: 'error',
                write_log_id: id,
                error: msg,
              };
            }
          });

          return toolOk({ ok: true, applied: 'immediate', results });
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Helper: číselná hodnota z neznámého before pole
// ---------------------------------------------------------------------------

function numFrom(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool: bulk_set_prices (okamžitý zápis, per-item write_log jako update_product)
// ---------------------------------------------------------------------------

function registerBulkSetPricesTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'bulk_set_prices',
    'WRITE — set or adjust prices for multiple products at once: "set" (absolute), "adjustPercent" (±%), or "adjustAmount" (±absolute). Each product is applied immediately and logged separately (each revertable via revert_write).' +
      RETRY_NOTE,
    {
      guids: z
        .string()
        .min(1)
        .array()
        .min(1)
        .max(100)
        .describe('Product identifiers (1–100).'),
      op: z.object({
        mode: z
          .enum(['set', 'adjustPercent', 'adjustAmount'])
          .describe('"set" = absolute, "adjustPercent" = ±%, "adjustAmount" = ±absolute.'),
        value: z.number().describe('Value for the chosen mode (incl. VAT).'),
      }),
      pricelistName: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe('Target pricelist (default "Default").'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'bulk_set_prices',
        args,
        {
          count: args.guids.length,
          op: args.op,
          pricelistName: args.pricelistName ?? null,
        },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.updateProduct) {
            return toolError('bulk_set_prices not supported on this platform.');
          }

          type BulkPriceResult =
            | {
                guid: string;
                status: 'ok';
                write_log_id: string;
                before: number | null;
                after: number;
              }
            | { guid: string; status: 'error'; write_log_id?: string; error: string };

          // Položky běží paralelně (omezeno BULK_CONCURRENCY; Upgates HTTP gate
          // drží ≤3). Rate-limit z item fn probublá ven → celý bulk fail-fast.
          const results = await mapWithConcurrency<string, BulkPriceResult>(
            args.guids,
            BULK_CONCURRENCY,
            async (guid) => {
              const before = await safeGetProduct(shop, connector, db, guid);
              const beforePrice = before
                ? (numFrom(before.priceWithVat) ?? numFrom(before.price))
                : null;

              let target: number | null = null;
              if (args.op.mode === 'set') {
                target = args.op.value;
              } else if (beforePrice !== null) {
                target =
                  args.op.mode === 'adjustPercent'
                    ? beforePrice * (1 + args.op.value / 100)
                    : beforePrice + args.op.value;
              }
              if (target === null) {
                return {
                  guid,
                  status: 'error',
                  error:
                    "Cannot adjust price without the product's current price (product not found or price unavailable).",
                };
              }
              target = Math.round(target * 100) / 100;

              const patch: ProductPatch = {
                priceWithVat: target,
                ...(args.pricelistName
                  ? { pricelistName: args.pricelistName }
                  : {}),
              };
              const itemArgs = { guid, patch };
              try {
                const data = await connector.writes!.updateProduct(
                  shop,
                  db,
                  itemArgs
                );
                // Per-item write_log jako update_product → revert zadarmo.
                const id = await logWrite(db, {
                  shopId: shop.id,
                  tool: 'update_product',
                  args: itemArgs,
                  before,
                  after: data.data,
                  result: data.data,
                  status: 'applied',
                });
                return {
                  guid,
                  status: 'ok',
                  write_log_id: id,
                  before: beforePrice,
                  after: target,
                };
              } catch (err) {
                // Rate-limit = zastav celý bulk a vrať jasnou hlášku (nepokračuj
                // v zápisu, jinak se další položky stejně fail-fastnou a matou).
                if (isRateLimitError(err)) throw err;
                const msg =
                  err instanceof Error ? err.message : 'updateProduct failed';
                const id = await logWrite(db, {
                  shopId: shop.id,
                  tool: 'update_product',
                  args: itemArgs,
                  before,
                  after: null,
                  result: null,
                  status: 'failed',
                  error: msg,
                });
                return { guid, status: 'error', write_log_id: id, error: msg };
              }
            }
          );

          return toolOk({ ok: true, applied: 'immediate', results });
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tool: set_product_discount (okamžitý zápis) — % sleva BEZ časového okna
// ---------------------------------------------------------------------------

function registerSetProductDiscountTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'set_product_discount',
    'WRITE — set the product discount to an ABSOLUTE percentage (0–100): the value REPLACES any existing discount, it is not added on top (for "extra 20% on top of 15%" compute the combined percent yourself, e.g. 32). 0 removes the discount. NO time window (use a voucher for time-limited promos). Applied immediately and logged (revert removes the discount).' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Product identifier.'),
      percent: z
        .number()
        .min(0)
        .max(100)
        .describe('Discount percent (0 = remove discount).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'set_product_discount',
        args,
        { guid: args.guid, percent: args.percent },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.updateProduct) {
            return toolError('set_product_discount not supported on this platform.');
          }

          const callArgs = {
            guid: args.guid,
            patch: { productDiscountPercent: args.percent } as ProductPatch,
          };
          const before = await safeGetProduct(shop, connector, db, args.guid);
          try {
            const data = await connector.writes.updateProduct(shop, db, callArgs);
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'set_product_discount',
              args: callArgs,
              before,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'setProductDiscount failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'set_product_discount',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tools: ceníky (list / create / delete) — gated managePricelists
// ---------------------------------------------------------------------------

function registerListPricelistsTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'list_pricelists',
    'READ — list the shop pricelists (id, name, percent, default flag).',
    {},
    async () =>
      withRequestLogging(shop.id, 'list_pricelists', {}, async () => {
        if (!connector.writes?.listPricelists) {
          return toolError('list_pricelists not supported on this platform.');
        }
        const data = await connector.writes.listPricelists(shop, db);
        return toolOk({ pricelists: data.data });
      })
  );
}

function registerCreatePricelistTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'create_pricelist',
    'WRITE — create a new pricelist (name + optional percent). Applied immediately and logged (revert deletes the created pricelist).' +
      RETRY_NOTE,
    {
      name: z.string().min(1).max(100).describe('Pricelist name.'),
      percent: z
        .number()
        .optional()
        .describe('Optional percent applied by the pricelist.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'create_pricelist',
        args,
        { name: args.name, percent: args.percent ?? null },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.createPricelist) {
            return toolError('create_pricelist not supported on this platform.');
          }
          const callArgs = {
            name: args.name,
            ...(args.percent !== undefined ? { percent: args.percent } : {}),
          };
          try {
            const data = await connector.writes.createPricelist(
              shop,
              db,
              callArgs
            );
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'create_pricelist',
              args: callArgs,
              before: null,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'createPricelist failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'create_pricelist',
              args: callArgs,
              before: null,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

function registerDeletePricelistTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'delete_pricelist',
    'WRITE — delete a pricelist by id (the default pricelist cannot be deleted). Applied immediately and logged. Revert re-creates the pricelist (new id; customer assignments are lost).' +
      RETRY_NOTE,
    {
      id: z.number().int().positive().describe('Pricelist id (use list_pricelists).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'delete_pricelist',
        args,
        { id: args.id },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.deletePricelist) {
            return toolError('delete_pricelist not supported on this platform.');
          }
          // BEFORE = snapshot ceníku (pro re-kreaci při revertu), best-effort.
          let before: unknown = null;
          if (connector.writes.listPricelists) {
            try {
              const list = await connector.writes.listPricelists(shop, db);
              before = list.data.find((p) => p.id === args.id) ?? null;
            } catch {
              before = null;
            }
          }
          const callArgs = { id: args.id };
          try {
            const data = await connector.writes.deletePricelist(
              shop,
              db,
              callArgs
            );
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_pricelist',
              args: callArgs,
              before,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'deletePricelist failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_pricelist',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

// ---------------------------------------------------------------------------
// Tools: kategorie (create / update / delete) — gated per capability
// ---------------------------------------------------------------------------

const categoryDescriptionSchema = z.object({
  language: z.string().min(2).max(5).optional(),
  name: z.string().min(1).max(200).optional(),
  nameH1: z.string().max(200).optional(),
  shortDescription: z.string().max(2000).optional(),
  description: z.string().max(20_000).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  seoUrl: z.string().max(200).optional(),
});

const categoryPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    parentCode: z.string().min(1).max(100).optional(),
    parentGuid: z.string().min(1).max(100).optional(),
    position: z.number().int().nonnegative().optional(),
    active: z.boolean().optional(),
    showInMenu: z.boolean().optional(),
    descriptions: categoryDescriptionSchema.array().max(10).optional(),
    imageUrls: z.string().url().array().max(20).optional(),
  })
  // strict(): stejná ochrana jako u productPatchSchema — neznámé pole = chyba.
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: 'patch must contain at least one field',
  });

function registerCreateCategoryTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'create_category',
    'WRITE — create a catalog category (code + name, parent, optional position, visibility, descriptions, images). NOTE: some platforms (e.g. Upgates) REQUIRE a parent — pass parentCode of an existing category (use list_categories to pick one). For a tree, create parents before children. Applied immediately and logged (revert deletes the created category).' +
      RETRY_NOTE,
    {
      code: z.string().min(1).max(100).describe('Unique category code.'),
      name: z.string().min(1).max(200).describe('Category name (default language).'),
      parentCode: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe('Parent category code (for tree placement).'),
      parentGuid: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe('Parent category id (alternative to parentCode).'),
      position: z.number().int().nonnegative().optional(),
      active: z.boolean().optional().describe('Visible flag (default true).'),
      showInMenu: z.boolean().optional(),
      descriptions: categoryDescriptionSchema.array().max(10).optional(),
      imageUrls: z.string().url().array().max(20).optional(),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'create_category',
        args,
        { code: args.code, name: args.name, parentCode: args.parentCode ?? null },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.createCategory) {
            return toolError('create_category not supported on this platform.');
          }
          const category: CategoryCreate = {
            code: args.code,
            name: args.name,
            ...(args.parentCode ? { parentCode: args.parentCode } : {}),
            ...(args.parentGuid ? { parentGuid: args.parentGuid } : {}),
            ...(args.position !== undefined ? { position: args.position } : {}),
            ...(args.active !== undefined ? { active: args.active } : {}),
            ...(args.showInMenu !== undefined ? { showInMenu: args.showInMenu } : {}),
            ...(args.descriptions ? { descriptions: args.descriptions } : {}),
            ...(args.imageUrls ? { imageUrls: args.imageUrls } : {}),
          };
          const callArgs = { category };
          try {
            const data = await connector.writes.createCategory(shop, db, callArgs);
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'create_category',
              args: callArgs as unknown as Record<string, unknown>,
              before: null,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'createCategory failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'create_category',
              args: callArgs as unknown as Record<string, unknown>,
              before: null,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

function registerUpdateCategoryTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'update_category',
    'WRITE — update a category (name, parent, position, visibility, descriptions, images). Applied immediately and logged (revertable via revert_write). System root categories cannot be updated.' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Category identifier (code).'),
      patch: categoryPatchSchema.describe('Partial update — only fields to change.'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'update_category',
        args,
        { guid: args.guid, patch: args.patch },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.updateCategory) {
            return toolError('update_category not supported on this platform.');
          }
          const callArgs = { guid: args.guid, patch: args.patch as CategoryPatch };
          const before = await safeGetCategory(shop, connector, db, args.guid);
          try {
            const data = await connector.writes.updateCategory(shop, db, callArgs);
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'update_category',
              args: callArgs,
              before,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'updateCategory failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'update_category',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}

function registerDeleteCategoryTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
) {
  server.tool(
    'delete_category',
    'WRITE — delete a category by code (this ALSO deletes its subcategories). Applied immediately and logged. Revert re-creates the deleted category (new id; the subtree and product links are NOT restored). System root categories cannot be deleted.' +
      RETRY_NOTE,
    {
      guid: z.string().min(1).describe('Category identifier (code).'),
      confirm: confirmField(),
    },
    async (args) =>
      withWrite(
        shop.id,
        'delete_category',
        args,
        { guid: args.guid },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to write: confirm must be exactly "yes".');
          }
          if (!connector.writes?.deleteCategory) {
            return toolError('delete_category not supported on this platform.');
          }
          const callArgs = { guid: args.guid };
          const before = await safeGetCategory(shop, connector, db, args.guid);
          try {
            const data = await connector.writes.deleteCategory(shop, db, callArgs);
            const id = await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_category',
              args: callArgs,
              before,
              after: data.data,
              result: data.data,
              status: 'applied',
            });
            return toolOk({
              ok: true,
              applied: 'immediate',
              write_log_id: id,
              result: data.data,
            } satisfies WriteOk);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : 'deleteCategory failed';
            await logWrite(db, {
              shopId: shop.id,
              tool: 'delete_category',
              args: callArgs,
              before,
              after: null,
              result: null,
              status: 'failed',
              error: msg,
            });
            return toolError(msg);
          }
        }
      )
  );
}
