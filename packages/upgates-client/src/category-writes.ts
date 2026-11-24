import type {
  Shop,
  CategoryCreate,
  CategoryPatch,
  CategoryDescriptionPatch,
  CategoryWriteResponse,
} from '@puls/platform-core';
import { createUpgatesApiClient, upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';
import { resolveDefaultLangCurrency } from './writes.js';

/**
 * Upgates write operace kategorií (`/api/v2/categories`):
 * - `POST` body `{categories:[{...}]}` (POLE; tree pořadí: rodiče před potomky),
 * - `PUT`  body `{categories:[{code|category_id, ...}]}` (páruje přes code),
 * - `DELETE ?code=` (query; maže i podstrom).
 * Systémové root kategorie (`parent_id: null`) API odmítne — chybu surfacujeme
 * z `*_yn:false` + `messages` (žádný client-side root guard, spoléháme na API).
 *
 * BEZ single-GET endpointu na kategorii: read-back/response skládáme z POST/PUT
 * odpovědi + vstupu (žádné mirrorování jazyků jako u produktů — descriptions se
 * píšou v default jazyce eshopu, multi-lang jen když je klient pošle explicitně).
 */

const CATEGORIES_PATH = '/api/v2/categories';

type CatWriteRow = {
  code?: string;
  category_id?: number | string;
  inserted_yn?: boolean;
  updated_yn?: boolean;
  deleted_yn?: boolean;
  messages?: Array<{ property?: string; message?: string }>;
};

function catWriteError(
  rows: CatWriteRow[] | undefined,
  flag: 'inserted_yn' | 'updated_yn' | 'deleted_yn'
): string | null {
  const failed = (rows ?? []).filter((r) => r[flag] === false);
  if (failed.length === 0) return null;
  return failed
    .map(
      (r) =>
        `${r.code ?? r.category_id ?? '?'}: ${(r.messages ?? [])
          .map((m) => `${m.property ?? ''} ${m.message ?? ''}`.trim())
          .join('; ') || 'rejected'}`
    )
    .join(' | ');
}

function buildCategoryDescriptions(
  name: string | undefined,
  descriptions: CategoryDescriptionPatch[] | undefined,
  defaultLang: string
): Array<Record<string, unknown>> | undefined {
  if (descriptions && descriptions.length > 0) {
    return descriptions.map((d) => ({
      language: d.language ?? defaultLang,
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.nameH1 !== undefined ? { name_h1: d.nameH1 } : {}),
      ...(d.shortDescription !== undefined
        ? { short_description_text: d.shortDescription }
        : {}),
      ...(d.description !== undefined
        ? { description_text: d.description }
        : {}),
      ...(d.seoTitle !== undefined ? { seo_title: d.seoTitle } : {}),
      ...(d.seoDescription !== undefined
        ? { seo_description: d.seoDescription }
        : {}),
      ...(d.seoUrl !== undefined ? { seo_url: d.seoUrl } : {}),
    }));
  }
  if (name !== undefined) return [{ language: defaultLang, name }];
  return undefined;
}

function buildCategoryBody(
  input: {
    code?: string;
    name?: string;
    parentCode?: string;
    parentGuid?: string;
    position?: number;
    active?: boolean;
    showInMenu?: boolean;
    descriptions?: CategoryDescriptionPatch[];
    imageUrls?: string[];
  },
  defaultLang: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.code !== undefined) out.code = input.code;
  if (input.parentCode !== undefined) out.parent_code = input.parentCode;
  if (input.parentGuid !== undefined) out.parent_id = Number(input.parentGuid);
  if (input.position !== undefined) out.position = input.position;
  if (input.active !== undefined) out.active_yn = input.active;
  if (input.showInMenu !== undefined) out.show_in_menu_yn = input.showInMenu;
  const descs = buildCategoryDescriptions(
    input.name,
    input.descriptions,
    defaultLang
  );
  if (descs) out.descriptions = descs;
  if (input.imageUrls && input.imageUrls.length > 0) {
    out.images = input.imageUrls.map((url) => ({ url }));
  }
  return out;
}

export async function createCategory(
  shop: Shop,
  args: { category: CategoryCreate }
): Promise<CategoryWriteResponse> {
  const c = args.category;
  if (!c.code) throw new Error('createCategory: missing category code');
  if (!c.name && !(c.descriptions && c.descriptions.length > 0)) {
    throw new Error('createCategory: missing name');
  }
  const client = createUpgatesApiClient(shop);
  const { language } = await resolveDefaultLangCurrency(client);
  const body = buildCategoryBody(
    {
      code: c.code,
      name: c.name,
      parentCode: c.parentCode,
      parentGuid: c.parentGuid,
      position: c.position,
      active: c.active ?? true,
      showInMenu: c.showInMenu,
      descriptions: c.descriptions,
      imageUrls: c.imageUrls,
    },
    language
  );
  const res = await upgatesRequest<unknown>(client, {
    method: 'POST',
    url: CATEGORIES_PATH,
    data: { categories: [body] },
  });
  if (res.status >= 400) {
    throw new Error(`createCategory failed: ${extractUpgatesError(res)}`);
  }
  const rows = (res.data as { categories?: CatWriteRow[] } | undefined)
    ?.categories;
  const err = catWriteError(rows, 'inserted_yn');
  if (err) {
    // LIVE ZJIŠTĚNO (tester 2026-06-09): bez rodiče API vrací "parent_id
    // missing" — root smí jen systémové kategorie. Akční hint, ať klient ví,
    // co poslat, místo aby hádal.
    const hint =
      !c.parentCode && !c.parentGuid
        ? ' — this platform requires a parent category: pass parentCode (pick an existing category via list_categories)'
        : '';
    throw new Error(`createCategory rejected: ${err}${hint}`);
  }
  const row = rows?.[0];
  const guid = String(row?.category_id ?? c.code);
  return {
    data: { guid, code: c.code, name: c.name, parentGuid: c.parentGuid ?? null },
  };
}

export async function updateCategory(
  shop: Shop,
  args: { guid: string; patch: CategoryPatch }
): Promise<CategoryWriteResponse> {
  if (!args.guid) throw new Error('updateCategory: missing category guid');
  if (!args.patch || Object.keys(args.patch).length === 0) {
    throw new Error('updateCategory: empty patch');
  }
  const client = createUpgatesApiClient(shop);
  const { language } = await resolveDefaultLangCurrency(client);
  // guid = code (mapCategory preferuje code); PUT páruje přes code.
  const body = buildCategoryBody({ code: args.guid, ...args.patch }, language);
  const res = await upgatesRequest<unknown>(client, {
    method: 'PUT',
    url: CATEGORIES_PATH,
    data: { categories: [body] },
  });
  if (res.status >= 400) {
    throw new Error(`updateCategory failed: ${extractUpgatesError(res)}`);
  }
  const rows = (res.data as { categories?: CatWriteRow[] } | undefined)
    ?.categories;
  const err = catWriteError(rows, 'updated_yn');
  if (err) {
    throw new Error(
      `updateCategory rejected (systémovou root kategorii nelze měnit?): ${err}`
    );
  }
  return {
    data: {
      guid: args.guid,
      code: args.guid,
      name: args.patch.name,
      parentGuid: args.patch.parentGuid ?? null,
    },
  };
}

export async function deleteCategory(
  shop: Shop,
  args: { guid: string }
): Promise<{ data: { guid: string; deleted: true } }> {
  if (!args.guid) throw new Error('deleteCategory: missing category guid');
  const client = createUpgatesApiClient(shop);
  const res = await upgatesRequest<unknown>(client, {
    method: 'DELETE',
    url: CATEGORIES_PATH,
    params: { code: args.guid },
  });
  if (res.status >= 400) {
    throw new Error(`deleteCategory failed: ${extractUpgatesError(res)}`);
  }
  const rows = (res.data as { categories?: CatWriteRow[] } | undefined)
    ?.categories;
  const err = catWriteError(rows, 'deleted_yn');
  if (err) {
    throw new Error(
      `deleteCategory rejected (systémovou root kategorii nelze smazat?): ${err}`
    );
  }
  return { data: { guid: args.guid, deleted: true } };
}
