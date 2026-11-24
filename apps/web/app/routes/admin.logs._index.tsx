import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { Form, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.logs._index';
import { mcpToolCalls, shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { NiceSelect } from '~/components/ui/nice-select';

type LogRow = {
  id: string;
  ts: number;
  shopId: string;
  domain: string;
  ownerEmail: string | null;
  tool: string;
  status: string;
  durationMs: number | null;
  detail: string | null;
};

const PAGE_LIMIT = 300;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const url = new URL(request.url);
  const shopFilter = url.searchParams.get('shop') ?? '';
  const statusFilter = url.searchParams.get('status') ?? '';
  const toolFilter = url.searchParams.get('tool') ?? '';

  const allShops = await db
    .select({
      id: shops.id,
      domain: shops.domain,
      adminEmail: shops.adminEmail,
    })
    .from(shops)
    .where(ne(shops.status, 'UNINSTALLED'));

  const shopMap = new Map(allShops.map((s) => [s.id, s]));

  const conditions = [];
  if (shopFilter) conditions.push(eq(mcpToolCalls.shopId, shopFilter));
  if (statusFilter) conditions.push(eq(mcpToolCalls.status, statusFilter));
  if (toolFilter) conditions.push(eq(mcpToolCalls.tool, toolFilter));
  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  const rowsRaw = await db
    .select({
      id: mcpToolCalls.id,
      shopId: mcpToolCalls.shopId,
      tool: mcpToolCalls.tool,
      status: mcpToolCalls.status,
      durationMs: mcpToolCalls.durationMs,
      errorMessage: mcpToolCalls.errorMessage,
      createdAt: mcpToolCalls.createdAt,
    })
    .from(mcpToolCalls)
    .where(whereClause)
    .orderBy(desc(mcpToolCalls.createdAt))
    .limit(PAGE_LIMIT + 1);

  const truncated = rowsRaw.length > PAGE_LIMIT;
  const rows: LogRow[] = rowsRaw.slice(0, PAGE_LIMIT).map((r) => {
    const shop = shopMap.get(r.shopId);
    return {
      id: r.id,
      ts: r.createdAt.getTime(),
      shopId: r.shopId,
      domain: shop?.domain ?? r.shopId,
      ownerEmail: shop?.adminEmail ?? null,
      tool: r.tool,
      status: r.status,
      durationMs: r.durationMs,
      detail: r.errorMessage,
    };
  });

  // Aggregate counters across the whole table (not just the page).
  const [{ totalAll = 0, errorsAll = 0 } = {}] = await db
    .select({
      totalAll: sql<number>`count(*)::int`,
      errorsAll: sql<number>`count(*) filter (where ${mcpToolCalls.status} <> 'ok')::int`,
    })
    .from(mcpToolCalls);

  const toolOptionsRaw = await db
    .selectDistinct({ tool: mcpToolCalls.tool })
    .from(mcpToolCalls)
    .orderBy(mcpToolCalls.tool);

  return {
    rows,
    truncated,
    totalAcrossShops: Number(totalAll),
    errorsAcrossShops: Number(errorsAll),
    shopOptions: allShops
      .map((s) => ({ id: s.id, domain: s.domain }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
    toolOptions: toolOptionsRaw.map((t) => t.tool),
    filters: { shop: shopFilter, status: statusFilter, tool: toolFilter },
  };
}

export default function AdminLogs() {
  const data = useLoaderData<typeof loader>();
  const hasFilters =
    !!data.filters.shop || !!data.filters.status || !!data.filters.tool;

  return (
    <div className="col gap-16" style={{ maxWidth: 1200 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="col gap-4">
          <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
            Logy MCP volání
          </h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Trvalá historie všech volání MCP toolů (PostgreSQL).
          </span>
        </div>
        <div className="row gap-12" style={{ alignItems: 'center' }}>
          <Stat label="Celkem (vše)" value={String(data.totalAcrossShops)} />
          <Stat
            label="Chyb"
            value={String(data.errorsAcrossShops)}
            tone={data.errorsAcrossShops > 0 ? 'err' : 'ok'}
          />
          <Stat label="Aktivních shopů" value={String(data.shopOptions.length)} />
        </div>
      </div>

      <Form
        method="get"
        className="row gap-10"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <Field label="Shop">
          <NiceSelect
            name="shop"
            defaultValue={data.filters.shop}
            placeholder="— všechny obchody —"
            ariaLabel="Filtr podle obchodu"
            width={240}
            options={[
              { value: '', label: '— všechny obchody —' },
              ...data.shopOptions.map((s) => ({
                value: s.id,
                label: s.domain,
              })),
            ]}
          />
        </Field>
        <Field label="Stav">
          <NiceSelect
            name="status"
            defaultValue={data.filters.status}
            placeholder="— všechny —"
            ariaLabel="Filtr podle stavu"
            width={160}
            options={[
              { value: '', label: '— všechny —' },
              { value: 'ok', label: 'ok' },
              { value: 'error', label: 'error' },
            ]}
          />
        </Field>
        <Field label="Nástroj">
          <NiceSelect
            name="tool"
            defaultValue={data.filters.tool}
            placeholder="— všechny —"
            ariaLabel="Filtr podle nástroje"
            width={240}
            options={[
              { value: '', label: '— všechny —' },
              ...data.toolOptions.map((t) => ({ value: t, label: t })),
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
          style={{
            margin: 0,
            fontSize: 12.5,
            width: '100%',
          }}
        >
          <thead>
            <tr>
              <th style={{ width: 170 }}>Čas</th>
              <th>Shop</th>
              <th>Vlastník (e-mail)</th>
              <th>Nástroj</th>
              <th style={{ width: 80 }}>Stav</th>
              <th style={{ width: 80, textAlign: 'right' }}>ms</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="muted"
                  style={{ padding: '24px 12px', textAlign: 'center' }}
                >
                  {hasFilters
                    ? 'Žádné záznamy neodpovídají filtru.'
                    : 'Zatím žádná aktivita. Po prvním MCP volání se sem začnou zapisovat události.'}
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {new Date(r.ts).toLocaleString('cs-CZ')}
                  </td>
                  <td>{r.domain}</td>
                  <td className="muted">{r.ownerEmail ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {r.tool}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        r.status === 'ok' ? 'pill-ok' : 'pill-err'
                      }`}
                      style={{ fontSize: 10 }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 11, textAlign: 'right', color: 'var(--ink-3)' }}
                  >
                    {r.durationMs ?? '—'}
                  </td>
                  <td
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      maxWidth: 360,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.detail ?? ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.truncated && (
        <span className="muted" style={{ fontSize: 12 }}>
          Zobrazeno prvních {PAGE_LIMIT} záznamů — zúžte filtr.
        </span>
      )}
    </div>
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
  tone?: 'ok' | 'err';
}) {
  const color =
    tone === 'err'
      ? 'var(--err)'
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
