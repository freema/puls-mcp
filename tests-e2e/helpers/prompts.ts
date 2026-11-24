import pg from 'pg';

function client(databaseUrl: string): pg.Client {
  return new pg.Client({ connectionString: databaseUrl });
}

export async function getPromptUsesCount(
  databaseUrl: string,
  slug: string
): Promise<number> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<{ count: string }>(
      `select count(*)::text as count
         from prompt_uses pu
         join prompts p on p.id = pu.prompt_id
        where p.slug = $1`,
      [slug]
    );
    return Number(r.rows[0]?.count ?? '0');
  } finally {
    await c.end();
  }
}

export async function getPromptUsesField(
  databaseUrl: string,
  slug: string
): Promise<number> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<{ uses: number }>(
      `select uses from prompts where slug = $1`,
      [slug]
    );
    return r.rows[0]?.uses ?? 0;
  } finally {
    await c.end();
  }
}

export async function getPromptIdBySlug(
  databaseUrl: string,
  slug: string
): Promise<string | null> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<{ id: string }>(
      `select id from prompts where slug = $1`,
      [slug]
    );
    return r.rows[0]?.id ?? null;
  } finally {
    await c.end();
  }
}

export async function clearPromptByTitle(
  databaseUrl: string,
  title: string
): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(`delete from prompts where title = $1`, [title]);
  } finally {
    await c.end();
  }
}
