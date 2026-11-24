import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Shop } from '@puls/platform-core';

/**
 * MCP prompts — ready-made templates the user can pick from a slash menu in
 * Claude Desktop / Cursor. They steer the model toward the insights tools
 * instead of forcing the user to remember the right tool name.
 */
export function registerShopPrompts(server: McpServer, shop: Shop): void {
  server.prompt(
    'weekly_sales_report',
    'Generate a sales report for the last 7 days using sales_summary and top_customers.',
    {
      include_top_customers: z
        .enum(['yes', 'no'])
        .optional()
        .describe('Include top customers section (yes/no).'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Prepare a weekly sales report for the e-shop "${shop.domain}".`,
              '',
              '1. Call `sales_summary` with `period: "last_7_days"`.',
              '2. Compare it against the previous 7 days by calling `sales_summary` with `period: "last_30_days"` and noting the trend.',
              args.include_top_customers !== 'no'
                ? '3. Call `top_customers` with `period: "last_7_days"`, limit 5.'
                : '',
              '',
              'Output:',
              '- A short executive summary (revenue, order count, AOV, currency).',
              '- Bullet list of top products by revenue.',
              '- Status breakdown.',
              args.include_top_customers !== 'no'
                ? '- Top 5 customers and their spend.'
                : '',
              '- One-sentence recommendation.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    })
  );

  server.prompt(
    'inventory_alerts',
    'Surface low / out-of-stock products and propose restock priorities.',
    {
      threshold: z.string().optional().describe('Stock threshold (default 5).'),
    },
    (args) => {
      const threshold = args.threshold ?? '5';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Audit inventory for "${shop.domain}".`,
                '',
                `1. Call \`low_stock\` with \`threshold: ${threshold}\`, \`limit: 25\`.`,
                '2. Group results: out-of-stock (stock = 0) vs. low (stock > 0).',
                '3. For the top 3 most critical, propose a restock priority (high / medium / low) and a one-line justification.',
                '',
                'Be concise. If no products expose stock data, say so clearly.',
              ].join('\n'),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    'order_triage',
    'Walk through pending orders and flag any that need attention.',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Triage current orders for "${shop.domain}".`,
              '',
              '1. Call `list_orders` with `limit: 50`.',
              '2. Group by status; flag anything stuck in non-terminal states (e.g. "new" older than 24h, "paid" not yet shipped).',
              '3. For each flagged order, call `get_order` to confirm details.',
              '',
              'Return a markdown table: code | status | created | total | reason flagged.',
            ].join('\n'),
          },
        },
      ],
    })
  );
}
