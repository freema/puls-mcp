import type { Shop, ManufacturerListResponse } from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';

/** Reálné API: /api/v2/manufacturers → {manufacturers:[{manufacturer_id, name}]}. */
export const MANUFACTURERS_PATH = '/api/v2/manufacturers';

export type UpgatesManufacturerRaw = {
  manufacturer_id?: number | string;
  name?: string;
};

export function extractManufacturers(body: unknown): UpgatesManufacturerRaw[] {
  const b = body as { manufacturers?: UpgatesManufacturerRaw[] } | undefined;
  return b?.manufacturers ?? [];
}

/**
 * Číselník výrobců eshopu (neutrální `{id, name}`). Backing pro nástroj
 * `list_manufacturers` i pro `resolveManufacturerId` ve write cestě (klient si
 * tak ověří platné názvy před create/update produktu).
 */
export async function listManufacturers(
  shop: Shop
): Promise<ManufacturerListResponse> {
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'GET',
    url: MANUFACTURERS_PATH,
  });
  if (res.status >= 400) {
    throw new Error(`listManufacturers failed: ${extractUpgatesError(res)}`);
  }
  return {
    data: extractManufacturers(res.data)
      .filter((m) => m.manufacturer_id != null && m.name)
      .map((m) => ({ id: String(m.manufacturer_id), name: String(m.name) })),
  };
}
