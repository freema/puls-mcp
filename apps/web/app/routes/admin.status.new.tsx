import { Form, Link, redirect, useActionData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/admin.status.new';
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

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) {
    throw new Response('Forbidden', { status: 403 });
  }

  const form = await request.formData();
  const title = String(form.get('title') ?? '').trim();
  const component = String(form.get('component') ?? '').trim() || 'multi';
  const statusRaw = String(form.get('status') ?? 'investigating');
  const status = (ALLOWED_STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw
    : 'investigating';
  const initialMessage = String(form.get('message') ?? '').trim();

  if (!title) {
    return { error: 'Title je povinný.' };
  }

  const updates =
    initialMessage.length > 0
      ? [
          {
            ts: new Date().toISOString(),
            status,
            message: initialMessage,
          },
        ]
      : [];

  const [row] = await db
    .insert(incidents)
    .values({
      component,
      title,
      status,
      updates,
      createdBy: user.id,
    })
    .returning({ id: incidents.id });

  return redirect(`/admin/status/${row!.id}`);
}

export default function AdminStatusNew() {
  const data = useActionData<typeof action>();
  const error = (data as { error?: string } | undefined)?.error;
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
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 24px' }}>
        Nový incident
      </h1>

      <Form
        method="post"
        style={{ display: 'grid', gap: 16, maxWidth: 560 }}
      >
        <FormRow label="Title">
          <input
            type="text"
            name="title"
            required
            placeholder="MCP server pomalý odpovídá"
            style={inputStyle}
          />
        </FormRow>
        <FormRow label="Komponenta">
          <select name="component" defaultValue="multi" style={inputStyle}>
            <option value="multi">multi (více komponent)</option>
            <option value="web">web</option>
            <option value="mcp">mcp</option>
            <option value="shoptet_api">shoptet_api</option>
            <option value="upgates_api">upgates_api</option>
          </select>
        </FormRow>
        <FormRow label="Status">
          <select
            name="status"
            defaultValue="investigating"
            style={inputStyle}
          >
            {ALLOWED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="První zpráva (volitelné)">
          <textarea
            name="message"
            rows={4}
            placeholder="Zaznamenali jsme zvýšenou latenci na /mcp endpointu."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </FormRow>

        {error ? (
          <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}

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
          Vytvořit
        </button>
      </Form>
    </>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
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
