import axios, {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { Shop } from '@puls/platform-core';
import {
  decryptSecret,
  getInteractiveWaitRemaining,
  chargeInteractiveWait,
} from '@puls/platform-core';
import { UpgatesRateLimitError } from './errors.js';

type LogFn = (msg: string, meta?: Record<string, unknown>) => void;

type ReqWithRetry = InternalAxiosRequestConfig & { __retry429?: boolean };

/** Upgates: max 3 souběžné requesty (discovery sekce 4). */
export const MAX_CONCURRENCY = 3;

/** Cap na čekání po 429 — delší re-queueovat sync, ne blokovat request. */
const RETRY_AFTER_CAP_MS = 60_000;

/** Rate-limit hlavičky, které Upgates vrací a my logujeme/respektujeme. */
const RATE_LIMIT_HEADERS = [
  'x-rate-limit-hour-remaining',
  'x-rate-limit-day-remaining',
  'x-rate-limit-total-remaining',
] as const;

/**
 * Práh proaktivního backoffu: když některý `*-Remaining` pool klesne POD tuto
 * hodnotu, další request se přibrzdí (sleep), ať MCP on-demand requesty
 * neutlučou poslední tokeny poolu. Discovery sekce 4 / task sekce 1.3 bod 2.
 */
export const RATE_LIMIT_LOW_THRESHOLD = 5;

/**
 * Jak dlouho přibrzdit, když jsme pod prahem. Upgates poolы se obnovují po
 * hodinovém okně; bez znalosti přesného resetu volíme konzervativní fixní
 * backoff, aby sync neutloukl zbytek poolu. On-demand request projde po čekání.
 */
const RATE_LIMIT_BACKOFF_MS = 30_000;

/**
 * Poslední známý zůstatek rate-limit poolů (per-proces, sdílený se sdíleným
 * concurrency gate). Aktualizuje ho response interceptor z hlaviček; čte ho
 * `applyRateLimitBackoff` PŘED spuštěním requestu.
 */
const rateLimitState: { minRemaining: number | undefined } = {
  minRemaining: undefined,
};

/** Zaznamená nejnižší známý `*-Remaining` z odpovědi (proaktivní backoff). */
function recordRateLimitRemaining(remaining: number): void {
  if (!Number.isFinite(remaining)) return;
  rateLimitState.minRemaining =
    rateLimitState.minRemaining === undefined
      ? remaining
      : Math.min(rateLimitState.minRemaining, remaining);
}

/** TEST-only: vynuluj backoff stav mezi testy. */
export function __resetRateLimitState(): void {
  rateLimitState.minRemaining = undefined;
}

/** TEST-only: nahlédni do posledního známého zůstatku. */
export function __getRateLimitRemaining(): number | undefined {
  return rateLimitState.minRemaining;
}

/**
 * Proaktivní přibrzdění PŘED spuštěním requestu. Když poslední známý zůstatek
 * klesl pod práh, počká `RATE_LIMIT_BACKOFF_MS` (ať se hodinové okno posune),
 * a předpokládá, že okno mezitím doplnilo pool (zůstatek se přepíše z příští
 * odpovědi). Vrací počet ms, kolik se čekalo (0 = nebrzděno) — pro testy.
 *
 * INTERAKTIVNÍ cesta (MCP tool call má nastavený `runWithInteractiveBudget`):
 * čekání je strop­ované sdíleným rozpočtem. Smí se prospat jen tolik, kolik
 * v rozpočtu zbývá; jakmile je rozpočet vyčerpaný, místo dalšího blokujícího
 * sleepu se fail-fast vyhodí `UpgatesRateLimitError`. Tím interaktivní call
 * nikdy nenastřádá minuty backoffu a nepřeteče idle-timeout MCP proxy.
 * BACKGROUND sync worker rozpočet nenastavuje → plný trpělivý backoff jako dřív.
 */
export async function applyRateLimitBackoff(
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms))
): Promise<number> {
  const remaining = rateLimitState.minRemaining;
  if (remaining === undefined || remaining >= RATE_LIMIT_LOW_THRESHOLD) {
    return 0;
  }

  const budgetRemaining = getInteractiveWaitRemaining();
  if (budgetRemaining !== null) {
    // Interaktivní call: rozpočet vyčerpán → fail-fast, žádný další sleep.
    if (budgetRemaining <= 0) {
      throw new UpgatesRateLimitError();
    }
    const waitMs = Math.min(RATE_LIMIT_BACKOFF_MS, budgetRemaining);
    rateLimitState.minRemaining = undefined;
    await sleep(waitMs);
    chargeInteractiveWait(waitMs);
    return waitMs;
  }

  // Po čekání předpokládáme posun hodinového okna: vynuluj známý stav, ať se
  // nebrzdíme donekonečna, dokud nepřijde čerstvá hlavička z další odpovědi.
  rateLimitState.minRemaining = undefined;
  await sleep(RATE_LIMIT_BACKOFF_MS);
  return RATE_LIMIT_BACKOFF_MS;
}

/**
 * Lehký concurrency gate (semafor) bez nové dependency. Sync i on-demand sdílí
 * jednu instanci, aby Upgates nikdy neviděl > `max` souběžných requestů.
 */
export function createConcurrencyGate(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  function release(): void {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  }

  return {
    get active() {
      return active;
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/** Per-proces sdílený gate pro VŠECHNY Upgates requesty (sync + on-demand). */
const sharedGate = createConcurrencyGate(MAX_CONCURRENCY);

/**
 * `Retry-After` je u Upgatesu GMT timestamp (NE počet sekund jako u většiny API).
 * Spočítá delay v ms vůči `nowMs`; fallback na sekundy, když parse selže.
 * Cappuje na `capMs` (delší čekání nechat selhat a re-queueovat sync).
 */
export function parseRetryAfterMs(
  retryAfter: string | undefined,
  nowMs: number,
  capMs: number = RETRY_AFTER_CAP_MS
): number {
  if (!retryAfter) return 1000;
  const trimmed = retryAfter.trim();
  // Čistě numerická hodnota = počet sekund (HTTP standard fallback). Musí být
  // PŘED Date.parse — `Date.parse('5')` totiž v V8 vrací validní datum.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.min(Math.max(0, Number(trimmed)) * 1000, capMs);
  }
  // Jinak GMT timestamp ("Wed, 21 Oct 2025 07:28:00 GMT") — Upgates default.
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, asDate - nowMs), capMs);
  }
  return 1000;
}

/** `Authorization: Basic base64(apiUser:apiKey)` — statický, žádný token-exchange. */
export function buildBasicAuthHeader(apiUser: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString('base64')}`;
}

function normalizeBaseURL(base: string | null | undefined): string {
  // VŽDY z apiUrl z aktivace, NIKDY skládat ručně (server-mark subdomény
  // s50/t1…). Env je jen pro E2E Prism mock.
  const resolved = base?.trim() || process.env.UPGATES_API_BASE_URL?.trim();
  if (!resolved) throw new Error('Missing Upgates API base URL');
  // Reálná apiUrl z aktivace končí na `/api/v2`, ale request cesty klienta
  // prefix `/api/v2/...` už obsahují (kvůli Prism mocku, jehož base je bez
  // prefixu) → koncový `/api/v2` ořež, jinak vznikne `/api/v2/api/v2/...`
  // a Upgates vrátí 403. Ověřeno proti reálnému API (dev eshop, 2026-06-07).
  return resolved.replace(/\/$/, '').replace(/\/api\/v2$/, '');
}

function resolveCredentials(shop: Shop): { apiUser: string; apiKey: string } {
  const apiUser = shop.platformApiLogin?.trim();
  // apiKey je v DB šifrovaný (enc:v1:…) — dešifruj jen v paměti. decryptSecret
  // má plaintext-tolerance, takže mock/legacy plaintext credentials projdou taky.
  const apiKey = shop.platformApiKey ? decryptSecret(shop.platformApiKey).trim() : '';
  if (!apiUser || !apiKey) {
    throw new Error(
      'Missing Upgates API credentials (platformApiLogin/platformApiKey)'
    );
  }
  return { apiUser, apiKey };
}

/**
 * Jádro Upgates axios klienta z explicitních credentials (plaintext). Používá
 * ho jak read-path connectoru (přes `createUpgatesApiClient`, dešifruje z DB),
 * tak aktivační flow (task 03), který má credentials z payloadu ještě naholo a
 * potřebuje klienta dřív, než shop persistuje.
 */
export function createUpgatesClient(
  opts: { apiBaseUrl: string | null | undefined; apiUser: string; apiKey: string },
  log: LogFn = (...args) => {
    console.info(...args);
  }
): AxiosInstance {
  const authHeader = buildBasicAuthHeader(opts.apiUser, opts.apiKey);

  const client = axios.create({
    baseURL: normalizeBaseURL(opts.apiBaseUrl),
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Authorization', authHeader);
    config.headers = headers;
    return config;
  });

  client.interceptors.response.use(async (response) => {
    for (const header of RATE_LIMIT_HEADERS) {
      const value = response.headers[header];
      if (value !== undefined) {
        log('X-Rate-Limit', {
          header,
          value: String(value),
          url: response.config.url,
        });
        // Respektuj zůstatek poolu, ne jen loguj: zaznamenej nejnižší známou
        // hodnotu, ať `applyRateLimitBackoff` před dalším requestem přibrzdí.
        const remaining = Number(value);
        if (Number.isFinite(remaining)) recordRateLimitRemaining(remaining);
      }
    }

    if (response.status === 429) {
      const cfg = response.config as ReqWithRetry;
      if (cfg.__retry429) return response;
      cfg.__retry429 = true;
      const delayMs = parseRetryAfterMs(
        response.headers['retry-after'] as string | undefined,
        Date.now()
      );
      // Interaktivní call: když je Retry-After delší než zbytek rozpočtu, nemá
      // smysl částečně čekat (server nás stejně zase odmítne a hrozí IP blok po
      // 5 chybách/h) — fail-fast. Background sync čeká plně jako dřív.
      const budgetRemaining = getInteractiveWaitRemaining();
      if (budgetRemaining !== null) {
        if (delayMs > budgetRemaining) {
          throw new UpgatesRateLimitError();
        }
        chargeInteractiveWait(delayMs);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      return client.request(cfg);
    }

    return response;
  });

  return client;
}

/**
 * Axios instance pro persistovaný `Shop`: dešifruje credentials z DB a deleguje
 * na `createUpgatesClient`. Read-path connectoru (orders/products/…) volá tohle.
 */
export function createUpgatesApiClient(
  shop: Shop,
  log?: LogFn
): AxiosInstance {
  const { apiUser, apiKey } = resolveCredentials(shop);
  return createUpgatesClient(
    { apiBaseUrl: shop.apiBaseUrl, apiUser, apiKey },
    log
  );
}

/**
 * Každý Upgates HTTP call protéká sdíleným concurrency gate (≤ 3) a proaktivním
 * rate-limit backoffem: když poslední známý `*-Remaining` klesl pod práh, počká
 * (sleep do nového okna), než request spustí. Tím se sdílený pool nevyčerpá a
 * MCP on-demand requesty se neutlučou se sync workerem.
 */
export async function upgatesRequest<T = unknown>(
  client: AxiosInstance,
  config: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  await applyRateLimitBackoff();
  return sharedGate.run(() => client.request<T>(config));
}
