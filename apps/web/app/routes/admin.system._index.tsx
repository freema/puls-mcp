import { useLoaderData } from 'react-router';
import type { Route } from './+types/admin.system._index';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { runHealthChecks } from '~/lib/health';
import { getRedis } from '~/lib/redis';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const health = await runHealthChecks();
  const redis = getRedis();
  let redisInfo = '';
  try {
    redisInfo = await redis.info('server');
  } catch {
    redisInfo = 'unavailable';
  }

  let migrations = 'unknown';
  try {
    const journalPath = resolve(
      process.cwd(),
      'drizzle/migrations/meta/_journal.json'
    );
    const raw = await readFile(journalPath, 'utf8');
    const j = JSON.parse(raw) as { entries?: { tag: string }[] };
    migrations = j.entries?.map((e) => e.tag).join(', ') ?? 'unknown';
  } catch {
    migrations = 'unknown';
  }

  return {
    health,
    redisInfoPreview: redisInfo.split('\n').slice(0, 8).join('\n'),
    migrations,
    node: process.version,
  };
}

export default function AdminSystem() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="space-y-6 p-6 text-sm">
      <h1 className="text-xl font-semibold text-zinc-50">Systém</h1>
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-2 text-xs uppercase text-zinc-500">Health</h2>
        <pre className="overflow-x-auto text-xs text-zinc-300">
          {JSON.stringify(data.health, null, 2)}
        </pre>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-2 text-xs uppercase text-zinc-500">
          Redis INFO (úryvek)
        </h2>
        <pre className="overflow-x-auto text-xs text-zinc-400 whitespace-pre-wrap">
          {data.redisInfoPreview}
        </pre>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-2 text-xs uppercase text-zinc-500">Migrace</h2>
        <p className="text-xs text-zinc-400">{data.migrations}</p>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-2 text-xs uppercase text-zinc-500">Runtime</h2>
        <p className="text-xs text-zinc-400">{data.node}</p>
      </section>
    </div>
  );
}
