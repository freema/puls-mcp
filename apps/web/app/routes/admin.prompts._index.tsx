import { Link, useLoaderData } from 'react-router';
import { Plus } from 'lucide-react';
import type { Route } from './+types/admin.prompts._index';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';
import { listAllPromptsForAdmin, listCategories } from '~/lib/prompts.server';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const [rows, categories] = await Promise.all([
    listAllPromptsForAdmin(db),
    listCategories(db),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  return { rows, catById: Object.fromEntries(catById) };
}

export default function AdminPromptsIndex() {
  const { rows, catById } = useLoaderData<typeof loader>();

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
            Prompty
          </h1>
          <p
            className="muted"
            style={{ fontSize: 13, margin: 0, maxWidth: 540 }}
          >
            Správa prompt galerie. Změny se v public listingu projeví do 60 s
            (Redis cache).
          </p>
        </div>
        <Link
          to="/admin/prompts/new"
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
          <Plus size={14} /> Nový prompt
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Zatím žádné prompty.
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
                <Th>Slug</Th>
                <Th>Kategorie</Th>
                <Th>Min tier</Th>
                <Th>Stav</Th>
                <Th>Použito</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const archived = !!r.archivedAt;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <Td>
                      <strong>{r.title}</strong>
                      {r.isFeatured ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            color: 'var(--accent)',
                            border: '1px solid rgba(125,249,197,0.3)',
                          }}
                        >
                          featured
                        </span>
                      ) : null}
                    </Td>
                    <Td mono>{r.slug}</Td>
                    <Td>
                      {r.categoryId ? catById[r.categoryId] ?? r.categoryId : '—'}
                    </Td>
                    <Td>{r.minTier ?? '—'}</Td>
                    <Td>
                      {archived
                        ? 'Archivováno'
                        : r.isPublished
                          ? 'Publikováno'
                          : 'Koncept'}
                    </Td>
                    <Td>{r.uses}</Td>
                    <Td>
                      <Link
                        to={`/admin/prompts/${r.id}`}
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
                );
              })}
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
