import { desc } from 'drizzle-orm';
import { Link, useLoaderData } from 'react-router';
import { Plus } from 'lucide-react';
import type { Route } from './+types/admin.status._index';
import { incidents } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const rows = await db
    .select({
      id: incidents.id,
      component: incidents.component,
      title: incidents.title,
      status: incidents.status,
      startedAt: incidents.startedAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .orderBy(desc(incidents.startedAt))
    .limit(100);

  return { rows };
}

export default function AdminStatusIndex() {
  const { rows } = useLoaderData<typeof loader>();
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 6px' }}>
            Incidenty
          </h1>
          <p
            className="muted"
            style={{ fontSize: 13, margin: 0, maxWidth: 540 }}
          >
            Manuálně vytvářené incidenty se zobrazí na veřejné /status stránce,
            dokud je neoznačíte jako resolved.
          </p>
        </div>
        <Link
          to="/admin/status/new"
          className="row gap-8"
          style={{
            background: 'var(--accent)',
            color: 'var(--bg)',
            padding: '8px 14px',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          <Plus size={14} /> Nový incident
        </Link>
      </div>

      {rows.length === 0 ? (
        <p
          className="muted"
          style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 540 }}
        >
          Zatím žádné incidenty.
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
                <Th>Title</Th>
                <Th>Komponenta</Th>
                <Th>Status</Th>
                <Th>Začátek</Th>
                <Th>Konec</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <Td>{r.title}</Td>
                  <Td mono>{r.component}</Td>
                  <Td>{r.status}</Td>
                  <Td>{fmt(r.startedAt)}</Td>
                  <Td>{r.resolvedAt ? fmt(r.resolvedAt) : '—'}</Td>
                  <Td>
                    <Link
                      to={`/admin/status/${r.id}`}
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

function fmt(d: Date): string {
  return d.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
