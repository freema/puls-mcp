import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Human-readable titles for every tool. The Claude connector directory requires
 * each tool to carry a `title` plus the applicable `readOnlyHint`/`destructiveHint`
 * annotation — these also drive Claude's auto-permission prompts. Titles are kept
 * in English to match the (English) tool descriptions. Any tool missing from this
 * map falls back to a prettified version of its name (see `prettifyName`).
 */
const TOOL_TITLES: Record<string, string> = {
  // read-only
  list_products: 'List Products',
  get_product: 'Get Product',
  list_orders: 'List Orders',
  get_order: 'Get Order',
  list_order_changes: 'List Order Changes',
  list_customers: 'List Customers',
  get_customer: 'Get Customer',
  list_categories: 'List Categories',
  list_pricelists: 'List Price Lists',
  list_stocks: 'List Stock Locations',
  low_stock: 'Low-Stock Products',
  eshop_info: 'E-shop Info',
  sales_summary: 'Sales Summary',
  top_customers: 'Top Customers',
  memory_get: 'Recall Shop Memory',
  // writes (data-modifying — destructiveHint per directory rules)
  create_product: 'Create Product',
  update_product: 'Update Product',
  bulk_update_products: 'Bulk Update Products',
  bulk_set_prices: 'Bulk Set Prices',
  set_action_price: 'Set Sale Price',
  set_product_discount: 'Set Product Discount',
  create_category: 'Create Category',
  update_category: 'Update Category',
  delete_category: 'Delete Category',
  create_pricelist: 'Create Price List',
  delete_pricelist: 'Delete Price List',
  create_voucher: 'Create Voucher',
  delete_voucher: 'Delete Voucher',
  create_customer_note: 'Add Customer Note',
  update_order_status: 'Update Order Status',
  update_stock: 'Set Stock Quantity',
  revert_write: 'Revert a Write',
  memory_set: 'Save to Shop Memory',
  memory_forget: 'Forget Shop Memory',
  // feedback (writes to Puls's own system, not shop data)
  submit_feedback: 'Send Product Feedback',
};

/**
 * Read tools whose names don't start with `list_`/`get_`. Everything not matched
 * by `isReadOnlyTool` is treated as a write (destructive) — a safe default for
 * permission prompts if a future tool is added without being classified here.
 */
const READ_ONLY_EXTRA = new Set<string>([
  'low_stock',
  'sales_summary',
  'top_customers',
  'eshop_info',
  'memory_get',
]);

function prettifyName(name: string): string {
  return name
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** True if the tool never modifies shop data. */
export function isReadOnlyTool(name: string): boolean {
  return (
    name.startsWith('list_') ||
    name.startsWith('get_') ||
    READ_ONLY_EXTRA.has(name)
  );
}

/** Build the MCP annotations object (title + read/destructive hint) for a tool. */
export function annotationsForTool(name: string): ToolAnnotations {
  const title = TOOL_TITLES[name] ?? prettifyName(name);
  if (isReadOnlyTool(name)) {
    return { title, readOnlyHint: true };
  }
  return { title, readOnlyHint: false, destructiveHint: true };
}

/**
 * Patch `server.tool` so every registered tool carries MCP annotations
 * (`title` + `readOnlyHint`/`destructiveHint`). Required for the Claude connector
 * directory and used to drive Claude's auto-permission prompts.
 *
 * MUST be applied FIRST — i.e. as the innermost wrapper, directly on top of the
 * real `server.tool`. `withTierGate` reconstructs each call with a fixed 4-arg
 * signature `(name, description, schema, handler)` and would drop a 5th
 * annotations argument added by an outer wrapper. Sitting innermost, this wrapper
 * receives the final 4-arg call and emits the 5-arg
 * `(name, description, schema, annotations, handler)` form to the real server.
 */
export function withToolAnnotations(server: McpServer): McpServer {
  const original = server.tool.bind(server) as (
    name: string,
    description: string,
    schema: unknown,
    annotations: ToolAnnotations,
    handler: unknown
  ) => unknown;
  (server as unknown as { tool: typeof original }).tool = ((
    name: string,
    description: string,
    schema: unknown,
    handler: unknown
  ) =>
    original(
      name,
      description,
      schema,
      annotationsForTool(name),
      handler
    )) as unknown as typeof original;
  return server;
}
