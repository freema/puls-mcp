import { eq } from 'drizzle-orm';
import { Form, Link, redirect, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/admin.status.$id';
import { incidents } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';

const ALLOWED_STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const id = params.id;
  if (!id) throw new Response('Not found', { status: 404 });

  const [row] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  if (!row) throw new Response('Not found', { status: 404 });
  return { incident: row };
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  const id = params.id;
  if (!id) throw new Response('Not found', { status: 404 });

  const form = await request.formData();
  const intent = String(form.get('intent') ?? 'update');

  const [row] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  if (!row) throw new Response('Not found', { status: 404 });

  const now = new Date();

  if (intent === 'resolve') {
    const updates = Array.isArray(row.updates)
      ? [...(row.updates as { ts: string; status: string; message: string }[])]
      : [];
    updates.push({
      ts: now.toISOString(),
      status: 'resolved',
      message: 'Incident vyřešen.',
    });
    await db
      .update(incidents)
      .set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
        updates,
      })
      .where(eq(incidents.id, id));
    return redirect('/admin/status');
  }

  // update intent
  const newStatusRaw = String(form.get('status') ?? row.status);
  const status = (ALLOWED_STATUSES as readonly string[]).includes(newStatusRaw)
    ? newStatusRaw
    : row.status;
  const message = String(form.get('message') ?? '').trim();

  if (!message) {
    return { error: 'Zpráva je povinná pro update.' };
  }

  const updates = Array.isArray(row.updates)
    ? [...(row.updates as { ts: string; status: string; message: string }[])]
    : [];
  updates.push({ ts: now.toISOString(), status, message });

  await db
    .update(incidents)
    .set({
      status,
      updates,
      updatedAt: now,
      ...(status === 'resolved' && !row.resolvedAt
        ? { resolvedAt: now }
        : {}),
    })
    .where(eq(incidents.id, id));

  return null;
}

export default function AdminStatusDetail() {
  const { incident } = useLoaderData<typeof loader>();
  const updates = (incident.updates ?? []) as {
    ts: string;
    status: string;
    message: string;
  }[];

  const isResolved = incident.status === 'resolved';

  return (
    <>
      <Link
        to="/admin/status"
        className="row gap-6"
        style={{
          color: 'var(--ink-3)',
          textDecoration: 'none',
          fontSize: 12.5,
          marginBottom: 16,
          width: 'fit-content',
        }}
      >
        <ArrowLeft size={12} /> Incidenty
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 8px' }}>
        {incident.title}
      </h1>
      <p
        className="row gap-12"
        style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 24px' }}
      >
        <span>Komponenta: <strong style={{ color: 'var(--ink-2)' }}>{incident.component}</strong></span>
        <span>Status: <strong style={{ color: 'var(--ink-2)' }}>{incident.status}</strong></span>
        <span>Začátek: {fmt(incident.startedAt)}</span>
        {incident.resolvedAt ? <span>Konec: {fmt(incident.resolvedAt)}</span> : null}
      </p>

      <section style={{ marginBottom: 32 }}>
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
          Timeline
        </h3>
        {updates.length === 0 ? (
          <p
            className="muted"
            style={{ fontSize: 13, margin: 0 }}
          >
            Žádné updaty.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 8,
            }}
          >
            {updates.map((u, i) => (
              <li
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 13,
                }}
              >
                <strong>{u.status}</strong>{' '}
                <span style={{ color: 'var(--ink-3)' }}>· {fmt(new Date(u.ts))}</span>
                <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{u.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isResolved ? (
        <Form
          method="post"
          style={{ display: 'grid', gap: 12, maxWidth: 560, marginBottom: 32 }}
        >
          <input type="hidden" name="intent" value="update" />
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Status</span>
            <select
              name="status"
              defaultValue={incident.status}
              style={inputStyle}
            >
              {ALLOWED_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Update message
            </span>
            <textarea
              name="message"
              rows={3}
              required
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>
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
              justifySelf: 'start',
            }}
          >
            Přidat update
          </button>
        </Form>
      ) : null}

      {!isResolved ? (
        <Form method="post">
          <input type="hidden" name="intent" value="resolve" />
          <button
            type="submit"
            style={{
              background: 'transparent',
              color: 'var(--ink)',
              padding: '10px 18px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Označit jako vyřešeno
          </button>
        </Form>
      ) : null}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '8px 12px',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'inherit',
};

function fmt(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
