import type { Shop, EshopMetaResponse } from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';
import { mapEshopFromLanguages } from './mappers.js';
import type { UpgatesLanguageRaw } from './types.js';

// Reálné Upgates API v2 žádný `/eshop` resource nemá (ověřeno proti
// dev eshop, 2026-06-07: /eshop, /eshops, /eshop-info i /properties → 403).
// Eshop meta skládáme z `/api/v2/languages`: default jazyk nese doménu
// eshopu (`domain`) i měnu (`currency_id`); jméno shopu doplníme z naší DB.
const LANGUAGES_PATH = '/api/v2/languages';

export async function getEshopInfo(shop: Shop): Promise<EshopMetaResponse> {
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: LANGUAGES_PATH,
  });
  if (res.status >= 400) {
    throw new Error(`getEshopInfo failed: ${extractUpgatesError(res)}`);
  }
  const body = res.data as { languages?: UpgatesLanguageRaw[] } | undefined;
  const langs = body?.languages ?? [];
  return { data: mapEshopFromLanguages(langs, shop.name) };
}
