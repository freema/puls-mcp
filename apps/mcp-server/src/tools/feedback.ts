import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PulsDb, Shop } from '@puls/platform-core';
import { feedback } from '@puls/db/schema';
import { toolError, toolOk, withRequestLogging } from './usage.js';

const typeEnum = z.enum([
  'feature_request',
  'bug',
  'praise',
  'missing_tool',
  'other',
]);
const sentimentEnum = z.enum(['positive', 'neutral', 'negative']);

/**
 * Feedback loop: nechá AI klienta zaznamenat produktový feedback o Pulsu (tomhle
 * MCP) tak, jak ho uživatel během práce vysloví. Není to zápis do e-shopu —
 * jen do našeho systému — takže nástroj registrujeme VŽDY (i v trialu, mimo
 * consent kategorie), abychom posbírali co nejvíc signálu. Admin ho čte v
 * /admin/feedback a staví z něj další featury.
 */
export function registerFeedbackTools(
  server: McpServer,
  shop: Shop,
  db: PulsDb
): void {
  server.tool(
    'submit_feedback',
    'Record the user\'s product feedback about Puls itself (this MCP / its tools) so the team can act on it. Call this when the user wishes a capability existed ("I wish I could bulk-edit product photos"), reports that something in Puls is confusing or broken, praises a feature, or asks for a tool that does not exist yet. Summarize the user\'s point in their own intent, in one or two sentences. This is feedback ABOUT PULS — do NOT use it to change shop data (use the write tools for that). Confirm with the user before sending so they know their words go to the Puls team.',
    {
      message: z
        .string()
        .min(3)
        .max(2000)
        .describe(
          'The feedback, summarized in the user\'s intent. Be specific and concrete.'
        ),
      type: typeEnum
        .default('other')
        .describe(
          'feature_request = wants new capability; bug = something is broken/wrong; praise = positive note; missing_tool = asked for a tool that does not exist; other = anything else.'
        ),
      sentiment: sentimentEnum
        .optional()
        .describe('Overall tone of the user about Puls, if clear.'),
      context: z
        .string()
        .max(2000)
        .optional()
        .describe(
          'What the user was doing or which tool/task prompted this (e.g. "while bulk-pricing winter stock"). Helps triage.'
        ),
    },
    async (args) =>
      withRequestLogging(
        shop.id,
        'submit_feedback',
        { type: args.type, sentiment: args.sentiment },
        async () => {
          // Best-effort jméno MCP klienta (Claude, Cursor, …) z initialize handshake.
          let source: string | null = null;
          try {
            const info = (
              server.server as {
                getClientVersion?: () => { name?: string } | undefined;
              }
            ).getClientVersion?.();
            source = info?.name ?? null;
          } catch {
            source = null;
          }

          try {
            const [row] = await db
              .insert(feedback)
              .values({
                shopId: shop.id,
                shopDomain: shop.domain,
                type: args.type,
                sentiment: args.sentiment,
                message: args.message,
                context: args.context,
                source,
                status: 'new',
              })
              .returning({ id: feedback.id });

            return toolOk({
              saved: true,
              id: row?.id ?? null,
              note: 'Díky! Feedback jsme předali týmu Puls.',
            });
          } catch (err) {
            return toolError(
              err instanceof Error ? err.message : 'submit_feedback failed'
            );
          }
        }
      )
  );
}
