import pg from 'pg';

/**
 * Řádek audit logu `write_log` modelu okamžitý zápis + audit + revert. Mapuje
 * sloupce DB 1:1 (snake_case), aby specy mohly přímo asertovat na uložená data
 * okamžitého zápisu / revertu.
 */
export type WriteLogRow = {
  id: string;
  shop_id: string;
  tool: string;
  args: Record<string, unknown>;
  before: unknown;
  after: unknown;
  status: 'applied' | 'reverted' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  reverted_at: string | null;
};

function client(databaseUrl: string): pg.Client {
  return new pg.Client({ connectionString: databaseUrl });
}

export async function getWriteLog(
  databaseUrl: string,
  id: string
): Promise<WriteLogRow | null> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<WriteLogRow>(
      `select id, shop_id, tool, args, before, after, status, result, error,
              created_at, reverted_at
         from write_log
        where id = $1`,
      [id]
    );
    return r.rows[0] ?? null;
  } finally {
    await c.end();
  }
}

export async function listWriteLogForShop(
  databaseUrl: string,
  shopId: string,
  status?: string
): Promise<WriteLogRow[]> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const where = status
      ? `where shop_id = $1 and status = $2`
      : `where shop_id = $1`;
    const r = await c.query<WriteLogRow>(
      `select id, shop_id, tool, args, before, after, status, result, error,
              created_at, reverted_at
         from write_log
         ${where}
        order by created_at desc`,
      status ? [shopId, status] : [shopId]
    );
    return r.rows;
  } finally {
    await c.end();
  }
}

export async function latestWriteLogForShop(
  databaseUrl: string,
  shopId: string,
  tool?: string
): Promise<WriteLogRow | null> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const where = tool
      ? `where shop_id = $1 and tool = $2`
      : `where shop_id = $1`;
    const r = await c.query<WriteLogRow>(
      `select id, shop_id, tool, args, before, after, status, result, error,
              created_at, reverted_at
         from write_log
         ${where}
        order by created_at desc
        limit 1`,
      tool ? [shopId, tool] : [shopId]
    );
    return r.rows[0] ?? null;
  } finally {
    await c.end();
  }
}

export async function setShopTier(
  databaseUrl: string,
  shopId: string,
  tierId: string
): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(`update shops set tier_id = $2 where id = $1`, [
      shopId,
      tierId,
    ]);
  } finally {
    await c.end();
  }
}

export async function countToolCalls(
  databaseUrl: string,
  shopId: string,
  toolLike: string
): Promise<number> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<{ count: string }>(
      `select count(*)::text as count
         from mcp_tool_calls
        where shop_id = $1 and tool like $2`,
      [shopId, toolLike]
    );
    return Number(r.rows[0]?.count ?? '0');
  } finally {
    await c.end();
  }
}

export async function deleteWriteLogForShop(
  databaseUrl: string,
  shopId: string
): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(`delete from write_log where shop_id = $1`, [shopId]);
  } finally {
    await c.end();
  }
}
