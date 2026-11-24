import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../drizzle/schema';
import { getConfig } from './config';

export type DB = PostgresJsDatabase<typeof schema>;

let pg: ReturnType<typeof postgres> | null = null;
let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  const { DATABASE_URL } = getConfig();
  pg = postgres(DATABASE_URL, { max: 10 });
  db = drizzle(pg, { schema });
  return db;
}

/** @internal */
export async function healthDbPing(): Promise<void> {
  const client = getDb();
  await client.execute(sql`select 1`);
}
