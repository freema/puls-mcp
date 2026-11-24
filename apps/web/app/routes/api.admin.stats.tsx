import { desc, eq, gt, ne, sql } from 'drizzle-orm';
import type { Route } from './+types/api.admin.stats';
import { mcpToolCalls, shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdminApiKey } from '~/lib/admin-api/keys.server';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdminApiKey(db, request);

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const whereSince = validSince
    ? gt(mcpToolCalls.createdAt, validSince)
    : undefined;

  const [totals = { total: 0, errors: 0 }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${mcpToolCalls.status} <> 'ok')::int`,
    })
    .from(mcpToolCalls)
    .where(whereSince);

  const byTool = await db
    .select({
      tool: mcpToolCalls.tool,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${mcpToolCalls.status} <> 'ok')::int`,
      avgDurationMs: sql<number>`coalesce(round(avg(${mcpToolCalls.durationMs}))::int, 0)`,
    })
    .from(mcpToolCalls)
    .where(whereSince)
    .groupBy(mcpToolCalls.tool)
    .orderBy(desc(sql`count(*)`));

  const byShop = await db
    .select({
      shopId: mcpToolCalls.shopId,
      domain: shops.domain,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${mcpToolCalls.status} <> 'ok')::int`,
    })
    .from(mcpToolCalls)
    .leftJoin(shops, eq(shops.id, mcpToolCalls.shopId))
    .where(whereSince)
    .groupBy(mcpToolCalls.shopId, shops.domain)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  const recentErrors = await db
    .select({
      ts: mcpToolCalls.createdAt,
      shopId: mcpToolCalls.shopId,
      domain: shops.domain,
      tool: mcpToolCalls.tool,
      errorMessage: mcpToolCalls.errorMessage,
    })
    .from(mcpToolCalls)
    .leftJoin(shops, eq(shops.id, mcpToolCalls.shopId))
    .where(ne(mcpToolCalls.status, 'ok'))
    .orderBy(desc(mcpToolCalls.createdAt))
    .limit(20);

  return Response.json({
    since: validSince ? validSince.toISOString() : null,
    totals: { total: Number(totals.total), errors: Number(totals.errors) },
    byTool: byTool.map((t) => ({
      tool: t.tool,
      total: Number(t.total),
      errors: Number(t.errors),
      avgDurationMs: Number(t.avgDurationMs),
    })),
    byShop: byShop.map((s) => ({
      shopId: s.shopId,
      shopDomain: s.domain,
      total: Number(s.total),
      errors: Number(s.errors),
    })),
    recentErrors: recentErrors.map((e) => ({
      ts: e.ts.toISOString(),
      shopId: e.shopId,
      shopDomain: e.domain,
      tool: e.tool,
      errorMessage: e.errorMessage,
    })),
  });
}
