import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revertByTool } from '@puls/platform-core';
import type { PlatformConnector, PulsDb, Shop } from '@puls/platform-core';
import { writeLog } from '@puls/db/schema';
import { toolError, toolOk, withRequestLogging } from './usage.js';

/** Vstup nástroje revert_write. */
type RevertArgs = { write_log_id: string; confirm: 'yes' };

/**
 * Registruje MCP nástroj `revert_write`. Obnoví BEFORE stav zalogovaného
 * zápisu (audit log `write_log`) a přepne status záznamu na 'reverted'.
 *
 * Revert sémantika (mapování before → connector volání) je sdílená s
 * dashboardem write-history přes `revertByTool` z @puls/platform-core —
 * jeden zdroj pravdy pro obě cesty (dřív zkopírováno a tiše divergovalo).
 */
export function registerRevertTool(
  server: McpServer,
  shop: Shop,
  connector: PlatformConnector,
  db: PulsDb
): void {
  server.tool(
    'revert_write',
    'WRITE — revert a previously applied write by its write_log_id. Restores the BEFORE state captured at write time and marks the log entry as reverted. Only entries with status "applied" can be reverted; customer notes are not revertable; vouchers are deactivated where supported.',
    {
      write_log_id: z
        .string()
        .min(1)
        .describe('ID of the write_log entry to revert.'),
      confirm: z
        .literal('yes')
        .describe('Must be exactly "yes" — guards against accidental reverts.'),
    },
    async (args: RevertArgs) =>
      withRequestLogging(
        shop.id,
        'revert_write',
        { write_log_id: args.write_log_id },
        async () => {
          if (args.confirm !== 'yes') {
            return toolError('Refusing to revert: confirm must be exactly "yes".');
          }

          // 1) Načti řádek write_log a ověř, že patří tomuto shopu.
          const [row] = await db
            .select()
            .from(writeLog)
            .where(
              and(
                eq(writeLog.id, args.write_log_id),
                eq(writeLog.shopId, shop.id)
              )
            )
            .limit(1);
          if (!row) {
            return toolError('Záznam write_log nenalezen pro tento e-shop.');
          }

          // 2) Revert jde jen u applied záznamů.
          if (row.status !== 'applied') {
            return toolError(
              `Revert nelze: záznam má status ${row.status} (reverted/failed nelze vracet).`
            );
          }

          // 3) Dispatch dle nástroje — obnov BEFORE stav (sdílená logika).
          const dispatchError = await revertByTool(connector, shop, db, row);
          if (dispatchError) return toolError(dispatchError);

          // 4) Označ záznam jako revertovaný.
          await db
            .update(writeLog)
            .set({ status: 'reverted', revertedAt: new Date() })
            .where(eq(writeLog.id, row.id));

          return toolOk({
            ok: true,
            reverted: true,
            write_log_id: row.id,
          });
        }
      )
  );
}
