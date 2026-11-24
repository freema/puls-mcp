import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Route } from './+types/api.admin.logs';
import { mcpToolCalls, shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdminApiKey } from '~/lib/admin-api/keys.server';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdminApiKey(db, request);

  const url = new URL(request.url);
  const shopId = url.searchParams.get('shop') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const tool = url.searchParams.get('tool') ?? undefined;
  const since = url.searchParams.get('since') ?? undefined;
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const conds = [];
  if (shopId) conds.push(eq(mcpToolCalls.shopId, shopId));
  if (status) conds.push(eq(mcpToolCalls.status, status));
  if (tool) conds.push(eq(mcpToolCalls.tool, tool));
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      conds.push(gt(mcpToolCalls.createdAt, sinceDate));
    }
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: mcpToolCalls.id,
      shopId: mcpToolCalls.shopId,
      domain: shops.domain,
      tool: mcpToolCalls.tool,
      status: mcpToolCalls.status,
      durationMs: mcpToolCalls.durationMs,
      args: mcpToolCalls.args,
      errorMessage: mcpToolCalls.errorMessage,
      createdAt: mcpToolCalls.createdAt,
    })
    .from(mcpToolCalls)
    .leftJoin(shops, eq(shops.id, mcpToolCalls.shopId))
    .where(whereClause)
    .orderBy(desc(mcpToolCalls.createdAt))
    .limit(limit);

  const [{ totalAll = 0, errorsAll = 0 } = {}] = await db
    .select({
      totalAll: sql<number>`count(*)::int`,
      errorsAll: sql<number>`count(*) filter (where ${mcpToolCalls.status} <> 'ok')::int`,
    })
    .from(mcpToolCalls)
    .where(whereClause);

  return Response.json({
    filters: { shop: shopId ?? null, status: status ?? null, tool: tool ?? null, since: since ?? null, limit },
    counts: { total: Number(totalAll), errors: Number(errorsAll) },
    rows: rows.map((r) => ({
      id: r.id,
      ts: r.createdAt.toISOString(),
      shopId: r.shopId,
      shopDomain: r.domain,
      tool: r.tool,
      status: r.status,
      durationMs: r.durationMs,
      args: r.args,
      errorMessage: r.errorMessage,
    })),
  });
}
