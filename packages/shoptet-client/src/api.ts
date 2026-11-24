import axios, { AxiosHeaders, type AxiosInstance } from 'axios';
import { applyRetryInterceptors, type LogFn } from '@puls/ecommerce-common';
import type { Shop } from './types.js';
import {
  getApiAccessToken,
  invalidateApiAccessToken,
  type PulsDb,
} from './token-cache.js';

function resolveBaseURL(shop: Shop): string {
  const base = shop.apiBaseUrl?.trim() || process.env.SHOPTET_API_BASE_URL?.trim();
  if (!base) throw new Error('Missing Shoptet API base URL');
  return base.replace(/\/$/, '');
}

export function createShoptetApiClient(
  shop: Shop,
  db: PulsDb,
  log: LogFn = (...args) => {
    console.info(...args);
  }
): AxiosInstance {
  const client = axios.create({
    baseURL: resolveBaseURL(shop),
    validateStatus: () => true,
  });

  client.interceptors.request.use(async (config) => {
    const token = await getApiAccessToken(shop, db);
    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    config.headers = headers;
    return config;
  });

  // Retry mechanika (401 invalidate, 423 lock-wait 5s, 429 Retry-After cap 30s)
  // žije v @puls/ecommerce-common; Shoptet jen dodá token-invalidaci. Default
  // statusy/timingy enginu kopírují dnešní Shoptet chování (žádná regrese).
  applyRetryInterceptors(client, {
    log,
    onTokenInvalidate: async () => {
      await invalidateApiAccessToken(shop, db);
      // Warm the cache before the retry replays the request (zachová dnešní pořadí).
      await getApiAccessToken(shop, db);
    },
  });

  return client;
}
