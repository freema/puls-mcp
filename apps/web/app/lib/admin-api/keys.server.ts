import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { adminApiKeys } from '@puls/db/schema';
import type { DB } from '~/lib/db';

const KEY_PREFIX = 'pmcp_admin_';
const KEY_BYTES = 32;
const PREFIX_DISPLAY_LEN = KEY_PREFIX.length + 8;

export type AdminApiKeyRow = {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function hashKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export function generatePlainKey(): string {
  return KEY_PREFIX + randomBytes(KEY_BYTES).toString('hex');
}

export async function createAdminApiKey(
  db: DB,
  args: { label: string; createdByUserId: string }
): Promise<{ row: AdminApiKeyRow; plainKey: string }> {
  const label = args.label.trim();
  if (!label) throw new Error('label is required');

  const plainKey = generatePlainKey();
  const keyHash = hashKey(plainKey);
  const keyPrefix = plainKey.slice(0, PREFIX_DISPLAY_LEN);

  const [inserted] = await db
    .insert(adminApiKeys)
    .values({
      label,
      keyHash,
      keyPrefix,
      createdByUserId: args.createdByUserId,
    })
    .returning({
      id: adminApiKeys.id,
      label: adminApiKeys.label,
      keyPrefix: adminApiKeys.keyPrefix,
      createdAt: adminApiKeys.createdAt,
      lastUsedAt: adminApiKeys.lastUsedAt,
      revokedAt: adminApiKeys.revokedAt,
    });
  if (!inserted) throw new Error('failed to insert admin api key');
  return { row: inserted, plainKey };
}

export async function listAdminApiKeys(db: DB): Promise<AdminApiKeyRow[]> {
  return db
    .select({
      id: adminApiKeys.id,
      label: adminApiKeys.label,
      keyPrefix: adminApiKeys.keyPrefix,
      createdAt: adminApiKeys.createdAt,
      lastUsedAt: adminApiKeys.lastUsedAt,
      revokedAt: adminApiKeys.revokedAt,
    })
    .from(adminApiKeys)
    .orderBy(desc(adminApiKeys.createdAt));
}

export async function revokeAdminApiKey(db: DB, id: string): Promise<void> {
  await db
    .update(adminApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminApiKeys.id, id), isNull(adminApiKeys.revokedAt)));
}

export type ValidatedAdminKey = {
  id: string;
  label: string;
};

/**
 * Validates a Bearer token from `Authorization` header. Returns the key
 * row when active, or null when missing/invalid/revoked. Updates
 * `lastUsedAt` on successful validation (best-effort).
 */
export async function validateAdminApiKey(
  db: DB,
  authHeader: string | null
): Promise<ValidatedAdminKey | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const plain = m[1].trim();
  if (!plain.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(plain);
  const rows = await db
    .select({
      id: adminApiKeys.id,
      label: adminApiKeys.label,
      revokedAt: adminApiKeys.revokedAt,
    })
    .from(adminApiKeys)
    .where(eq(adminApiKeys.keyHash, keyHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;

  void db
    .update(adminApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(adminApiKeys.id, row.id))
    .catch(() => {
      // best-effort
    });

  return { id: row.id, label: row.label };
}

/**
 * Throws a 401 Response if the request lacks a valid admin api key.
 * Use in resource routes that serve the public Admin API.
 */
export async function requireAdminApiKey(
  db: DB,
  request: Request
): Promise<ValidatedAdminKey> {
  const key = await validateAdminApiKey(
    db,
    request.headers.get('Authorization')
  );
  if (!key) {
    throw new Response(
      JSON.stringify({ error: 'unauthorized' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="puls-admin"',
        },
      }
    );
  }
  return key;
}
