import type { Shop, CategoryListResponse } from '@puls/platform-core';
import { createUpgatesApiClient } from './http.js';
import { paginateAll } from './pagination.js';
import { mapCategory } from './mappers.js';
import type { UpgatesCategoryRaw } from './types.js';

const CATEGORIES_PATH = '/api/v2/categories';

function extractCategories(body: unknown): UpgatesCategoryRaw[] {
  const b = body as { categories?: UpgatesCategoryRaw[] } | undefined;
  return b?.categories ?? [];
}

export async function listCategories(
  shop: Shop
): Promise<CategoryListResponse> {
  const client = createUpgatesApiClient(shop);
  const raw = await paginateAll<UpgatesCategoryRaw>(
    client,
    CATEGORIES_PATH,
    {},
    extractCategories,
    'listCategories'
  );
  return { data: raw.map((c) => mapCategory(c)) };
}
