import type { Route } from './+types/api.admin.system';
import { getDb, healthDbPing } from '~/lib/db';
import { healthRedisPing } from '~/lib/redis';
import { requireAdminApiKey } from '~/lib/admin-api/keys.server';
import { getConfig } from '~/lib/config';

async function probe(fn: () => Promise<void>): Promise<{
  ok: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - t0, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdminApiKey(db, request);

  const cfg = getConfig();
  const [postgres, redis] = await Promise.all([
    probe(healthDbPing),
    probe(healthRedisPing),
  ]);

  const allOk = postgres.ok && redis.ok;
  return Response.json(
    {
      ok: allOk,
      env: cfg.NODE_ENV,
      mcpOrigin: cfg.MCP_PUBLIC_ORIGIN,
      checks: { postgres, redis },
      ts: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
