import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as pulsSchema from '@puls/db/schema';
import type { shops } from '@puls/db/schema';

/**
 * Platform-neutrální typ shopu — řádek tabulky `shops` (Drizzle `$inferSelect`).
 * Žije tady (ne v `@puls/shoptet-client`), protože shop není shoptet-specifický:
 * nese `platform` discriminator a obsluhuje ho zvolený `PlatformConnector`.
 */
export type Shop = typeof shops.$inferSelect;

/** Drizzle DB instance vázaná na celé Puls schéma. Platform-neutrální. */
export type PulsDb = PostgresJsDatabase<typeof pulsSchema>;
