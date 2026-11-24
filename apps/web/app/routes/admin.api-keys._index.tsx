import { desc } from 'drizzle-orm';
import { Form, useActionData, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.api-keys._index';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import {
  createAdminApiKey,
  listAdminApiKeys,
  revokeAdminApiKey,
} from '~/lib/admin-api/keys.server';

function maskShopKey(val: string | null | undefined) {
  if (!val) return '—';
  if (val.length <= 4) return 'sk_***';
  return `sk_${'*'.repeat(6)}${val.slice(-4)}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);

  const [shopRows, adminKeys] = await Promise.all([
    db
      .select({
        id: shops.id,
        domain: shops.domain,
        oauthMasked: shops.oauthAccessToken,
        webhookMasked: shops.webhookSignatureKey,
        mcpMasked: shops.mcpEndpointSecret,
      })
      .from(shops)
      .orderBy(desc(shops.installedAt))
      .limit(100),
    listAdminApiKeys(db),
  ]);

  return {
    shopRows: shopRows.map((r) => ({
      id: r.id,
      domain: r.domain,
      oauthMasked: maskShopKey(r.oauthMasked),
      webhookMasked: maskShopKey(r.webhookMasked),
      mcpMasked: maskShopKey(r.mcpMasked),
    })),
    adminKeys: adminKeys.map((k) => ({
      ...k,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireAdmin(db, request);

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'create') {
    const label = String(form.get('label') ?? '').trim();
    if (!label) return { error: 'Zadej popisek klíče.' };
    const { row, plainKey } = await createAdminApiKey(db, {
      label,
      createdByUserId: user.id,
    });
    return { createdKey: { plainKey, label: row.label } };
  }

  if (intent === 'revoke') {
    const id = String(form.get('id') ?? '');
    if (!id) return { error: 'Chybí id klíče.' };
    await revokeAdminApiKey(db, id);
    return { revoked: id };
  }

  return { error: 'Neznámá akce.' };
}

export default function AdminApiKeys() {
  const { shopRows, adminKeys } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const createdKey =
    actionData && 'createdKey' in actionData ? actionData.createdKey : null;
  const errorMsg =
    actionData && 'error' in actionData ? actionData.error : null;

  return (
    <div className="col gap-24" style={{ maxWidth: 1100 }}>
      <section className="col gap-12">
        <div className="col gap-4">
          <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
            Admin API klíče
          </h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Bearer tokeny pro veřejné Admin API (<code>/api/admin/...</code>).
            Plain hodnota se zobrazí jen jednou — ulož si ji hned.
          </span>
        </div>

        {createdKey && (
          <div
            data-testid="new-key-banner"
            style={{
              border: '1px solid var(--ok, #10b981)',
              borderRadius: 10,
              padding: 14,
              background: 'rgba(16, 185, 129, 0.06)',
            }}
            className="col gap-8"
          >
            <strong style={{ fontSize: 13 }}>
              Klíč vygenerován: {createdKey.label}
            </strong>
            <code
              className="mono"
              style={{
                fontSize: 12,
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                wordBreak: 'break-all',
              }}
            >
              {createdKey.plainKey}
            </code>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Po opuštění této stránky se hodnota už nezobrazí. V DB je jen
              SHA-256 hash.
            </span>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              border: '1px solid var(--err, #ef4444)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12.5,
              color: 'var(--err, #ef4444)',
            }}
          >
            {errorMsg}
          </div>
        )}

        <Form
          method="post"
          className="row gap-8"
          style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="intent" value="create" />
          <label className="col gap-4">
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.10em',
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
              }}
            >
              Popisek
            </span>
            <input
              name="label"
              required
              placeholder="např. Claude — error monitoring"
              style={{
                padding: '8px 10px',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                color: 'var(--ink)',
                minWidth: 320,
                fontSize: 13,
              }}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            Vygenerovat klíč
          </button>
        </Form>

        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          <table className="table" style={{ margin: 0, fontSize: 12.5, width: '100%' }}>
            <thead>
              <tr>
                <th>Popisek</th>
                <th>Prefix</th>
                <th style={{ width: 170 }}>Vytvořeno</th>
                <th style={{ width: 170 }}>Naposledy</th>
                <th style={{ width: 110 }}>Stav</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {adminKeys.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="muted"
                    style={{ padding: '20px 12px', textAlign: 'center' }}
                  >
                    Zatím žádné admin API klíče.
                  </td>
                </tr>
              ) : (
                adminKeys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {k.keyPrefix}…
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {new Date(k.createdAt).toLocaleString('cs-CZ')}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString('cs-CZ')
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={`pill ${k.revokedAt ? 'pill-err' : 'pill-ok'}`}
                        style={{ fontSize: 10 }}
                      >
                        {k.revokedAt ? 'revoked' : 'active'}
                      </span>
                    </td>
                    <td>
                      {!k.revokedAt && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="revoke" />
                          <input type="hidden" name="id" value={k.id} />
                          <button
                            type="submit"
                            className="btn btn-soft btn-sm"
                            style={{ fontSize: 11 }}
                          >
                            Zrušit
                          </button>
                        </Form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="col gap-8">
        <h2 className="heading-3" style={{ margin: 0, fontSize: 16 }}>
          Klíče obchodů (jen náhled)
        </h2>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          <table className="table" style={{ margin: 0, fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th>Shop</th>
                <th>OAuth</th>
                <th>Webhook</th>
                <th>MCP</th>
              </tr>
            </thead>
            <tbody>
              {shopRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.domain}</td>
                  <td className="mono">{r.oauthMasked}</td>
                  <td className="mono">{r.webhookMasked}</td>
                  <td className="mono">{r.mcpMasked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
