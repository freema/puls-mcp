import { getRedis } from '~/lib/redis';

/** Fixed-window counter rate limit (Redis). */
export async function rateLimitRedis(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean }> {
  const r = getRedis();
  const redisKey = `puls:rl:${bucket}:${key}`;
  const n = await r.incr(redisKey);
  if (n === 1) {
    await r.pexpire(redisKey, windowMs);
  }
  return { ok: n <= limit };
}
