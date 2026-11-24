import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { shops } from '@puls/db/schema';
import { encryptSecret, type NormalizedShop } from '@puls/platform-core';
import type { DB } from './db';
import { assignTierOnInstall } from './pricing.server';

export type PersistInstallResult = {
  shopId: string;
  /** true = nový shop (přiřazen tier), false = re-instalace existujícího. */
  isNew: boolean;
  /**
   * Efektivně uložený per-shop webhook/HMAC secret. Na re-instalaci to je
   * PŮVODNÍ klíč (nerotujeme ho — rozbilo by existující registrace webhooků),
   * proto ho volající musí použít pro (re)registraci, ne hodnotu z payloadu.
   */
  webhookSignatureKey: string | null;
  tierAssignment?: { tierId: string; reason: string };
};

/**
 * Jediné místo pravdy pro persist shopu napříč platformami: upsert přes
 * `(platform, platform_account_id)` + uložení (šifrovaných) Upgates credentials
 * + anti-freeride tier přiřazení. Shoptet i Upgates install ji obě volají, takže
 * tu není žádná duplikace upsert/tier logiky.
 *
 * Šifrování: `apiKey` se ukládá přes `encryptSecret` (AES-256-GCM) — v DB nikdy
 * neleží naholo. `apiLogin` (uživatelské jméno) zůstává plaintext.
 */
export async function persistInstall(
  db: DB,
  normalized: NormalizedShop
): Promise<PersistInstallResult> {
  const now = new Date();
  const encryptedApiKey =
    normalized.apiKey != null ? encryptSecret(normalized.apiKey) : null;

  const [existing] = await db
    .select({
      id: shops.id,
      webhookSignatureKey: shops.webhookSignatureKey,
    })
    .from(shops)
    .where(
      and(
        eq(shops.platform, normalized.platform),
        eq(shops.platformAccountId, normalized.externalId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(shops)
      .set({
        domain: normalized.domain,
        name: normalized.name,
        adminEmail: normalized.adminEmail,
        oauthAccessToken: normalized.oauthAccessToken,
        apiBaseUrl: normalized.apiBaseUrl,
        // Credentials rotujeme jen když je install přinesl (Upgates re-aktivace).
        // Shoptet (apiKey == null) ponechá sloupce beze změny.
        ...(normalized.apiLogin != null
          ? { platformApiLogin: normalized.apiLogin }
          : {}),
        ...(encryptedApiKey != null ? { platformApiKey: encryptedApiKey } : {}),
        status: 'ACTIVE',
        updatedAt: now,
      })
      .where(eq(shops.id, existing.id));

    // webhookSignatureKey ZÁMĚRNĚ nerotujeme (drží existující registrace).
    return {
      shopId: existing.id,
      isNew: false,
      webhookSignatureKey: existing.webhookSignatureKey,
    };
  }

  const mcpEndpointSecret = randomBytes(16).toString('hex');

  const [created] = await db
    .insert(shops)
    .values({
      platform: normalized.platform,
      platformAccountId: normalized.externalId,
      domain: normalized.domain,
      name: normalized.name,
      adminEmail: normalized.adminEmail,
      oauthAccessToken: normalized.oauthAccessToken,
      webhookSignatureKey: normalized.webhookSignatureKey,
      apiBaseUrl: normalized.apiBaseUrl,
      platformApiLogin: normalized.apiLogin ?? null,
      platformApiKey: encryptedApiKey,
      mcpEndpointSecret,
      installedAt: now,
      updatedAt: now,
    })
    .returning({ id: shops.id });

  if (!created?.id) {
    throw new Error('Failed to persist shop');
  }

  // Anti-freeride: účet, který už trial vyčerpal, dostane 'starter'
  // (reason: reinstall_no_trial), jinak 'trial'.
  const tierAssignment = await assignTierOnInstall(db, {
    shopId: created.id,
    platform: normalized.platform,
    platformAccountId: normalized.externalId,
  });

  return {
    shopId: created.id,
    isNew: true,
    webhookSignatureKey: normalized.webhookSignatureKey,
    tierAssignment,
  };
}
