import { eq } from 'drizzle-orm';
import { Form, Link, redirect, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { revertByTool } from '@puls/platform-core';
import type { Route } from './+types/dashboard.$shopId.write-history.$id';
import { shops, writeLog } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { getConnector } from '~/lib/connector.server';

const STATUS_LABELS: Record<string, string> = {
  applied: 'Provedeno',
  reverted: 'Vráceno',
  failed: 'Selhalo',
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const { shopId, id } = params;
  if (!shopId || !id) throw new Response('Not found', { status: 404 });

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

  const [row] = await db
    .select()
    .from(writeLog)
    .where(eq(writeLog.id, id))
    .limit(1);
  if (!row || row.shopId !== shopId) {
    throw new Response('Not found', { status: 404 });
  }

  return {
    shopId,
    entry: {
      id: row.id,
      tool: row.tool,
      status: row.status,
      args: row.args,
      before: row.before,
      after: row.after,
      result: row.result,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      revertedAt: row.revertedAt?.toISOString() ?? null,
    },
  };
}

/**
 * Vrátí původní stav (`before`) přes sdílenou revert logiku `revertByTool`
 * (@puls/platform-core) — STEJNÁ sémantika jako MCP nástroj `revert_write`,
 * protože obě cesty volají jeden a tentýž kód (jeden zdroj pravdy).
 */
export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const { shopId, id } = params;
  if (!shopId || !id) throw new Response('Not found', { status: 404 });

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

  const form = await request.formData();
  const intent = form.get('intent');
  if (intent !== 'revert') {
    return { error: 'Neznámá akce.' };
  }

  const [row] = await db
    .select()
    .from(writeLog)
    .where(eq(writeLog.id, id))
    .limit(1);
  if (!row || row.shopId !== shopId) {
    throw new Response('Not found', { status: 404 });
  }

  if (row.status !== 'applied') {
    return {
      error: `Vrátit nelze: záznam má status ${row.status} (vrátit lze jen provedený zápis).`,
    };
  }

  const connector = getConnector(shop.platform);

  let dispatchError: string | null;
  try {
    dispatchError = await revertByTool(connector, shop, db, row);
  } catch (err) {
    return {
      error:
        'Vrácení selhalo: ' +
        (err instanceof Error ? err.message : 'neznámá chyba'),
    };
  }
  if (dispatchError) return { error: dispatchError };

  await db
    .update(writeLog)
    .set({ status: 'reverted', revertedAt: new Date() })
    .where(eq(writeLog.id, id));

  return redirect(`/dashboard/${shopId}/write-history`);
}

export default function WriteHistoryDetail() {
  const { shopId, entry } = useLoaderData<typeof loader>();
  const canRevert = entry.status === 'applied';

  return (
    <>
      <div className="col gap-8" style={{ marginBottom: 24 }}>
        <Link
          to={`/dashboard/${shopId}/write-history`}
          className="row gap-6"
          style={{
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontSize: 12.5,
            width: 'fit-content',
          }}
        >
          <ArrowLeft size={12} /> Historie zápisů
        </Link>
        <h1
          style={{
            fontSize: 28,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            fontWeight: 600,
            margin: 0,
            color: 'var(--ink)',
          }}
        >
          {entry.tool}
        </h1>
        <div
          className="row gap-12"
          style={{ fontSize: 12.5, color: 'var(--ink-3)' }}
        >
          <span>
            Status:{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {STATUS_LABELS[entry.status] ?? entry.status}
            </strong>
          </span>
          <span>Provedeno: {fmt(entry.createdAt)}</span>
          {entry.revertedAt ? <span>Vráceno: {fmt(entry.revertedAt)}</span> : null}
        </div>
      </div>

      <Section title="Argumenty">
        <Pre value={entry.args} />
      </Section>

      <Section title="Diff (před → po)">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          <div>
            <h4 style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>
              before
            </h4>
            <Pre value={entry.before ?? null} />
          </div>
          <div>
            <h4 style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 6px' }}>
              after
            </h4>
            <Pre value={entry.after ?? null} />
          </div>
        </div>
      </Section>

      {entry.result ? (
        <Section title="Výsledek (po provedení)">
          <Pre value={entry.result} />
        </Section>
      ) : null}

      {entry.error ? (
        <Section title="Chyba">
          <pre
            style={{
              background: '#3a0a0a',
              color: '#fecaca',
              padding: 12,
              borderRadius: 8,
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {entry.error}
          </pre>
        </Section>
      ) : null}

      {canRevert ? (
        <div
          className="row gap-12"
          style={{
            marginTop: 32,
            padding: 16,
            border: '1px solid var(--line)',
            borderRadius: 12,
            background: 'var(--bg-2)',
          }}
        >
          <Form method="post">
            <input type="hidden" name="intent" value="revert" />
            <button
              type="submit"
              style={{
                background: 'var(--accent)',
                color: 'var(--bg)',
                padding: '10px 18px',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Vrátit
            </button>
          </Form>
        </div>
      ) : null}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 24 }}>
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          margin: '0 0 8px',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        background: 'var(--bg-2)',
        color: 'var(--ink)',
        padding: 12,
        borderRadius: 8,
        fontSize: 12.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: 0,
      }}
    >
      {value === null || value === undefined
        ? '—'
        : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
