import { Redis } from 'ioredis';

let client: Redis | null | undefined;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client === undefined) {
    try {
      client = new Redis(url, { maxRetriesPerRequest: 2 });
    } catch {
      client = null;
    }
  }
  return client;
}

export async function recordShopMcpInit(shopId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(`puls:mcp:inits:${shopId}`);
  } catch {
    // ignore telemetry failures
  }
}

/** UTC ISO date `YYYY-MM-DD`; daily keys live for 14 days. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const DAILY_TTL_SEC = 60 * 60 * 24 * 14;

export async function recordShopToolCall(
  shopId: string,
  toolName: string,
  status: 'ok' | 'error',
  meta?: Record<string, unknown>
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const payload = JSON.stringify({
    ts: Date.now(),
    tool: toolName,
    status,
    ...meta,
  });
  const dailyKey = `puls:mcp:calls:daily:${shopId}:${todayKey()}`;
  try {
    const tx = r
      .multi()
      .incr(`puls:mcp:calls:${shopId}`)
      .incr('puls:mcp:calls:global')
      .incr(dailyKey)
      .expire(dailyKey, DAILY_TTL_SEC)
      .set(`puls:mcp:lastTool:${shopId}`, toolName)
      .lpush(`puls:mcp:activity:${shopId}`, payload)
      .ltrim(`puls:mcp:activity:${shopId}`, 0, 49);
    await tx.exec();
  } catch {
    // ignore telemetry failures
  }
}
