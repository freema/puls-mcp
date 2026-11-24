import type Redis from 'ioredis';

export type DashboardStats = {
  mcpCalls: number;
  aiClients: number;
  topTool: string | null;
  /** dnešní využití denní kvóty v % (0..100) */
  quotaPct: number;
  /** dnešní volání */
  callsToday: number;
  /** denní limit z tieru */
  callsPerDay: number;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadDashboardStats(
  redis: Redis,
  shopId: string,
  callsPerDay: number
): Promise<DashboardStats> {
  const [callsRaw, initsRaw, topTool, todayRaw, rateLimitRaw] = await redis.mget(
    `puls:mcp:calls:${shopId}`,
    `puls:mcp:inits:${shopId}`,
    `puls:mcp:lastTool:${shopId}`,
    `puls:mcp:calls:daily:${shopId}:${todayKey()}`,
    `puls:rl:mcp-shop:${shopId}:${todayKey()}`
  );

  const mcpCalls = Number(callsRaw ?? 0);
  const aiClients = Number(initsRaw ?? 0);
  // Rate-limit counter v tier-gate je autoritativní zdroj dnešních volání;
  // fallback na puls:mcp:calls:daily, který se inkrementuje v telemetrii.
  const callsToday = Number(rateLimitRaw ?? todayRaw ?? 0);
  const quotaPct =
    callsPerDay > 0
      ? Math.min(100, Math.round((callsToday / callsPerDay) * 100))
      : 0;

  return {
    mcpCalls,
    aiClients,
    topTool: topTool ?? null,
    quotaPct,
    callsToday,
    callsPerDay,
  };
}

export async function loadActivityLines(
  redis: Redis,
  shopId: string,
  limit = 10
): Promise<{ ts: number; tool: string; status: string; detail?: string }[]> {
  const raw = await redis.lrange(`puls:mcp:activity:${shopId}`, 0, limit - 1);
  const out: { ts: number; tool: string; status: string; detail?: string }[] =
    [];
  for (const line of raw) {
    try {
      const j = JSON.parse(line) as Record<string, unknown>;
      out.push({
        ts: Number(j.ts ?? Date.now()),
        tool: String(j.tool ?? ''),
        status: String(j.status ?? 'ok'),
        detail: j.detail ? String(j.detail) : undefined,
      });
    } catch {
      // skip
    }
  }
  return out;
}

export type UsagePoint = { day: string; calls: number };

/**
 * Returns last 7 days of MCP call counts. Reads daily counters from Redis
 * (`puls:mcp:calls:daily:{shopId}:{YYYY-MM-DD}`); missing days return 0.
 */
export async function loadUsageHistory(
  redis: Redis,
  shopId: string
): Promise<UsagePoint[]> {
  const days: { key: string; label: string }[] = [];
  const labels = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = labels[d.getDay()] ?? key;
    days.push({ key, label });
  }
  const redisKeys = days.map(
    (d) => `puls:mcp:calls:daily:${shopId}:${d.key}`
  );
  const values = await redis.mget(...redisKeys);
  return days.map((d, i) => ({
    day: d.label,
    calls: Number(values[i] ?? 0),
  }));
}
