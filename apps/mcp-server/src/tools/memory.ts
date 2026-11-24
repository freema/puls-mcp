import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PulsDb, Shop } from '@puls/platform-core';
import {
  addMemoryItem,
  clearAllMemory,
  deleteMemoryItem,
  getOrLoadShopMemory,
  listMemoryItems,
} from '../memory/index.js';
import { toolError, toolOk, withRequestLogging } from './usage.js';

const categoryEnum = z.enum(['preference', 'context', 'learned', 'instruction']);

export function registerMemoryTools(
  server: McpServer,
  shop: Shop,
  db: PulsDb
): void {
  server.tool(
    'memory_get',
    'List remembered preferences and learned context for this shop. Use this once per session to recall what the user told you previously (e.g. preferred language, default order status filter, business rules) so you can apply it without re-asking.',
    {},
    async () =>
      withRequestLogging(shop.id, 'memory_get', {}, async () => {
        const memory = await getOrLoadShopMemory(db, shop.id);
        const items = await listMemoryItems(db, shop.id);
        return toolOk({
          enabled: memory !== null,
          systemContext: memory?.systemContext ?? null,
          items: items.map((i) => ({
            id: i.id,
            category: i.category,
            source: i.source,
            label: i.label,
            content: i.content,
            appliesToTools: i.appliesToTools,
            priority: i.priority,
            createdAt: i.createdAt,
          })),
        });
      })
  );

  server.tool(
    'memory_set',
    'Save a preference or learned fact about this shop so future sessions can reuse it. Call this when the user states a preference ("always show me last 7 days"), confirms a non-obvious fact ("our XML feed is on Heureka, not Zboží"), or instructs you on a recurring decision. Do NOT save transient session state, sensitive data (passwords, full customer PII), or guesses.',
    {
      content: z.string().min(1).max(1000).describe(
        'The fact or preference to remember, in one or two sentences. Be specific.'
      ),
      label: z
        .string()
        .max(120)
        .optional()
        .describe('Optional short title (e.g. "default order status filter").'),
      category: categoryEnum
        .optional()
        .describe(
          'preference = user choice; context = factual info about the shop; learned = inferred during work; instruction = explicit how-to.'
        ),
      appliesToTools: z
        .array(z.string())
        .optional()
        .describe(
          'Tool names this should attach to (e.g. ["list_orders"]). Omit for global preferences shown across all tools.'
        ),
      priority: z
        .number()
        .int()
        .min(-10)
        .max(10)
        .optional()
        .describe('Higher values surface first when the block is rendered.'),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'memory_set',
        { label: args.label, category: args.category },
        async () => {
          const memory = await getOrLoadShopMemory(db, shop.id);
          if (memory === null) {
            return toolError(
              'Memory is disabled for this shop. Enable it in the Puls dashboard before using memory tools.'
            );
          }
          const id = await addMemoryItem(db, shop.id, {
            content: args.content,
            label: args.label,
            category: args.category ?? 'context',
            source: 'ai_learned',
            appliesToTools: args.appliesToTools,
            priority: args.priority ?? 0,
          });
          return toolOk({ id, saved: true });
        }
      )
  );

  server.tool(
    'memory_forget',
    'Delete a remembered item by id, or wipe all memory for this shop. Use when the user explicitly asks to forget something or when a saved fact turns out to be wrong.',
    {
      id: z
        .string()
        .optional()
        .describe('Item id from memory_get. Omit together with all=true to wipe everything.'),
      all: z
        .boolean()
        .optional()
        .describe('Set true to delete every memory item for this shop. Requires no id.'),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'memory_forget',
        { id: args.id, all: args.all ?? false },
        async () => {
          if (args.all) {
            const deleted = await clearAllMemory(db, shop.id);
            return toolOk({ deleted });
          }
          if (!args.id) {
            return toolError('Provide either id or all=true.');
          }
          const ok = await deleteMemoryItem(db, shop.id, args.id);
          return ok ? toolOk({ deleted: 1 }) : toolError('Item not found.');
        }
      )
  );
}
