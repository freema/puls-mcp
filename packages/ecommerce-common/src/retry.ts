import {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { LogFn } from './logging.js';
import { consoleLog } from './logging.js';

/**
 * Per-request retry guards — každá strategie se na konkrétní request smí pokusit
 * jen jednou (jinak nekonečná smyčka). Drží se na config objektu requestu.
 */
type ReqWithRetry = InternalAxiosRequestConfig & {
  __retry401?: boolean;
  __retry423?: boolean;
  __retry429?: boolean;
};

export interface RetryInterceptorOptions {
  /**
   * 401 → invalidace tokenu + jeden retry. Callback smaže cache a vynutí fresh
   * token (Shoptet: delete `api_token_cache` + `getApiAccessToken`). Když chybí,
   * 401 retry se přeskočí (platformy se statickým auth, např. Upgates Basic).
   */
  onTokenInvalidate?: () => Promise<void>;
  /**
   * Status značící zamčený resource (Shoptet 423). Po něm se čeká `lockWaitMs`
   * a request se zopakuje jednou. `null` strategii vypne.
   */
  lockStatus?: number | null;
  lockWaitMs?: number;
  /**
   * Status rate-limitu (429). Po něm se čeká dle `Retry-After` (sekundy) capnuté
   * na `rateLimitMaxWaitSec` a request se zopakuje jednou. `null` vypne.
   */
  rateLimitStatus?: number | null;
  rateLimitDefaultWaitSec?: number;
  rateLimitMaxWaitSec?: number;
  /**
   * Hlavička, kterou platforma vrací s naplněním rate-limit bucketu — logujeme.
   * `null` logování vypne.
   */
  bucketHeader?: string | null;
  log?: LogFn;
}

/**
 * Aplikuje response interceptory řešící retry sémantiku platformního API:
 * lock (423) → wait + retry, rate-limit (429) → Retry-After wait + retry,
 * auth (401) → token invalidate + retry. Doménově neutrální — Shoptet i další
 * klienti to konfigurují přes `opts`. Default hodnoty kopírují dnešní Shoptet
 * chování (423 wait 5s, 429 Retry-After v sekundách cap 30s, 401 invalidate).
 *
 * Vrací stejnou `client` instanci (chainování).
 */
export function applyRetryInterceptors(
  client: AxiosInstance,
  opts: RetryInterceptorOptions = {}
): AxiosInstance {
  const {
    onTokenInvalidate,
    lockStatus = 423,
    lockWaitMs = 5000,
    rateLimitStatus = 429,
    rateLimitDefaultWaitSec = 1,
    rateLimitMaxWaitSec = 30,
    bucketHeader = 'x-ratelimit-bucket-filling',
    log = consoleLog,
  } = opts;

  client.interceptors.response.use(async (response) => {
    if (bucketHeader) {
      const bucket = response.headers[bucketHeader];
      if (bucket !== undefined) {
        log('X-RateLimit-Bucket-Filling', {
          value: String(bucket),
          url: response.config.url,
          status: response.status,
        });
      }
    }

    if (lockStatus !== null && response.status === lockStatus) {
      const cfg = response.config as ReqWithRetry;
      if (cfg.__retry423) return response;
      cfg.__retry423 = true;
      await new Promise((r) => setTimeout(r, lockWaitMs));
      return client.request(cfg);
    }

    if (rateLimitStatus !== null && response.status === rateLimitStatus) {
      const cfg429 = response.config as ReqWithRetry;
      if (cfg429.__retry429) return response;
      cfg429.__retry429 = true;
      const ra = response.headers['retry-after'];
      const waitSec = ra ? Number(ra) : rateLimitDefaultWaitSec;
      const effectiveSec = Number.isFinite(waitSec)
        ? waitSec
        : rateLimitDefaultWaitSec;
      await new Promise((r) =>
        setTimeout(r, Math.min(effectiveSec, rateLimitMaxWaitSec) * 1000)
      );
      return client.request(cfg429);
    }

    if (response.status !== 401 || !onTokenInvalidate) return response;

    const cfg = response.config as ReqWithRetry;
    if (cfg.__retry401) return response;
    cfg.__retry401 = true;

    await onTokenInvalidate();
    return client.request(cfg);
  });

  return client;
}
