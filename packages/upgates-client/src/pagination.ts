import type { AxiosInstance } from 'axios';
import { upgatesRequest } from './http.js';
import { extractUpgatesError } from './errors.js';

/** Bezpečnostní strop iterací stránkování. */
const MAX_PAGES = 1000;

/** Defenzivní čtení počtu stránek z wrapperu (přesné klíče `[O]`). */
function readNumberOfPages(body: unknown): number {
  const b = body as Record<string, unknown> | undefined;
  const raw = b?.number_of_pages ?? b?.numberOfPages;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Stránkuje přes `current_page` až do `number_of_pages` a posbírá položky přes
 * `extract`. Respektuje rate-limit gate (každý request přes `upgatesRequest`).
 * Přesné názvy stránkovacího wrapperu jsou `[O]` — číst defenzivně.
 *
 * `limit` (volitelné) přidá early-exit: jakmile je nasbíráno aspoň `limit`
 * položek, přestane stránkovat — `limit: 10` tak na velkém eshopu netáhne celou
 * historii (šetří rate-limit budget). Pořadí napříč stránkami se nemění, takže
 * volající, kteří potřebují deterministický výběr (např. inkrementální sync),
 * `limit` NEpředávají a řadí si sami.
 */
export async function paginateAll<T>(
  client: AxiosInstance,
  path: string,
  params: Record<string, unknown>,
  extract: (body: unknown) => T[],
  label = 'paginateAll',
  limit?: number
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: path,
      params: { ...params, page },
    });
    if (res.status >= 400) {
      throw new Error(`${label} failed: ${extractUpgatesError(res)}`);
    }
    all.push(...extract(res.data));
    if (limit != null && all.length >= limit) break;
    totalPages = readNumberOfPages(res.data);
    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);
  return all;
}
