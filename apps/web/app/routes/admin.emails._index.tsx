import { Link, useLoaderData, useSearchParams } from 'react-router';
import type { Route } from './+types/admin.emails._index';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { EMAIL_TEMPLATES, getEmailTemplate } from '~/lib/email/templates';

export const meta: Route.MetaFunction = () => [
  { title: 'Emaily — Admin · Puls' },
  { name: 'robots', content: 'noindex, nofollow' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const url = new URL(request.url);
  const selectedId = url.searchParams.get('id') ?? EMAIL_TEMPLATES[0]?.id ?? '';
  const tpl = getEmailTemplate(selectedId);
  const rendered = tpl?.render() ?? null;

  return {
    templates: EMAIL_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })),
    selected: tpl
      ? {
          id: tpl.id,
          name: tpl.name,
          description: tpl.description,
          subject: rendered!.subject,
          html: rendered!.html,
          text: rendered!.text,
        }
      : null,
  };
}

export default function AdminEmailsIndex() {
  const { templates, selected } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const activeId = params.get('id') ?? selected?.id ?? '';

  return (
    <div className="col gap-20">
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          E-mailové šablony
        </h1>
        <p
          className="muted"
          style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}
        >
          Náhled všech transakčních e-mailů. Šablony se renderují server-side
          přes <span className="mono">lib/email/templates</span>.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr)',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <nav
          className="card"
          style={{ padding: 8, position: 'sticky', top: 24 }}
        >
          <div className="col gap-2">
            {templates.map((t) => {
              const isActive = t.id === activeId;
              return (
                <Link
                  key={t.id}
                  to={`/admin/emails?id=${encodeURIComponent(t.id)}`}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    color: isActive ? 'var(--ink)' : 'var(--ink-2)',
                    background: isActive ? 'var(--surface)' : 'transparent',
                    textDecoration: 'none',
                    borderLeft: isActive
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{t.name}</div>
                  <div
                    className="mono faint"
                    style={{ fontSize: 10.5, marginTop: 2 }}
                  >
                    {t.id}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>

        {selected ? (
          <div className="col gap-16">
            <div className="card" style={{ padding: 18 }}>
              <div className="col gap-4">
                <div
                  className="mono faint"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Subject
                </div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {selected.subject}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 12.5, marginTop: 4 }}
                >
                  {selected.description}
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                className="row between"
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line)',
                  fontSize: 12,
                }}
              >
                <span className="mono faint">HTML preview</span>
                <span className="mono faint">data: ukázková</span>
              </div>
              <iframe
                title={`Preview: ${selected.name}`}
                srcDoc={selected.html}
                sandbox=""
                style={{
                  display: 'block',
                  width: '100%',
                  height: 720,
                  border: 'none',
                  background: '#09090B',
                }}
              />
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line)',
                  fontSize: 12,
                }}
              >
                <span className="mono faint">Plain text fallback</span>
              </div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 16,
                  fontSize: 12,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--ink-2)',
                }}
              >
                {selected.text}
              </pre>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <p className="muted" style={{ margin: 0 }}>
              Šablona nenalezena.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
