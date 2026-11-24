import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseRetryAfterMs,
  buildBasicAuthHeader,
  createConcurrencyGate,
  applyRateLimitBackoff,
  createUpgatesClient,
  upgatesRequest,
  RATE_LIMIT_LOW_THRESHOLD,
  __resetRateLimitState,
  __getRateLimitRemaining,
  MAX_CONCURRENCY,
} from '../src/http.js';
import { extractUpgatesError, UpgatesRateLimitError } from '../src/errors.js';
import {
  runWithInteractiveBudget,
  isRateLimitError,
} from '@puls/platform-core';

describe('parseRetryAfterMs', () => {
  it('parses GMT timestamp into delay relative to now', () => {
    const now = Date.parse('Wed, 21 Oct 2025 07:28:00 GMT');
    const retryAt = 'Wed, 21 Oct 2025 07:28:10 GMT';
    expect(parseRetryAfterMs(retryAt, now)).toBe(10_000);
  });

  it('clamps past timestamps to 0 (never negative)', () => {
    const now = Date.parse('Wed, 21 Oct 2025 07:28:30 GMT');
    const retryAt = 'Wed, 21 Oct 2025 07:28:00 GMT';
    expect(parseRetryAfterMs(retryAt, now)).toBe(0);
  });

  it('caps very long waits at 60s', () => {
    const now = Date.parse('Wed, 21 Oct 2025 07:00:00 GMT');
    const retryAt = 'Wed, 21 Oct 2025 09:00:00 GMT';
    expect(parseRetryAfterMs(retryAt, now)).toBe(60_000);
  });

  it('falls back to seconds when value is numeric', () => {
    expect(parseRetryAfterMs('5', 0)).toBe(5000);
  });

  it('defaults to 1s when header missing', () => {
    expect(parseRetryAfterMs(undefined, 0)).toBe(1000);
  });
});

describe('buildBasicAuthHeader', () => {
  it('builds Basic base64(apiUser:apiKey)', () => {
    expect(buildBasicAuthHeader('login', 'secret')).toBe(
      `Basic ${Buffer.from('login:secret').toString('base64')}`
    );
  });
});

describe('createConcurrencyGate', () => {
  it('never runs more than `max` tasks concurrently', async () => {
    const gate = createConcurrencyGate(MAX_CONCURRENCY);
    let active = 0;
    let peak = 0;
    const task = () =>
      gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all(Array.from({ length: 12 }, task));
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
    expect(peak).toBeGreaterThan(0);
  });

  it('drains the queue so every task completes', async () => {
    const gate = createConcurrencyGate(2);
    let done = 0;
    await Promise.all(
      Array.from({ length: 7 }, () =>
        gate.run(async () => {
          done += 1;
        })
      )
    );
    expect(done).toBe(7);
    expect(gate.active).toBe(0);
  });
});

describe('rate-limit proactive backoff', () => {
  beforeEach(() => __resetRateLimitState());
  afterEach(() => __resetRateLimitState());

  it('does not throttle when no remaining is known yet', async () => {
    let slept = 0;
    const waited = await applyRateLimitBackoff(async (ms) => {
      slept = ms;
    });
    expect(waited).toBe(0);
    expect(slept).toBe(0);
  });

  it('records the lowest *-Remaining from response headers via the interceptor', async () => {
    const client = createUpgatesClient(
      { apiBaseUrl: 'http://mock', apiUser: 'u', apiKey: 'k' },
      () => {}
    );
    // Custom adapter — žádná síť; vrátí 200 s nízkým zůstatkem poolu.
    await client.request({
      url: '/api/v2/orders',
      adapter: async (config) => ({
        data: { orders: [] },
        status: 200,
        statusText: 'OK',
        headers: {
          'x-rate-limit-hour-remaining': '50',
          'x-rate-limit-day-remaining': '2', // nejnižší pool
          'x-rate-limit-total-remaining': '900',
        },
        config,
      }),
    });
    expect(__getRateLimitRemaining()).toBe(2);
  });

  it('throttles the next request when a pool dropped below the threshold', async () => {
    const client = createUpgatesClient(
      { apiBaseUrl: 'http://mock', apiUser: 'u', apiKey: 'k' },
      () => {}
    );
    await client.request({
      url: '/api/v2/orders',
      adapter: async (config) => ({
        data: { orders: [] },
        status: 200,
        statusText: 'OK',
        headers: { 'x-rate-limit-hour-remaining': '1' },
        config,
      }),
    });
    expect(__getRateLimitRemaining()).toBeLessThan(RATE_LIMIT_LOW_THRESHOLD);

    let slept = 0;
    const waited = await applyRateLimitBackoff(async (ms) => {
      slept = ms;
    });
    expect(waited).toBeGreaterThan(0);
    expect(slept).toBeGreaterThan(0);
    // Po backoffu se známý stav vynuluje (čeká na čerstvou hlavičku z dalšího okna).
    expect(__getRateLimitRemaining()).toBeUndefined();
  });

  it('upgatesRequest records remaining and runs through the gate (healthy pool → no throttle)', async () => {
    const client = createUpgatesClient(
      { apiBaseUrl: 'http://mock', apiUser: 'u', apiKey: 'k' },
      () => {}
    );
    // Zdravý pool → žádný backoff (nehrozí 30s real sleep), request projde gate.
    const res = await upgatesRequest<{ orders: unknown[] }>(client, {
      url: '/api/v2/orders',
      adapter: async (config) => ({
        data: { orders: [] },
        status: 200,
        statusText: 'OK',
        headers: { 'x-rate-limit-hour-remaining': '40' },
        config,
      }),
    });
    expect(res.status).toBe(200);
    expect(__getRateLimitRemaining()).toBe(40);
  });
});

describe('rate-limit interactive budget (fail-fast)', () => {
  beforeEach(() => __resetRateLimitState());
  afterEach(() => __resetRateLimitState());

  /** Nastaví známý nízký zůstatek poolu přes response interceptor. */
  async function primeLowPool(): Promise<void> {
    const client = createUpgatesClient(
      { apiBaseUrl: 'http://mock', apiUser: 'u', apiKey: 'k' },
      () => {}
    );
    await client.request({
      url: '/api/v2/orders',
      adapter: async (config) => ({
        data: { orders: [] },
        status: 200,
        statusText: 'OK',
        headers: { 'x-rate-limit-hour-remaining': '1' },
        config,
      }),
    });
    expect(__getRateLimitRemaining()).toBeLessThan(RATE_LIMIT_LOW_THRESHOLD);
  }

  it('caps the proactive wait to the remaining interactive budget', async () => {
    await primeLowPool();
    let slept = 0;
    const waited = await runWithInteractiveBudget(
      () =>
        applyRateLimitBackoff(async (ms) => {
          slept = ms;
        }),
      10_000
    );
    // Plný backoff je 30s, ale rozpočet je jen 10s → ořízne na 10s.
    expect(waited).toBe(10_000);
    expect(slept).toBe(10_000);
  });

  it('fail-fasts with UpgatesRateLimitError once the budget is exhausted', async () => {
    await primeLowPool();
    let slept = 0;
    // Rozpočet 0 → žádný další sleep, rovnou rate-limit chyba.
    await expect(
      runWithInteractiveBudget(
        () =>
          applyRateLimitBackoff(async (ms) => {
            slept = ms;
          }),
        0
      )
    ).rejects.toBeInstanceOf(UpgatesRateLimitError);
    expect(slept).toBe(0);
  });

  it('background path (no budget) keeps the full patient backoff', async () => {
    await primeLowPool();
    let slept = 0;
    const waited = await applyRateLimitBackoff(async (ms) => {
      slept = ms;
    });
    expect(waited).toBe(30_000);
    expect(slept).toBe(30_000);
  });

  it('isRateLimitError recognises the 429 error and ignores others', () => {
    expect(isRateLimitError(new UpgatesRateLimitError())).toBe(true);
    expect(isRateLimitError(new Error('boom'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('extractUpgatesError', () => {
  it('extracts errors[0].message from the envelope', () => {
    const res = { status: 400, data: { errors: [{ message: 'bad input' }] } };
    expect(extractUpgatesError(res as never)).toBe('bad input');
  });

  it('falls back to HTTP status when no envelope', () => {
    const res = { status: 404, data: {} };
    expect(extractUpgatesError(res as never)).toBe('HTTP 404');
  });
});
