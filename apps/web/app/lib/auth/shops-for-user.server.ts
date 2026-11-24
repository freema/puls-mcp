import { and, isNotNull, ne, sql } from 'drizzle-orm';
import { shops } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getConfig } from '~/lib/config';

export async function listShopsForEmail(db: DB, email: string) {
  const normalized = email.trim().toLowerCase();
  return db
    .select({
      id: shops.id,
      platform: shops.platform,
      platformAccountId: shops.platformAccountId,
      domain: shops.domain,
      name: shops.name,
      status: shops.status,
      adminEmail: shops.adminEmail,
      installedAt: shops.installedAt,
    })
    .from(shops)
    .where(
      and(
        isNotNull(shops.adminEmail),
        sql`lower(${shops.adminEmail}) = ${normalized}`,
        ne(shops.status, 'UNINSTALLED')
      )
    );
}

export function isAdminEmail(email: string): boolean {
  const env = getConfig();
  const target = email.trim().toLowerCase();
  return env.ADMIN_EMAIL.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}
