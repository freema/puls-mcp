import { eq } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { shops } from '@puls/db/schema';
import { getConnector } from './connector-registry.js';
import {
  registerCatalogTools,
  registerCustomersTools,
  registerFeedbackTools,
  registerInsightsTools,
  registerMemoryTools,
  registerOrdersTools,
  registerProductsTools,
  registerWriteTools,
} from './tools/index.js';
import { registerShopResources } from './resources.js';
import { registerShopPrompts } from './prompts.js';
import {
  enhanceToolDescription,
  getOrLoadShopMemory,
  type ShopMemoryData,
} from './memory/index.js';
import { loadTierForShop, withTierGate, type TierInfo } from './tier-gate.js';
import { withToolAnnotations } from './tool-annotations.js';

export async function loadShopById(
  db: PulsDb,
  shopId: string
): Promise<Shop | null> {
  const [row] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return row ?? null;
}

/** Tool category ids — must match the consent UI checkboxes. */
export const TOOL_CATEGORIES = [
  'orders',
  'products',
  'customers',
  'catalog',
  'insights',
  'write',
  'memory',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * Patch `server.tool` so every registered tool's description is enriched
 * with the shop's memory context. The MCP SDK exposes the tool list to
 * the client via this string, so injecting at registration time is enough.
 */
function withMemoryEnhancedDescriptions(
  server: McpServer,
  memory: ShopMemoryData | null
): McpServer {
  if (!memory) return server;
  const original = server.tool.bind(server) as (
    name: string,
    description: string,
    ...rest: unknown[]
  ) => unknown;
  (server as unknown as { tool: typeof original }).tool = (
    name,
    description,
    ...rest
  ) =>
    original(name, enhanceToolDescription(name, description, memory), ...rest);
  return server;
}

/**
 * Patch `server.tool` so every registered tool's description is passed through
 * the connector's optional `describeTool` hook. Tool names are platform-neutral
 * (`list_orders`, …) but a platform may want a platform-specific note appended
 * to the description (Shoptet: GUID/code; Upgates: CODE/EAN). Connectors that
 * don't implement the hook leave the base description untouched.
 */
function withConnectorDescriptions(
  server: McpServer,
  connector: PlatformConnector
): McpServer {
  if (!connector.describeTool) return server;
  const describe = connector.describeTool.bind(connector);
  const original = server.tool.bind(server) as (
    name: string,
    description: string,
    ...rest: unknown[]
  ) => unknown;
  (server as unknown as { tool: typeof original }).tool = (
    name,
    description,
    ...rest
  ) => original(name, describe(name, description), ...rest);
  return server;
}

/**
 * Test/seam injection points. In production both are resolved internally
 * (`getConnector(shop.platform)` + `loadTierForShop`). Tests inject a mock
 * connector with a trimmed capability set, or a forced trial tier, to assert
 * the capability gate + anti-freeride trial block in isolation.
 */
export interface CreateShopMcpServerOptions {
  connector?: PlatformConnector;
  tier?: TierInfo | null;
}

export async function createShopMcpServer(
  shop: Shop,
  db: PulsDb,
  disabledTools: Set<string> = new Set(),
  opts: CreateShopMcpServerOptions = {}
): Promise<McpServer> {
  const server = new McpServer(
    {
      name: 'puls',
      // Version from APP_VERSION (release tag via GitHub Actions, promoted
      // ARG→ENV in Dockerfile.prod). Single source of truth — no hardcode.
      version: process.env.APP_VERSION || 'development',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // MUST be the first server.tool patch (innermost wrapper): injects MCP
  // annotations (title + readOnlyHint/destructiveHint) required by the connector
  // directory. withTierGate below reconstructs the call with a fixed 4-arg
  // signature and would drop annotations added by an outer wrapper, so they have
  // to be attached closest to the real server.tool. See ./tool-annotations.ts.
  withToolAnnotations(server);

  const memory = disabledTools.has('memory')
    ? null
    : await getOrLoadShopMemory(db, shop.id);

  withMemoryEnhancedDescriptions(server, memory);

  const tier =
    opts.tier !== undefined ? opts.tier : await loadTierForShop(db, shop);
  if (tier) withTierGate(server, shop, tier);

  // Connector pro platformu shopu — tool vrstva přes něj volá API místo přímých
  // importů z @puls/shoptet-client. Registrace kategorie je navíc podmíněná
  // capabilities connectoru (platforma, která kategorii neumí, ji nezaregistruje).
  const connector = opts.connector ?? getConnector(shop.platform);
  withConnectorDescriptions(server, connector);
  const cap = connector.capabilities.categories;

  if (!disabledTools.has('orders') && cap.orders)
    registerOrdersTools(server, shop, connector, db);
  if (!disabledTools.has('products') && cap.products)
    registerProductsTools(server, shop, connector, db);
  if (!disabledTools.has('customers') && cap.customers)
    registerCustomersTools(server, shop, connector, db);
  if (!disabledTools.has('catalog') && cap.catalog)
    registerCatalogTools(server, shop, connector, db);
  if (!disabledTools.has('insights') && cap.insights)
    registerInsightsTools(server, shop, connector, db);
  // Trial tier nemá write tools v listingu ani s consent='write' (anti-freeride).
  const trialBlocksWrites = tier?.isTrial === true;
  if (!disabledTools.has('write') && !trialBlocksWrites && cap.write) {
    registerWriteTools(server, shop, connector, db);
  }
  if (!disabledTools.has('memory') && memory !== null) {
    registerMemoryTools(server, shop, db);
  }

  // Feedback loop není zápis do e-shopu (jen do našeho systému) → registruje se
  // VŽDY, bez ohledu na consent kategorie, tier (i trial) i capability connectoru.
  // Cíl je posbírat co nejvíc produktového feedbacku napříč všemi instalacemi.
  registerFeedbackTools(server, shop, db);

  // Resources and prompts are not gated by the consent UI — they are static
  // metadata / templates and don't expose anything beyond what the gated
  // catalog/orders tools already would.
  registerShopResources(server, shop, connector, db);
  registerShopPrompts(server, shop);

  return server;
}
