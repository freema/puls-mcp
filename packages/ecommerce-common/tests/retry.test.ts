import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { applyRetryInterceptors } from '../src/retry.js';

/**
 * Axios klient s mock adapterem, který vrací odpovědi ze scriptu (jedna na každý
 * (re)try). Adapter běží UVNITŘ axios pipeline, takže registrované response
 * interceptory (retry) se reálně spustí — na rozdíl od mocku `client.request`,
 * který by je obešel.
 */
function scriptedClient(statuses: number[]): {
  client: AxiosInstance;
  adapter: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const adapter = vi.fn(async (config): Promise<AxiosResponse> => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return {
      status,
      statusText: '',
      headers: {},
      config,
      data: null,
    } as AxiosResponse;
  });
  const client = axios.create({ validateStatus: () => true, adapter });
  return { client, adapter };
}

describe('applyRetryInterceptors', () => {
  it('429 → retries once, then returns the retried response', async () => {
    const { client, adapter } = scriptedClient([429, 200]);
    applyRetryInterceptors(client, { rateLimitMaxWaitSec: 0 });
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(200);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('429 twice → single retry guard, no infinite loop', async () => {
    const { client, adapter } = scriptedClient([429, 429]);
    applyRetryInterceptors(client, { rateLimitMaxWaitSec: 0 });
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(429);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('423 lock → waits and retries once', async () => {
    const { client } = scriptedClient([423, 200]);
    applyRetryInterceptors(client, { lockWaitMs: 0 });
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(200);
  });

  it('401 → invalidates token and retries once', async () => {
    const { client } = scriptedClient([401, 200]);
    const onTokenInvalidate = vi.fn().mockResolvedValue(undefined);
    applyRetryInterceptors(client, { onTokenInvalidate });
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(200);
    expect(onTokenInvalidate).toHaveBeenCalledTimes(1);
  });

  it('401 without onTokenInvalidate → returns 401 unchanged', async () => {
    const { client } = scriptedClient([401, 200]);
    applyRetryInterceptors(client, {});
    const res = await client.request({ url: '/x' });
    expect(res.status).toBe(401);
  });
});
