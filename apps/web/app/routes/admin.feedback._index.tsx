import { and, desc, eq, sql } from 'drizzle-orm';
import { Form, Link, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.feedback._index';
import {
  feedback,
  feedbackStatusEnum,
  feedbackTypeEnum,
  shops,
} from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { NiceSelect } from '~/components/ui/nice-select';

const STATUSES = feedbackStatusEnum.enumValues;
const TYPES = feedbackTypeEnum.enumValues;

const TYPE_LABEL: Record<string, string> = {
  feature_request: 'Feature request',
  bug: 'Bug',
  praise: 'Pochvala',
  missing_tool: 'Chybí nástroj',
  other: 'Jiné',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'Nový',
  triaged: 'Zatříděný',
  planned: 'Naplánovaný',
  done: 'Hotový',
  declined: 'Zamítnutý',
};

const PAGE_LIMIT = 300;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') ?? '';
  const typeFilter = url.searchParams.get('type') ?? '';

  const conditions = [];
  if (statusFilter) conditions.push(eq(feedback.status, statusFilter as never));
  if (typeFilter) conditions.push(eq(feedback.type, typeFilter as never));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: feedback.id,
      shopId: feedback.shopId,
      shopDomain: feedback.shopDomain,
      ownerEmail: shops.adminEmail,
      liveDomain: shops.domain,
      type: feedback.type,
      sentiment: feedback.sentiment,
      message: feedback.message,
      context: feedback.context,
      source: feedback.source,
      status: feedback.status,
      adminNote: feedback.adminNote,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .leftJoin(shops, eq(feedback.shopId, shops.id))
    .where(whereClause)
    .orderBy(desc(feedback.createdAt))
    .limit(PAGE_LIMIT + 1);

  const truncated = rows.length > PAGE_LIMIT;

  const [{ totalAll = 0, newAll = 0 } = {}] = await db
    .select({
      totalAll: sql<number>`count(*)::int`,
      newAll: sql<number>`count(*) filter (where ${feedback.status} = 'new')::int`,
    })
    .from(feedback);

  return {
    rows: rows.slice(0, PAGE_LIMIT).map((r) => ({
      ...r,
      ts: r.createdAt.getTime(),
      domain: r.liveDomain ?? r.shopDomain ?? null,
    })),
    truncated,
    total: Number(totalAll),
    newCount: Number(newAll),
    filters: { status: statusFilter, type: typeFilter },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const id = String(form.get('id') ?? '');
  if (!id) return { error: 'Chybí id.' };

  if (intent === 'delete') {
    await db.delete(feedback).where(eq(feedback.id, id));
    return { ok: true };
  }

  if (intent === 'update') {
    const statusRaw = String(form.get('status') ?? '');
    const status = (STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as (typeof STATUSES)[number])
      : undefined;
    const adminNote = String(form.get('adminNote') ?? '').trim() || null;
    await db
      .update(feedback)
      .set({
        ...(status ? { status } : {}),
        adminNote,
        updatedAt: new Date(),
      })
      .where(eq(feedback.id, id));
    return { ok: true };
  }

  return { error: 'Neznámá akce.' };
}

export default function AdminFeedback() {
  const data = useLoaderData<typeof loader>();
  const hasFilters = !!data.filters.status || !!data.filters.type;

  return (
    <div className="col gap-16" style={{ maxWidth: 980 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="col gap-4">
          <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
            Feedback
          </h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Produktový feedback od uživatelů (přes nástroj submit_feedback). Z
            triage stavíme roadmapu.
          </span>
        </div>
        <div className="row gap-12" style={{ alignItems: 'center' }}>
          <Stat label="Celkem" value={String(data.total)} />
          <Stat
            label="Nových"
            value={String(data.newCount)}
            tone={data.newCount > 0 ? 'accent' : undefined}
          />
        </div>
      </div>

      <Form
        method="get"
        className="row gap-10"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <Field label="Stav">
          <NiceSelect
            name="status"
            defaultValue={data.filters.status}
            placeholder="— všechny —"
            ariaLabel="Filtr podle stavu"
            width={180}
            options={[
              { value: '', label: '— všechny —' },
              ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
          />
        </Field>
        <Field label="Typ">
          <NiceSelect
            name="type"
            defaultValue={data.filters.type}
            placeholder="— všechny —"
            ariaLabel="Filtr podle typu"
            width={200}
            options={[
              { value: '', label: '— všechny —' },
              ...TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })),
            ]}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-sm">
          Filtrovat
        </button>
        {hasFilters && (
          <a
            href="?"
            className="btn btn-soft btn-sm"
            style={{ textDecoration: 'none' }}
          >
            Reset
          </a>
        )}
      </Form>

      {data.rows.length === 0 ? (
        <div
          className="muted"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--surface)',
            padding: '28px 16px',
            textAlign: 'center',
            fontSize: 13,
          }}
        >
          {hasFilters
            ? 'Žádný feedback neodpovídá filtru.'
            : 'Zatím žádný feedback. Jakmile uživatel přes AI pošle submit_feedback, objeví se tady.'}
        </div>
      ) : (
        <div className="col gap-12">
          {data.rows.map((r) => (
            <FeedbackCard key={r.id} row={r} />
          ))}
        </div>
      )}

      {data.truncated && (
        <span className="muted" style={{ fontSize: 12 }}>
          Zobrazeno prvních {PAGE_LIMIT} záznamů — zúžte filtr.
        </span>
      )}
    </div>
  );
}

type Row = ReturnType<typeof useLoaderData<typeof loader>>['rows'][number];

function FeedbackCard({ row }: { row: Row }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--surface)',
        padding: '16px 18px',
      }}
      className="col gap-12"
    >
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row gap-8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone="type">{TYPE_LABEL[row.type] ?? row.type}</Badge>
          {row.sentiment && <SentimentBadge sentiment={row.sentiment} />}
          <StatusBadge status={row.status} />
        </div>
        <span className="mono faint" style={{ fontSize: 11 }}>
          {new Date(row.ts).toLocaleString('cs-CZ')}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{row.message}</p>

      {row.context && (
        <p
          className="muted"
          style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}
        >
          <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>
            KONTEXT ·{' '}
          </span>
          {row.context}
        </p>
      )}

      <div
        className="row gap-12"
        style={{ flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-3)' }}
      >
        {row.shopId ? (
          <Link
            to={`/admin/shops/${row.shopId}`}
            className="mono"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            {row.domain ?? row.shopId}
          </Link>
        ) : (
          <span className="mono">{row.domain ?? '— smazaný shop —'}</span>
        )}
        {row.ownerEmail && <span>{row.ownerEmail}</span>}
        {row.source && (
          <span className="mono faint">přes {row.source}</span>
        )}
      </div>

      <Form
        method="post"
        className="row gap-8"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 2 }}
      >
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="id" value={row.id} />
        <Field label="Stav">
          <select
            name="status"
            defaultValue={row.status}
            style={selectStyle}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <label className="col gap-4" style={{ flex: 1, minWidth: 220 }}>
          <span style={fieldLabelStyle}>Interní poznámka</span>
          <input
            name="adminNote"
            defaultValue={row.adminNote ?? ''}
            placeholder="triage / odkaz na issue…"
            style={{ ...selectStyle, width: '100%' }}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Uložit
        </button>
      </Form>

      <Form method="post" style={{ marginTop: -4 }}>
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={row.id} />
        <button
          type="submit"
          className="btn btn-soft btn-sm"
          style={{ color: 'var(--err)' }}
        >
          Smazat
        </button>
      </Form>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'type';
}) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: 'var(--bg-2)',
        color: 'var(--ink-2)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
      data-tone={tone}
    >
      {children}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const color =
    sentiment === 'positive'
      ? 'var(--ok, #16a34a)'
      : sentiment === 'negative'
        ? 'var(--err)'
        : 'var(--ink-3)';
  const label =
    sentiment === 'positive'
      ? '▲ pozitivní'
      : sentiment === 'negative'
        ? '▼ negativní'
        : '· neutrální';
  return (
    <span className="mono" style={{ fontSize: 10.5, color }}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const accent = status === 'new';
  const muted = status === 'done' || status === 'declined';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 6,
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--line)'}`,
        background: accent ? 'var(--accent)' : 'transparent',
        color: accent ? 'var(--bg)' : muted ? 'var(--ink-4)' : 'var(--ink-2)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="col gap-4" style={{ minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'accent';
}) {
  return (
    <div
      style={{
        padding: '8px 14px',
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
        textAlign: 'right',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9.5,
          color: 'var(--ink-3)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 16,
          color: tone === 'accent' ? 'var(--accent)' : 'var(--ink)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.10em',
  color: 'var(--ink-3)',
  textTransform: 'uppercase',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '7px 10px',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'inherit',
};
