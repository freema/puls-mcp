import { describe, expect, it } from 'vitest';
import { createShopMcpServer } from '../src/puls-mcp.js';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { PLATFORM } from '@puls/db/schema';
import { getConnector } from '../src/connector-registry.js';
import type { TierInfo } from '../src/tier-gate.js';
import { isReadOnlyTool } from '../src/tool-annotations.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

const mockShop: Shop = {
  id: 'shop-test',
  platform: PLATFORM.UPGATES,
  platformAccountId: '1',
  domain: 'x.test',
  name: null,
  adminEmail: null,
  status: 'ACTIVE',
  oauthAccessToken: 'oauth',
  webhookSignatureKey: 'wh',
  apiBaseUrl: 'http://mock',
  mcpEndpointSecret: 'mcp',
  memoryEnabled: false,
  installedAt: new Date(),
  uninstalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Memory category triggers a DB read (`shops.memory_enabled`). We skip it in
 * unit tests by adding `'memory'` to the disabled set — DB stays untouched.
 */
const SKIP_MEMORY = new Set(['memory']);

describe('createShopMcpServer registration', () => {
  function registeredNames(
    server: Awaited<ReturnType<typeof createShopMcpServer>>
  ): string[] {
    const internal = (server as unknown as {
      _registeredTools?: Record<string, unknown>;
    })._registeredTools;
    return Object.keys(internal ?? {});
  }

  it('registers the full neutral tool surface (no platform prefix)', async () => {
    const mcp = await createShopMcpServer(mockShop, makeFakeDb(mockShop), SKIP_MEMORY);
    const names = registeredNames(mcp);
    const expected = [
      'list_orders',
      'get_order',
      'list_order_changes',
      'list_products',
      'get_product',
      'list_customers',
      'get_customer',
      'list_stocks',
      'list_categories',
      'eshop_info',
      // Upgates vystavuje číselník výrobců → list_manufacturers se registruje.
      'list_manufacturers',
      'sales_summary',
      'low_stock',
      'top_customers',
      'update_product',
      'create_product',
      'create_category',
      'update_category',
      'delete_category',
      'create_voucher',
      'delete_voucher',
      'update_stock',
      'bulk_update_products',
      // bulk_set_prices loopuje ověřený updateProduct → Upgates capability=true.
      'bulk_set_prices',
      'set_product_discount',
      'list_pricelists',
      'create_pricelist',
      'delete_pricelist',
      'revert_write',
      // Feedback loop je vždy registrovaný (mimo consent/tier/capability gate).
      'submit_feedback',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
    expect(names).toHaveLength(expected.length);
    // U Upgates je order-write i poznámka zákazníka capability=false a akční cena
    // (časové okno) v API neexistuje → tyto nástroje se NEsmí zaregistrovat
    // (graceful degradace, žádný nefunkční nástroj v UI). delete_product nemá
    // samostatný nástroj (jen revert create_product).
    for (const absent of [
      'update_order_status',
      'create_customer_note',
      'set_action_price',
      'delete_product',
    ]) {
      expect(names).not.toContain(absent);
    }
    // No tool name carries a platform prefix.
    for (const name of names) {
      expect(name.startsWith('upgates_')).toBe(false);
    }
  });

  it('registers the Shoptet tool surface via the Shoptet connector', async () => {
    const shoptetShop: Shop = { ...mockShop, platform: PLATFORM.SHOPTET };
    const mcp = await createShopMcpServer(
      shoptetShop,
      makeFakeDb(shoptetShop),
      SKIP_MEMORY
    );
    const names = registeredNames(mcp);
    // Shoptet umí order-write, poznámku zákazníka i akční cenu.
    for (const name of [
      'list_orders',
      'get_order',
      'list_products',
      'list_customers',
      'eshop_info',
      'sales_summary',
      'update_order_status',
      'create_customer_note',
      'update_product',
      'set_action_price',
      'create_voucher',
      'update_stock',
      'bulk_update_products',
      'bulk_set_prices',
      'revert_write',
      'submit_feedback',
    ]) {
      expect(names).toContain(name);
    }
    // Upgates-only create/manage akce jsou u Shoptetu capability=false.
    for (const absent of [
      'list_manufacturers',
      'create_product',
      'create_category',
      'update_category',
      'delete_category',
      'delete_voucher',
      'list_pricelists',
      'create_pricelist',
      'delete_pricelist',
      'set_product_discount',
    ]) {
      expect(names).not.toContain(absent);
    }
    for (const name of names) {
      expect(name.startsWith('shoptet_')).toBe(false);
    }
  });

  it('skips tool categories listed in disabledTools', async () => {
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      new Set(['orders', 'customers', 'insights', 'memory'])
    );
    const names = registeredNames(mcp);
    expect(names).not.toContain('list_orders');
    expect(names).not.toContain('get_order');
    expect(names).not.toContain('list_customers');
    expect(names).not.toContain('sales_summary');
    expect(names).not.toContain('top_customers');
    expect(names).toContain('list_products');
    expect(names).toContain('eshop_info');
  });

  it('write tools are gated by the "write" category', async () => {
    const enabled = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY
    );
    expect(registeredNames(enabled)).toContain('update_product');
    expect(registeredNames(enabled)).toContain('update_stock');

    const noWrites = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      new Set(['write', 'memory'])
    );
    expect(registeredNames(noWrites)).not.toContain('update_product');
    expect(registeredNames(noWrites)).not.toContain('update_stock');
    // Read-only tools still present
    expect(registeredNames(noWrites)).toContain('list_orders');
  });

  it('connector capabilities gate categories even with empty disabledTools', async () => {
    // Mock connector that only supports orders/catalog/memory — no products,
    // customers, insights or write. Even with nothing disabled by consent,
    // unsupported categories must not register.
    const connector = makeMockConnector({
      categories: {
        orders: true,
        products: false,
        customers: false,
        catalog: true,
        insights: false,
        write: false,
        memory: true,
      },
    });
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector }
    );
    const names = registeredNames(mcp);
    // Supported categories present.
    expect(names).toContain('list_orders');
    expect(names).toContain('list_stocks');
    // Unsupported categories absent despite empty disabledTools.
    expect(names).not.toContain('list_products');
    expect(names).not.toContain('get_customer');
    expect(names).not.toContain('sales_summary');
    expect(names).not.toContain('update_order_status');
  });

  it('registers list_manufacturers only when the connector exposes catalog.manufacturers', async () => {
    // Upgates base vystavuje číselník výrobců → nástroj se registruje.
    const base = getConnector(PLATFORM.UPGATES);
    const withMfr = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY
    );
    expect(registeredNames(withMfr)).toContain('list_manufacturers');

    // Connector bez catalog.manufacturers → nástroj se NEsmí zaregistrovat.
    const { manufacturers: _omit, ...catalogWithoutMfr } = base.catalog;
    const withoutMfr: PlatformConnector = {
      ...base,
      catalog: catalogWithoutMfr,
    };
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector: withoutMfr }
    );
    expect(registeredNames(mcp)).not.toContain('list_manufacturers');
  });

  it('per-tool write capabilities gate individual write tools', async () => {
    // Full write category, but only update_product is enabled per-action.
    const connector = makeMockConnector({
      writes: {
        updateOrderStatus: false,
        createCustomerNote: false,
        updateProduct: true,
        setActionPrice: false,
        createVoucher: false,
        updateStock: false,
        bulkUpdateProducts: false,
      },
    });
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector }
    );
    const names = registeredNames(mcp);
    expect(names).toContain('update_product');
    expect(names).not.toContain('create_customer_note');
    expect(names).not.toContain('update_stock');
    expect(names).not.toContain('create_voucher');
  });

  it('new write tools register when their capability flips on (wiring check)', async () => {
    // Ověřuje, že registrační dispatch zaregistruje rozšířené write nástroje
    // podle capability flagů (Upgates je má zapnuté po live ověření).
    const connector = makeMockConnector({
      writes: {
        createProduct: true,
        deleteProduct: true,
        createCategory: true,
        updateCategory: true,
        deleteCategory: true,
        setProductDiscount: true,
        managePricelists: true,
        deleteVoucher: true,
      },
    });
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector }
    );
    const names = registeredNames(mcp);
    for (const name of [
      'create_product',
      'create_category',
      'update_category',
      'delete_category',
      'set_product_discount',
      'list_pricelists',
      'create_pricelist',
      'delete_pricelist',
      'delete_voucher',
    ]) {
      expect(names).toContain(name);
    }
    // deleteProduct nemá samostatný nástroj (jen revert create_product).
    expect(names).not.toContain('delete_product');
  });

  it('trial tier blocks write tools even with full capabilities + consent (anti-freeride)', async () => {
    const trialTier = { isTrial: true } as unknown as TierInfo;
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector: makeMockConnector({}), tier: trialTier }
    );
    const names = registeredNames(mcp);
    // Write tools hidden on trial.
    expect(names).not.toContain('update_product');
    expect(names).not.toContain('bulk_update_products');
    // Read tools still register.
    expect(names).toContain('list_orders');
    expect(names).toContain('sales_summary');

    // Same shop on a non-trial tier → writes surface.
    const paidTier = { isTrial: false } as unknown as TierInfo;
    const paid = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector: makeMockConnector({}), tier: paidTier }
    );
    expect(registeredNames(paid)).toContain('update_product');
  });

  // Directory submission requirement: every tool must carry a `title` plus the
  // applicable `readOnlyHint`/`destructiveHint`. These drive Claude's
  // auto-permission prompts; a missing one is a hard rejection at review.
  function registeredTools(
    server: Awaited<ReturnType<typeof createShopMcpServer>>
  ): Record<string, { annotations?: ToolAnnotations }> {
    const internal = (server as unknown as {
      _registeredTools?: Record<string, { annotations?: ToolAnnotations }>;
    })._registeredTools;
    return internal ?? {};
  }

  it('every tool carries title + read/destructive annotations', async () => {
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY
    );
    const tools = registeredTools(mcp);
    expect(Object.keys(tools).length).toBeGreaterThan(0);

    for (const [name, tool] of Object.entries(tools)) {
      const ann = tool.annotations;
      expect(ann, `${name} must have annotations`).toBeDefined();
      expect(
        typeof ann?.title === 'string' && ann.title.length > 0,
        `${name} must have a non-empty title`
      ).toBe(true);
      if (isReadOnlyTool(name)) {
        expect(ann?.readOnlyHint, `${name} (read) -> readOnlyHint`).toBe(true);
        expect(ann?.destructiveHint).not.toBe(true);
      } else {
        expect(ann?.destructiveHint, `${name} (write) -> destructiveHint`).toBe(
          true
        );
        expect(ann?.readOnlyHint).not.toBe(true);
      }
    }

    // Spot checks across a read, a write, and the revert tool.
    expect(tools['list_orders']?.annotations).toMatchObject({
      title: 'List Orders',
      readOnlyHint: true,
    });
    expect(tools['update_product']?.annotations).toMatchObject({
      title: 'Update Product',
      destructiveHint: true,
    });
    expect(tools['revert_write']?.annotations).toMatchObject({
      title: 'Revert a Write',
      destructiveHint: true,
    });
  });

  it('annotations survive the tier-gate handler wrapper (4-arg reconstruction)', async () => {
    // withTierGate reconstructs each registration with a fixed 4-arg signature.
    // The annotations wrapper is applied innermost so a forced (non-trial) tier
    // — which activates withTierGate for every tool — must NOT strip annotations.
    const paidTier = { isTrial: false } as unknown as TierInfo;
    const mcp = await createShopMcpServer(
      mockShop,
      makeFakeDb(mockShop),
      SKIP_MEMORY,
      { connector: makeMockConnector({}), tier: paidTier }
    );
    const tools = registeredTools(mcp);
    // A read tool and a tier-gated write tool both keep their annotations.
    expect(tools['list_orders']?.annotations).toMatchObject({
      title: 'List Orders',
      readOnlyHint: true,
    });
    expect(tools['update_product']?.annotations).toMatchObject({
      title: 'Update Product',
      destructiveHint: true,
    });
  });

  it('memory tools register only when memory_enabled = true and category is on', async () => {
    // Memory off in DB → no memory tools even if the consent category is
    // enabled (token-level check is necessary but not sufficient).
    const memoryOffShop: Shop = { ...mockShop, memoryEnabled: false };
    const fakeDbDisabled = makeFakeDb(memoryOffShop);
    const mcp1 = await createShopMcpServer(
      memoryOffShop,
      fakeDbDisabled,
      new Set()
    );
    expect(registeredNames(mcp1)).not.toContain('memory_get');

    // Memory on in DB + category enabled → memory tools surface.
    const memoryOnShop: Shop = { ...mockShop, memoryEnabled: true };
    const fakeDbEnabled = makeFakeDb(memoryOnShop);
    const mcp2 = await createShopMcpServer(memoryOnShop, fakeDbEnabled, new Set());
    expect(registeredNames(mcp2)).toEqual(
      expect.arrayContaining(['memory_get', 'memory_set', 'memory_forget'])
    );
  });
});

/**
 * Minimal Drizzle-shaped stub: only the call paths the memory loader uses
 * (select → from → where → limit) need to resolve. Returns the `shop` row
 * for the `shops` table query and an empty result for `shop_memory`.
 */
/**
 * Build a connector with an overridable capability set. Tool implementations
 * come from the real Upgates connector (so registration uses neutral names),
 * but `capabilities` is replaced so the capability gate can be exercised in
 * isolation. The handlers are never invoked here — only registration is asserted.
 */
function makeMockConnector(override: {
  categories?: Partial<PlatformConnector['capabilities']['categories']>;
  writes?: Partial<PlatformConnector['capabilities']['writes']>;
}): PlatformConnector {
  const base = getConnector(PLATFORM.UPGATES);
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      categories: { ...base.capabilities.categories, ...override.categories },
      writes: { ...base.capabilities.writes, ...override.writes },
    },
  };
}

function makeFakeDb(shop: Shop): PulsDb {
  const builder = (rows: unknown[]) => ({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  });
  let nextResult: unknown[] = [];
  const db = {
    select: (cols?: Record<string, unknown>) => {
      // First select pulls memory_enabled from shops; subsequent selects
      // pull from shop_memory and find no row → empty array.
      if (cols && 'memoryEnabled' in cols) {
        nextResult = [{ memoryEnabled: shop.memoryEnabled }];
      } else {
        nextResult = [];
      }
      return builder(nextResult);
    },
  };
  return db as unknown as PulsDb;
}
