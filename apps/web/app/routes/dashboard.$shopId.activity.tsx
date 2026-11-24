import { eq } from 'drizzle-orm';
import { Link, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/dashboard.$shopId.activity';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { getRedis } from '~/lib/redis';
import { loadActivityLines } from '~/lib/dashboard-stats.server';
import { ActivityTable } from '~/components/dashboard/activity-table';

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) throw new Response('Not found', { status: 404 });

  if (
    !shop.adminEmail ||
    shop.adminEmail.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new Response('Forbidden', { status: 403 });
  }

  const redis = getRedis();
  const rows = await loadActivityLines(redis, shopId, 100);

  return { shopId, rows };
}

export default function DashboardActivity() {
  const { shopId, rows } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="col gap-8" style={{ marginBottom: 24 }}>
        <Link
          to={`/dashboard/${shopId}`}
          className="row gap-6"
          style={{
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontSize: 12.5,
            width: 'fit-content',
          }}
        >
          <ArrowLeft size={12} /> Přehled
        </Link>
        <h1
          style={{
            fontSize: 32,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            fontWeight: 600,
            margin: 0,
            color: 'var(--ink)',
          }}
        >
          Activity log
        </h1>
        <p
          className="muted"
          style={{ fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 640 }}
        >
          Kompletní log MCP volání — auto-refresh 30 s, posledních 100
          záznamů. Filtry podle nástroje a status kódu přibudou v dalším
          sprintu.
        </p>
      </div>

      <ActivityTable rows={rows} />

      {rows.length === 0 ? (
        <p
          className="muted"
          style={{
            fontSize: 12.5,
            marginTop: 24,
            lineHeight: 1.6,
            maxWidth: 540,
          }}
        >
          Tip: zkopírujte si MCP endpoint URL z přehledu, vložte ji do
          Claude Desktop a zeptejte se „Kolik objednávek mám tento týden?"
          — uvidíte první volání tady.
        </p>
      ) : null}
    </>
  );
}
