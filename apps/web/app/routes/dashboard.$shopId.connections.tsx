import { and, eq, isNull } from 'drizzle-orm';
import { Form, redirect, useLoaderData } from 'react-router';
import { oauthAccessTokens, oauthClients, shops } from '@puls/db/schema';
import type { Route } from './+types/dashboard.$shopId.connections';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';

type ConnectionRow = {
  id: string;
  clientName: string | null;
  scope: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
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
      id: oauthAccessTokens.id,
      clientName: oauthClients.clientName,
      scope: oauthAccessTokens.scope,
      createdAt: oauthAccessTokens.createdAt,
      expiresAt: oauthAccessTokens.expiresAt,
      lastUsedAt: oauthAccessTokens.lastUsedAt,
    })
    .from(oauthAccessTokens)
    .leftJoin(
      oauthClients,
      eq(oauthAccessTokens.oauthClientId, oauthClients.id)
    )
    .where(
      and(
        eq(oauthAccessTokens.shopId, shopId),
        isNull(oauthAccessTokens.revokedAt)
      )
    )
    .orderBy(oauthAccessTokens.createdAt);

  const connections: ConnectionRow[] = rows.map((r) => ({
    id: r.id,
    clientName: r.clientName,
    scope: r.scope,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));

  return { shopName: shop.name ?? shop.domain, connections };
}

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const formData = await request.formData();
  const tokenId = String(formData.get('token_id') ?? '');
  if (!tokenId) throw new Response('Missing token_id', { status: 400 });

  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (
    !shop ||
    !shop.adminEmail ||
    shop.adminEmail.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new Response('Forbidden', { status: 403 });
  }

  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthAccessTokens.id, tokenId),
        eq(oauthAccessTokens.shopId, shopId)
      )
    );

  throw redirect(`/dashboard/${shopId}/connections`);
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('cs-CZ');
  } catch {
    return iso;
  }
}

export default function ConnectionsPage() {
  const { shopName, connections } = useLoaderData<typeof loader>();
  return (
    <div style={{ padding: '24px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 24 }}>
        <h2
          style={{
            fontSize: 32,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            fontWeight: 600,
            margin: 0,
            marginBottom: 8,
            color: 'var(--ink)',
          }}
        >
          Připojení AI klientů
        </h2>
        <p
          className="muted"
          style={{ fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 640 }}
        >
          Aktivní OAuth Bearer tokeny pro shop <b>{shopName}</b>. Revoke
          přeruší spojení daného klienta okamžitě.
        </p>
      </div>

      <section
        className="card"
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Klient</th>
                <th>Scope</th>
                <th>Vytvořen</th>
                <th>Naposledy použit</th>
                <th>Expirace</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="muted"
                    style={{ padding: '24px 22px', fontSize: 13 }}
                  >
                    —
                  </td>
                </tr>
              ) : (
                connections.map((c) => (
                  <tr key={c.id}>
                    <td>{c.clientName ?? '—'}</td>
                    <td
                      className="mono"
                      style={{ fontSize: 12 }}
                    >
                      {c.scope ?? 'mcp:read mcp:write'}
                    </td>
                    <td>{fmt(c.createdAt)}</td>
                    <td>{fmt(c.lastUsedAt)}</td>
                    <td>{fmt(c.expiresAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="token_id" value={c.id} />
                        <button
                          type="submit"
                          className="btn btn-soft btn-sm"
                        >
                          Revoke
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
