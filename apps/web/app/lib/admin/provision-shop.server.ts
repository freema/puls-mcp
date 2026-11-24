import { randomBytes } from 'node:crypto';
import { PLATFORM } from '@puls/db/schema';
import {
  buildUpgatesNormalizedShop,
  createUpgatesClient,
  fetchOwner,
} from '@puls/upgates-client';
import type { Env } from '~/lib/config';
import type { DB } from '~/lib/db';
import { persistInstall } from '~/lib/install-core';
import { assignTier } from '~/lib/pricing.server';
import { logger } from '~/lib/logger';

/**
 * Super-admin ruční provisioning Upgates obchodu — bez aktivačního flow
 * (marketplace) a bez podepsaného callbacku. Slouží k testování živého MCP
 * proti reálnému eshopu předtím, než je doplněk ve verified directory.
 *
 * Mechanika je záměrně shodná s `handleUpgatesInstall` MINUS ověření podpisu:
 *   1) Ověří API credentials proti živému eshopu (`/api/v2/owner`).
 *   2) Přes sdílený `persistInstall` zašifruje apiKey, vygeneruje interní
 *      secrety (mcpEndpointSecret) a upsertne shop řádek.
 *   3) Nastaví zvolený tarif (`admin_override`) — typicky placený, ať jdou
 *      zápisy (trial je blokuje).
 *
 * apiKey vkládá do formuláře super-admin (uloží se šifrovaně přes
 * `encryptSecret` uvnitř `persistInstall`); tady jen plaintext v paměti.
 */
export class ProvisionError extends Error {}

export type ProvisionUpgatesInput = {
  /** Upgates apiUrl (`https://<eshop>.admin.upgates.com/api/v2`). */
  apiUrl: string;
  /** Upgates API login (apiUser). */
  apiUser: string;
  /** Upgates API klíč (plaintext z formuláře — zašifruje se při persistu). */
  apiKey: string;
  /** E-mail Puls uživatele, kterému se shop připne (dashboard + OAuth výběr). */
  adminEmail: string;
  /** Cílový tarif (např. `pro`). */
  tierId: string;
  /** Volitelný platform_account_id; default = apiUser (stabilní per eshop). */
  token?: string | null;
  /** Volitelný název obchodu (jinak z `/owner`). */
  name?: string | null;
};

export type ProvisionResult = {
  shopId: string;
  domain: string;
  isNew: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  tierId: string;
};

export async function provisionUpgatesShop(
  db: DB,
  _env: Env,
  input: ProvisionUpgatesInput,
  changedBy: string
): Promise<ProvisionResult> {
  const apiUrl = input.apiUrl.trim();
  const apiUser = input.apiUser.trim();
  const apiKey = input.apiKey.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const tierId = input.tierId.trim();
  const token = input.token?.trim() || apiUser;

  if (!apiUrl || !apiUser || !apiKey) {
    throw new ProvisionError(
      'apiUrl, apiUser i apiKey jsou povinné.'
    );
  }
  if (!adminEmail.includes('@')) {
    throw new ProvisionError('Zadej platný e-mail uživatele.');
  }

  // 1) Ověř credentials proti živému eshopu. `validateStatus: () => true` →
  //    klient nehází na 4xx, čteme status ručně. Síťová chyba (ENOTFOUND,
  //    ECONNREFUSED) hodí → převedeme na čitelnou chybu.
  const client = createUpgatesClient(
    { apiBaseUrl: apiUrl, apiUser, apiKey },
    () => {}
  );
  let status: number;
  try {
    const probe = await client.request({
      method: 'GET',
      url: '/api/v2/owner',
    });
    status = probe.status;
  } catch (err) {
    throw new ProvisionError(
      `Upgates API je nedostupné z naší infry (${
        err instanceof Error ? err.message : 'network error'
      }). Zkontroluj apiUrl.`
    );
  }
  if (status === 401 || status === 403) {
    throw new ProvisionError(
      `Upgates API odmítlo přihlašovací údaje (HTTP ${status}). Zkontroluj apiUser a apiKey.`
    );
  }
  if (status >= 500) {
    throw new ProvisionError(
      `Upgates API momentálně neodpovídá (HTTP ${status}). Zkus to za chvíli.`
    );
  }

  // Owner lookup pro auto-doplnění názvu (defenzivní — nikdy nehodí).
  const owner = await fetchOwner(client);

  // 2) Persist přes sdílenou cestu (šifrování apiKey + interní secrety).
  const webhookSecret = `upg_wh_${randomBytes(24).toString('hex')}`;
  const normalized = buildUpgatesNormalizedShop({
    token,
    apiUser,
    apiKey,
    apiUrl,
    name: input.name?.trim() || owner.name,
    // POZOR: adminEmail = cílový Puls uživatel (dashboard), NE owner z Upgatesu.
    adminEmail,
    webhookSecret,
  });
  const persisted = await persistInstall(db, normalized);

  // 3) Nastav zvolený tarif (persistInstall dal trial/starter — přepiš).
  try {
    await assignTier(db, {
      shopId: persisted.shopId,
      platform: PLATFORM.UPGATES,
      platformAccountId: token,
      tierId,
      reason: 'admin_override',
      changedBy,
    });
  } catch (err) {
    throw new ProvisionError(
      `Shop vznikl, ale nepodařilo se nastavit tarif '${tierId}': ${
        err instanceof Error ? err.message : 'neznámá chyba'
      }`
    );
  }

  logger.info(
    {
      shopId: persisted.shopId,
      isNew: persisted.isNew,
      token,
      adminEmail,
      tierId,
      changedBy,
    },
    'admin manual upgates provision ok'
  );

  return {
    shopId: persisted.shopId,
    domain: normalized.domain,
    isNew: persisted.isNew,
    ownerEmail: owner.email,
    ownerName: owner.name,
    tierId,
  };
}
