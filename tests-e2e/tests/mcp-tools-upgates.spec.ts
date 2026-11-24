import { expect, test } from '@playwright/test';
import { connectMcpClient } from '../helpers/mcp';
import { mintAccessToken, parseJsonText } from '../helpers/mint-token';
import { setShopTier } from '../helpers/write-log';

const TEST_EMAIL = 'mcp-tools-upgates@example.test';

test.describe('MCP tool execution for an Upgates shop', () => {
  test('tools/list uses neutral names (no platform prefix) and honours scopes', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      platform: 'upgates',
      enabledTools: ['orders', 'catalog'],
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);

      // Neutral names shared with Shoptet — no platform prefix on either side.
      expect(names).toEqual(expect.arrayContaining(['list_orders']));
      expect(names).toEqual(expect.arrayContaining(['list_stocks']));
      expect(names.find((n) => n.startsWith('shoptet_'))).toBeUndefined();
      expect(names.find((n) => n.startsWith('upgates_'))).toBeUndefined();
      // Out-of-scope / unsupported categories must be hidden.
      expect(names.find((n) => n.includes('product'))).toBeUndefined();
      expect(names.find((n) => n.includes('customer'))).toBeUndefined();
      expect(names.find((n) => n.includes('sales_summary'))).toBeUndefined();
      // Write is a capability Upgates lacks → hidden even with consent.
      expect(names.find((n) => n.includes('update_order_status'))).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  test('Upgates capability gate registers verified writes, hides unverified', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl, shopId } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-tools-upgates-write@example.test',
      platform: 'upgates',
      enabledTools: ['orders', 'products', 'catalog', 'write'],
    });
    // Trial tier write nastroje blokuje (anti-freeride) - pro test placeny tier.
    await setShopTier(process.env.DATABASE_URL!, shopId, 'pro');

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const list = await handle.client.listTools();
      const names = list.tools.map((t) => t.name);
      // Read tools present...
      expect(names).toContain('list_orders');
      // Write sada LIVE OVERENA proti realnemu API (dev eshop 2026-06-08) →
      // capability flipnute na true, nastroje se registruji.
      for (const w of [
        'update_product',
        'create_product',
        'create_category',
        'update_category',
        'delete_category',
        'create_voucher',
        'delete_voucher',
        'update_stock',
        'bulk_update_products',
        'bulk_set_prices',
        'set_product_discount',
        'list_pricelists',
        'create_pricelist',
        'delete_pricelist',
      ]) {
        expect(names).toContain(w);
      }
      // ...skryte write operace (per-tool capability gate):
      //  - update_order_status: u Upgates VYPNUTO (task 15 — zmena stavu posila
      //    zakaznikovi e-mail/SMS, nereverzibilni; uzivatel ho nechce),
      //  - create_customer_note: eshop ma 0 zakazniku, read-back neoveren,
      //  - set_action_price: API v2 nema casove okno na cene (trvale).
      for (const w of [
        'update_order_status',
        'create_customer_note',
        'set_action_price',
      ]) {
        expect(names).not.toContain(w);
      }
    } finally {
      await handle.close();
    }
  });

  test('tools/call list_orders returns slim rows from the Upgates mock', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      platform: 'upgates',
      enabledTools: ['orders', 'catalog'],
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.callTool({
        name: 'list_orders',
        arguments: { limit: 5 },
      });
      const payload = parseJsonText(res.content) as {
        count?: number;
        orders?: { code: string; status: string; total: unknown }[];
      } | null;
      expect(payload).not.toBeNull();
      expect(Array.isArray(payload!.orders)).toBe(true);
      expect(payload!.orders!.length).toBeGreaterThan(0);
      const first = payload!.orders![0]!;
      expect(first.code).toBe('UPG-ORDER-001');
      expect(typeof first.status).toBe('string');
      // Slim shape — Upgates raw fields must not leak.
      expect(Object.keys(first).sort()).toEqual(['code', 'status', 'total']);
    } finally {
      await handle.close();
    }
  });

  test('tools/call get_product maps variants + richer price/availability', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: 'mcp-tools-upgates-products@example.test',
      platform: 'upgates',
      enabledTools: ['products'],
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.callTool({
        name: 'get_product',
        arguments: { guid: 'UPG-PROD-001' },
      });
      const detail = parseJsonText(res.content) as {
        guid?: string;
        name?: string;
        price?: unknown;
        priceWithoutVat?: unknown;
        availabilityLabel?: string;
        variants?: { code: string; ean?: string; priceWithVat?: number; stock?: number }[];
      } | null;
      expect(detail).not.toBeNull();
      expect(detail!.guid).toBe('UPG-PROD-001');
      // Bohatší cenová struktura — with vs without VAT.
      expect(detail!.price).toBe(499);
      expect(detail!.priceWithoutVat).toBe(412.4);
      // Availability label z číselníku.
      expect(detail!.availabilityLabel).toBe('Skladem');
      // Varianta = plnohodnotný produkt s vlastním code/EAN/cenou/skladem.
      expect(Array.isArray(detail!.variants)).toBe(true);
      const variant = detail!.variants?.[0];
      expect(variant?.code).toBe('UPG-PROD-001-M');
      expect(variant?.ean).toBe('8590000000018');
      expect(variant?.stock).toBe(4);
    } finally {
      await handle.close();
    }
  });

  test('tools/call get_order maps B2B + localized line items', async ({
    browser,
    request,
  }) => {
    const { accessToken, mcpUrl } = await mintAccessToken({
      browser,
      request,
      email: TEST_EMAIL,
      platform: 'upgates',
      enabledTools: ['orders'],
    });

    const handle = await connectMcpClient({ url: mcpUrl, bearer: accessToken });
    try {
      const res = await handle.client.callTool({
        name: 'get_order',
        arguments: { code: 'UPG-ORDER-001' },
      });
      const detail = parseJsonText(res.content) as {
        code?: string;
        paid?: boolean;
        customer?: { companyId?: string; vatId?: string; name?: string };
        items?: { name: string; amount?: number; unitPrice?: unknown }[];
      } | null;
      expect(detail).not.toBeNull();
      expect(detail!.code).toBe('UPG-ORDER-001');
      // PAID_YN: Y → paid: true (kanonický boolean).
      expect(detail!.paid).toBe(true);
      // B2B nativní u Upgates — IČO/DIČ mapované na neutrální model.
      expect(detail!.customer?.companyId).toBe('12345678');
      expect(detail!.customer?.vatId).toBe('CZ12345678');
      expect(detail!.items?.[0]?.name).toBe('Tričko bavlněné');
    } finally {
      await handle.close();
    }
  });
});
