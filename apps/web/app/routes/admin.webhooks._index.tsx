import { desc, eq } from 'drizzle-orm';
import { Form, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.webhooks._index';
import { webhookNotifications, shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';

const PAGE_LIMIT = 250;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const url = new URL(request.url);
  const shopFilter = url.searchParams.get('shop') ?? '';
  const eventFilter = url.searchParams.get('event') ?? '';
  const stateFilter = url.searchParams.get('state') ?? '';

  const rows = await db
    .select({
      id: webhookNotifications.id,
      shopId: webhookNotifications.shopId,
      domain: shops.domain,
      adminEmail: shops.adminEmail,
      event: webhookNotifications.event,
      eventInstance: webhookNotifications.eventInstance,
      payload: webhookNotifications.payload,
      processed: webhookNotifications.processed,
      error: webhookNotifications.error,
      createdAt: webhookNotifications.createdAt,
    })
    .from(webhookNotifications)
    .leftJoin(shops, eq(webhookNotifications.shopId, shops.id))
    .orderBy(desc(webhookNotifications.createdAt))
    .limit(PAGE_LIMIT);

  const allShops = await db
    .select({ id: shops.id, domain: shops.domain })
    .from(shops);

  const eventOptions = Array.from(new Set(rows.map((r) => r.event))).sort();

  let filtered = rows;
  if (shopFilter) filtered = filtered.filter((r) => r.shopId === shopFilter);
  if (eventFilter) filtered = filtered.filter((r) => r.event === eventFilter);
  if (stateFilter === 'ok')
    filtered = filtered.filter((r) => r.processed && !r.error);
  else if (stateFilter === 'pending')
    filtered = filtered.filter((r) => !r.processed && !r.error);
  else if (stateFilter === 'error')
    filtered = filtered.filter((r) => !!r.error);

  const counts = {
    total: rows.length,
    ok: rows.filter((r) => r.processed && !r.error).length,
    pending: rows.filter((r) => !r.processed && !r.error).length,
    error: rows.filter((r) => !!r.error).length,
  };

  return {
    rows: filtered.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      payloadPreview: JSON.stringify(r.payload as unknown).slice(0, 180),
      payloadTruncated:
        JSON.stringify(r.payload as unknown).length > 180,
    })),
    counts,
    shopOptions: allShops.sort((a, b) => a.domain.localeCompare(b.domain)),
    eventOptions,
    filters: {
      shop: shopFilter,
      event: eventFilter,
      state: stateFilter,
    },
  };
}

export default function AdminWebhooks() {
  const data = useLoaderData<typeof loader>();
  const hasFilters =
    !!data.filters.shop || !!data.filters.event || !!data.filters.state;

  return (
    <div className="col gap-16" style={{ maxWidth: 1200 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="col gap-4">
          <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
            Webhooky z platforem (Shoptet, Upgates)
          </h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Posledních {PAGE_LIMIT} záznamů z tabulky{' '}
            <span className="mono">webhook_notifications</span>. Notifikace
            s neplatným HMAC podpisem se sem neukládají — endpoint vrací 401.
          </span>
        </div>
        <div className="row gap-12">
          <Stat label="Celkem" value={String(data.counts.total)} />
          <Stat label="OK" value={String(data.counts.ok)} tone="ok" />
          <Stat
            label="Čeká"
            value={String(data.counts.pending)}
            tone={data.counts.pending > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Chyba"
            value={String(data.counts.error)}
            tone={data.counts.error > 0 ? 'err' : undefined}
          />
        </div>
      </div>

      <Form
        method="get"
        className="row gap-10"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <Field label="Shop">
          <select
            name="shop"
            defaultValue={data.filters.shop}
            style={selectStyle}
          >
            <option value="">— všechny obchody —</option>
            {data.shopOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.domain}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Událost">
          <select
            name="event"
            defaultValue={data.filters.event}
            style={selectStyle}
          >
            <option value="">— všechny —</option>
            {data.eventOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stav">
          <select
            name="state"
            defaultValue={data.filters.state}
            style={selectStyle}
          >
            <option value="">— všechny —</option>
            <option value="ok">zpracováno</option>
            <option value="pending">čeká</option>
            <option value="error">chyba</option>
          </select>
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

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <table
          className="table"
          style={{ margin: 0, fontSize: 12.5, width: '100%' }}
        >
          <thead>
            <tr>
              <th style={{ width: 170 }}>Čas</th>
              <th>Shop</th>
              <th>Událost</th>
              <th style={{ width: 110 }}>Stav</th>
              <th>Payload (náhled)</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="muted"
                  style={{ padding: '24px 12px', textAlign: 'center' }}
                >
                  {hasFilters
                    ? 'Žádné webhooky neodpovídají filtru.'
                    : 'Žádné webhooky zatím nedorazily.'}
                </td>
              </tr>
            ) : (
              data.rows.map((r) => {
                const tone = r.error
                  ? 'pill-err'
                  : r.processed
                    ? 'pill-ok'
                    : 'pill-warn';
                const stateLabel = r.error
                  ? `chyba${r.error ? ` · ${r.error}` : ''}`
                  : r.processed
                    ? 'zpracováno'
                    : 'čeká';
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {new Date(r.createdAt).toLocaleString('cs-CZ')}
                    </td>
                    <td>{r.domain ?? r.shopId ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {r.event}
                    </td>
                    <td>
                      <span
                        className={`pill ${tone}`}
                        style={{ fontSize: 10 }}
                        title={r.error ?? undefined}
                      >
                        {stateLabel}
                      </span>
                    </td>
                    <td
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-3)',
                        maxWidth: 420,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.payloadPreview}
                    >
                      {r.payloadPreview}
                      {r.payloadTruncated ? '…' : ''}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  padding: '6px 10px',
  borderRadius: 7,
  fontSize: 13,
  minWidth: 160,
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="col gap-4" style={{ minWidth: 0 }}>
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.10em',
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
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
  tone?: 'ok' | 'err' | 'warn';
}) {
  const color =
    tone === 'err'
      ? 'var(--err)'
      : tone === 'warn'
        ? 'var(--warn, var(--ink))'
        : tone === 'ok'
          ? 'var(--ok, var(--ink))'
          : 'var(--ink)';
  return (
    <div
      style={{
        padding: '8px 14px',
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
        textAlign: 'right',
        minWidth: 80,
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
      <div className="mono" style={{ fontSize: 16, color, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}
