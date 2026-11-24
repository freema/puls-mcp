import { and, eq, gt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Form, redirect, useLoaderData } from 'react-router';
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthPendingSessions,
  type PlatformId,
} from '@puls/db/schema';
import type { Route } from './+types/auth.mcp-connect';
import { getDb } from '~/lib/db';
import { getSessionUser } from '~/lib/auth/session.server';
import { listShopsForEmail } from '~/lib/auth/shops-for-user.server';
import {
  AUTH_CODE_TTL_MS,
  generateOpaqueToken,
} from '~/lib/oauth/oauth.server';
import { NiceSelect } from '~/components/ui/nice-select';

/** Tool categories shown on the consent screen — must match TOOL_CATEGORIES in mcp-server. */
const TOOL_CATEGORIES = [
  {
    id: 'orders',
    label: 'Objednávky',
    desc: 'Čtení seznamu, detailů a změn objednávek.',
    write: false,
    defaultOn: true,
  },
  {
    id: 'products',
    label: 'Produkty',
    desc: 'Čtení katalogu produktů a detailů.',
    write: false,
    defaultOn: true,
  },
  {
    id: 'customers',
    label: 'Zákazníci',
    desc: 'Čtení seznamu a detailů zákazníků.',
    write: false,
    defaultOn: true,
  },
  {
    id: 'catalog',
    label: 'Katalog (eshop info)',
    desc: 'Sklady, kategorie, metadata eshopu.',
    write: false,
    defaultOn: true,
  },
  {
    id: 'insights',
    label: 'Insights (přehledy)',
    desc: 'Souhrn prodejů, top zákazníci, nízké zásoby — agregace nad objednávkami a produkty.',
    write: false,
    defaultOn: true,
  },
  {
    id: 'write',
    label: 'Zápisové akce',
    desc: 'Změna stavu objednávky, produktů, cen, skladu i poznámek u zákazníků. Klient bude moci váš eshop měnit, ne jen číst. Zápis proběhne okamžitě a kdykoliv ho vrátíte v dashboardu (Historie zápisů).',
    write: true,
    defaultOn: false,
  },
  {
    id: 'memory',
    label: 'Paměť (preference a kontext)',
    desc: 'Klient si může pamatovat vaše preference a naučený kontext napříč konverzacemi (např. preferované filtry, fakta o eshopu). Vyžaduje zapnutí paměti v dashboardu.',
    write: false,
    defaultOn: true,
  },
] as const;

type LoaderData = {
  mcpState: string;
  clientName: string;
  shops: {
    id: string;
    domain: string;
    name: string | null;
    platform: PlatformId;
  }[];
  redirectHost: string;
  scope: string | null;
};

/** Lidsky čitelný štítek platformy do shop-pickeru (jeden účet = obě platformy). */
const PLATFORM_LABEL: Record<string, string> = {
  shoptet: 'Shoptet',
  upgates: 'Upgates',
};

async function loadPendingOrThrow(
  db: ReturnType<typeof getDb>,
  mcpState: string
) {
  const [row] = await db
    .select()
    .from(oauthPendingSessions)
    .where(
      and(
        eq(oauthPendingSessions.mcpState, mcpState),
        gt(oauthPendingSessions.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}

export async function loader({
  request,
}: Route.LoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const mcpState = url.searchParams.get('mcp_state');
  if (!mcpState) {
    throw new Response('Missing mcp_state', { status: 400 });
  }

  const db = getDb();
  const user = await getSessionUser(db, request);
  if (!user) {
    const cb = `/auth/mcp-connect?mcp_state=${encodeURIComponent(mcpState)}`;
    throw redirect(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }

  const pending = await loadPendingOrThrow(db, mcpState);
  if (!pending) {
    throw new Response('OAuth session expired', { status: 400 });
  }

  let clientName = 'MCP Client';
  if (pending.clientId) {
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, pending.clientId))
      .limit(1);
    if (client) clientName = client.clientName;
  }

  const owned = await listShopsForEmail(db, user.email);
  const redirectHost = (() => {
    try {
      return new URL(pending.redirectUri).host;
    } catch {
      return pending.redirectUri;
    }
  })();

  return {
    mcpState,
    clientName,
    shops: owned.map((s) => ({
      id: s.id,
      domain: s.domain,
      name: s.name,
      platform: s.platform,
    })),
    redirectHost,
    scope: pending.scope,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const mcpState = String(formData.get('mcp_state') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const shopId = String(formData.get('shop_id') ?? '');

  if (!mcpState) throw new Response('Missing mcp_state', { status: 400 });

  const db = getDb();
  const user = await getSessionUser(db, request);
  if (!user) throw redirect('/login');

  const pending = await loadPendingOrThrow(db, mcpState);
  if (!pending) throw new Response('OAuth session expired', { status: 400 });

  if (decision !== 'allow') {
    await db
      .delete(oauthPendingSessions)
      .where(eq(oauthPendingSessions.id, pending.id));
    const url = new URL(pending.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (pending.clientState) url.searchParams.set('state', pending.clientState);
    throw redirect(url.toString());
  }

  if (!shopId) {
    throw new Response('Missing shop_id', { status: 400 });
  }

  const owned = await listShopsForEmail(db, user.email);
  const shop = owned.find((s) => s.id === shopId);
  if (!shop) {
    throw new Response('You do not own this shop', { status: 403 });
  }

  // Tool permissions — checkbox is "tool_<id>=on" when enabled. Anything not
  // checked goes into disabled_tools CSV.
  const validIds: string[] = TOOL_CATEGORIES.map((t) => t.id);
  const validSet = new Set<string>(validIds);
  const enabledIds = new Set<string>();
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith('tool_')) continue;
    const id = k.slice('tool_'.length);
    if (!validSet.has(id)) continue;
    if (v === 'on' || v === 'true') enabledIds.add(id);
  }
  const disabledIds = validIds.filter((id) => !enabledIds.has(id));
  // Always store a string (even empty). null is reserved for legacy tokens
  // that predate the consent UI — see parseDisabledTools in mcp-server.
  const disabledTools = disabledIds.join(',');

  const code = generateOpaqueToken(32);
  const codeHash = createHash('sha256').update(code).digest('hex');

  await db.insert(oauthAuthorizationCodes).values({
    codeHash,
    userId: user.id,
    shopId,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    state: pending.clientState,
    scope: pending.scope,
    disabledTools,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });

  await db
    .delete(oauthPendingSessions)
    .where(eq(oauthPendingSessions.id, pending.id));

  const url = new URL(pending.redirectUri);
  url.searchParams.set('code', code);
  if (pending.clientState) url.searchParams.set('state', pending.clientState);
  throw redirect(url.toString());
}

export default function McpConnectPage() {
  const { mcpState, clientName, shops, redirectHost, scope } =
    useLoaderData<typeof loader>();

  if (shops.length === 0) {
    return (
      <main className="consent-page">
        <div className="consent-card consent-card--narrow">
          <div className="consent-eyebrow">Puls · MCP autorizace</div>
          <h1 className="consent-title">Žádný eshop k propojení</h1>
          <p className="consent-lede">
            Pod tímto účtem zatím nemáte žádný aktivní eshop. Nejdřív
            nainstalujte Puls v administraci svého eshopu (Shoptet nebo Upgates)
            a vraťte se sem.
          </p>
          <a href="/dashboard" className="btn btn-primary" style={{ marginTop: 8 }}>
            Na dashboard
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="consent-page">
      <div className="consent-card">
        <div className="consent-eyebrow">Puls · MCP autorizace</div>
        <h1 className="consent-title">
          {clientName} chce přístup k vašemu eshopu
        </h1>
        <p className="consent-lede">
          Po povolení dostane <b>{clientName}</b> oprávnění používat vybrané
          nástroje na zvoleném eshopu přes MCP. Token vyprší za 180 dní a můžete
          ho kdykoliv odvolat v dashboardu. Přesměrujeme zpět na{' '}
          <code>{redirectHost}</code>.
        </p>

        <Form method="post" className="consent-form">
          <input type="hidden" name="mcp_state" value={mcpState} />

          <div className="consent-field">
            <label className="consent-label">Eshop</label>
            <NiceSelect
              name="shop_id"
              required
              defaultValue={shops[0]!.id}
              ariaLabel="Vyberte eshop"
              options={shops.map((s) => {
                const base = s.name ? `${s.name} — ${s.domain}` : s.domain;
                const platform = PLATFORM_LABEL[s.platform] ?? s.platform;
                return { value: s.id, label: `${base} (${platform})` };
              })}
            />
          </div>

          <div className="consent-field">
            <div className="consent-label">
              Nástroje, ke kterým bude mít klient přístup
            </div>
            <div className="consent-tools">
              {TOOL_CATEGORIES.map((tool) => (
                <label
                  key={tool.id}
                  className={`consent-tool${tool.write ? ' consent-tool--write' : ''}`}
                >
                  <input
                    type="checkbox"
                    name={`tool_${tool.id}`}
                    defaultChecked={tool.defaultOn}
                    className="consent-tool-checkbox"
                  />
                  <span className="consent-tool-body">
                    <span className="consent-tool-title">
                      {tool.label}
                      {tool.write ? (
                        <span className="consent-tool-badge">Mění data</span>
                      ) : null}
                    </span>
                    <span className="consent-tool-desc">{tool.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {scope ? (
            <p className="consent-scope">Scope: {scope}</p>
          ) : null}

          <div className="consent-actions">
            <button
              type="submit"
              name="decision"
              value="deny"
              className="btn btn-soft"
            >
              Zamítnout
            </button>
            <button
              type="submit"
              name="decision"
              value="allow"
              className="btn btn-primary"
            >
              Povolit přístup
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
}
