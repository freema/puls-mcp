import { desc, eq } from 'drizzle-orm';
import { Link, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/dashboard.$shopId.write-history._index';
import { shops, writeLog } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';

/** Stavy zápisu z write_log (status enum). */
const STATUS_LABELS: Record<string, string> = {
  applied: 'Provedeno',
  reverted: 'Vráceno',
  failed: 'Selhalo',
};

const STATUS_COLOR: Record<string, string> = {
  applied: '#22c55e',
  reverted: '#a3a3a3',
  failed: '#ef4444',
};

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

  const rows = await db
    .select({
      id: writeLog.id,
      tool: writeLog.tool,
      status: writeLog.status,
      createdAt: writeLog.createdAt,
      revertedAt: writeLog.revertedAt,
      error: writeLog.error,
    })
    .from(writeLog)
    .where(eq(writeLog.shopId, shopId))
    .orderBy(desc(writeLog.createdAt))
    .limit(200);

  return { shopId, rows };
}

export default function WriteHistoryIndex() {
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
          Historie zápisů
        </h1>
        <p
          className="muted"
          style={{ fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 640 }}
        >
          Když AI zavolá write nástroj (změna ceny, voucher, stav objednávky…),
          zápis proběhne okamžitě a zaloguje se sem se stavem před a po. U
          provedených zápisů můžete jedním kliknutím vrátit původní stav.
        </p>
      </div>

      {rows.length === 0 ? (
        <p
          className="muted"
          style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 540 }}
        >
          Zatím žádné zápisy.
        </p>
      ) : (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13.5,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <Th>Nástroj</Th>
                <Th>Status</Th>
                <Th>Provedeno</Th>
                <Th>Vráceno</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <Td mono>{r.tool}</Td>
                  <Td>
                    <span
                      style={{
                        color: STATUS_COLOR[r.status] ?? 'var(--ink-3)',
                        fontWeight: 500,
                      }}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                    {r.error ? (
                      <span
                        style={{
                          display: 'block',
                          color: 'var(--ink-3)',
                          fontSize: 11.5,
                          marginTop: 2,
                        }}
                      >
                        {r.error.slice(0, 80)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{fmt(r.createdAt)}</Td>
                  <Td>{r.revertedAt ? fmt(r.revertedAt) : '—'}</Td>
                  <Td>
                    <Link
                      to={`/dashboard/${shopId}/write-history/${r.id}`}
                      style={{
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        fontSize: 12.5,
                      }}
                    >
                      Detail →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '10px 14px',
        fontWeight: 500,
        fontSize: 12,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
}: {
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: '10px 14px',
        verticalAlign: 'top',
        fontFamily: mono
          ? 'ui-monospace, SFMono-Regular, monospace'
          : undefined,
      }}
    >
      {children}
    </td>
  );
}

function fmt(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
