import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { PulsDb } from '@puls/platform-core';
import * as pulsSchema from '@puls/db/schema';

let pg: ReturnType<typeof postgres> | null = null;
let db: PulsDb | null = null;

export function getDb(): PulsDb {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for mcp-server');
  }
  pg = postgres(url, { max: 5 });
  db = drizzle(pg, { schema: pulsSchema });
  return db;
}
