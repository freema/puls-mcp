import type { NormalizedShop } from '@puls/platform-core';
import { PLATFORM } from '@puls/platform-core';

/** Vstup Upgates aktivace po ověření podpisu (task 03). */
export interface UpgatesInstallInput {
  /** Identita eshopu z payloadu → `shops.platform_account_id`. */
  token: string;
  apiUser: string;
  apiKey: string;
  apiUrl: string;
  name?: string | null;
  /** Z `/owner` lookupu; null = párování dokončí klient přihlášením v iframu. */
  adminEmail?: string | null;
  /** Per-shop webhook secret (generuje web vrstva, registruje se u Upgates). */
  webhookSecret: string;
}

/**
 * Doména pro `shops.domain` (globálně unikátní, notNull). Reálné Upgates apiUrl
 * má per-eshop hostname → bereme ho. Mock/neznámý host by ale kolidoval napříč
 * instalacemi (všechny míří na stejný `mock-upgates`), proto fallback na
 * `${token}.upgates` (token je unikátní per platforma).
 */
function deriveDomain(apiUrl: string, token: string): string {
  try {
    const host = new URL(apiUrl).hostname;
    if (/\.upgates\.(com|cz|sk)$/i.test(host)) return host;
  } catch {
    // spadne na fallback
  }
  return `${token}.upgates`;
}

/** Namapuje ověřený aktivační payload na neutrální `NormalizedShop` k persistu. */
export function buildUpgatesNormalizedShop(
  input: UpgatesInstallInput
): NormalizedShop {
  return {
    platform: PLATFORM.UPGATES,
    externalId: input.token,
    domain: deriveDomain(input.apiUrl, input.token),
    adminEmail: input.adminEmail?.trim().toLowerCase() || null,
    name: input.name?.trim() || null,
    // Upgates nemá OAuth install token — Basic auth. Placeholder, ať notNull drží.
    oauthAccessToken: 'upgates-no-oauth',
    webhookSignatureKey: input.webhookSecret,
    apiBaseUrl: input.apiUrl,
    apiLogin: input.apiUser,
    apiKey: input.apiKey,
  };
}
