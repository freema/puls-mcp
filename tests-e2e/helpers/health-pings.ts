import pg from 'pg';

function client(databaseUrl: string): pg.Client {
  return new pg.Client({ connectionString: databaseUrl });
}

export async function clearHealthData(databaseUrl: string): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(`delete from health_pings`);
    await c.query(`delete from health_daily`);
  } finally {
    await c.end();
  }
}

export async function clearIncidents(databaseUrl: string): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(`delete from incidents`);
  } finally {
    await c.end();
  }
}

export async function insertPing(
  databaseUrl: string,
  args: {
    component: string;
    status: 'up' | 'down' | 'degraded';
    latencyMs?: number | null;
    error?: string | null;
    checkedAt?: Date;
  }
): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(
      `insert into health_pings (component, status, latency_ms, error, checked_at)
       values ($1, $2, $3, $4, coalesce($5, now()))`,
      [
        args.component,
        args.status,
        args.latencyMs ?? null,
        args.error ?? null,
        args.checkedAt ?? null,
      ]
    );
  } finally {
    await c.end();
  }
}

export async function insertDaily(
  databaseUrl: string,
  args: {
    day: string;
    component: string;
    uptimePct: number;
    totalChecks: number;
    downChecks: number;
  }
): Promise<void> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    await c.query(
      `insert into health_daily (day, component, uptime_pct, total_checks, down_checks)
       values ($1, $2, $3, $4, $5)
       on conflict (day, component) do update
         set uptime_pct = excluded.uptime_pct,
             total_checks = excluded.total_checks,
             down_checks = excluded.down_checks`,
      [
        args.day,
        args.component,
        args.uptimePct.toFixed(2),
        args.totalChecks,
        args.downChecks,
      ]
    );
  } finally {
    await c.end();
  }
}

export async function insertIncident(
  databaseUrl: string,
  args: {
    id?: string;
    component: string;
    title: string;
    status: string;
  }
): Promise<string> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const id = args.id ?? `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await c.query(
      `insert into incidents (id, component, title, status, updates)
       values ($1, $2, $3, $4, '[]'::jsonb)`,
      [id, args.component, args.title, args.status]
    );
    return id;
  } finally {
    await c.end();
  }
}

export async function countPings(
  databaseUrl: string,
  component?: string
): Promise<number> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    if (component) {
      const r = await c.query<{ count: string }>(
        `select count(*)::text as count from health_pings where component = $1`,
        [component]
      );
      return Number(r.rows[0]?.count ?? '0');
    }
    const r = await c.query<{ count: string }>(
      `select count(*)::text as count from health_pings`
    );
    return Number(r.rows[0]?.count ?? '0');
  } finally {
    await c.end();
  }
}

export async function getIncident(
  databaseUrl: string,
  id: string
): Promise<{ status: string; resolved_at: string | null } | null> {
  const c = client(databaseUrl);
  await c.connect();
  try {
    const r = await c.query<{ status: string; resolved_at: string | null }>(
      `select status, resolved_at from incidents where id = $1`,
      [id]
    );
    return r.rows[0] ?? null;
  } finally {
    await c.end();
  }
}
