import {
  Form,
  redirect,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { ArrowRight, Plug, Sparkles, Zap } from 'lucide-react';
import type { Route } from './+types/dashboard._index';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { listShopsForEmail } from '~/lib/auth/shops-for-user.server';
import { getConfig } from '~/lib/config';
import { createDemoShopForEmail } from '~/lib/demo-shop.server';
import { SiteHeader } from '~/components/header';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const mine = await listShopsForEmail(db, user.email);

  if (mine.length === 1) {
    throw redirect(`/dashboard/${mine[0].id}`);
  }
  if (mine.length > 1) {
    throw redirect('/dashboard/select');
  }

  const cfg = getConfig();
  return {
    email: user.email,
    devEnabled: cfg.NODE_ENV !== 'production',
  };
}

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const cfg = getConfig();

  if (cfg.NODE_ENV === 'production') {
    throw new Response('Demo install is dev-only', { status: 403 });
  }

  const formData = await request.formData();
  if (formData.get('intent') !== 'demo-shop') {
    throw new Response('Bad request', { status: 400 });
  }

  const { shopId } = await createDemoShopForEmail(db, cfg, user.email);
  throw redirect(`/dashboard/${shopId}`);
}

export default function DashboardIndex() {
  const { email, devEnabled } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';

  return (
    <>
      <SiteHeader />
      <main
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '56px 24px 96px',
        }}
      >
        <div style={{ marginBottom: 36 }}>
          <span className="eyebrow">Dashboard</span>
          <h1 className="heading-1" style={{ marginTop: 12, marginBottom: 14 }}>
            Vítejte v Puls Dashboardu.
          </h1>
          <p
            className="muted"
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              margin: 0,
              maxWidth: 620,
            }}
          >
            Přihlášený jako{' '}
            <b style={{ color: 'var(--ink)' }}>{email}</b>. Připoj svůj
            e-shop k Pulsu — přes{' '}
            <b style={{ color: 'var(--ink)' }}>Shoptet</b> nebo{' '}
            <b style={{ color: 'var(--ink)' }}>Upgates</b>. Pak se sem vrátíš a uvidíš živý dashboard s endpoint
            URL, statistikami a aktivitou.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}
        >
          <article
            className="card card-pad"
            style={{
              padding: 24,
              background:
                'linear-gradient(180deg, rgba(34,197,94,0.06), var(--surface) 60%)',
              borderColor: 'rgba(34,197,94,0.20)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div className="row gap-10" style={{ alignItems: 'center' }}>
              <span
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.32)',
                  color: '#22C55E',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Plug size={18} />
              </span>
              <h3 className="heading-3" style={{ margin: 0 }}>
                Připoj svůj e-shop
              </h3>
              <span
                className="pill"
                style={{
                  marginLeft: 'auto',
                  color: '#22C55E',
                  background: 'rgba(34,197,94,0.10)',
                  borderColor: 'rgba(34,197,94,0.32)',
                }}
              >
                Shoptet · Upgates
              </span>
            </div>
            <p
              className="muted"
              style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}
            >
              Puls se instaluje jako doplněk přímo v adminu e-shopu —
              na Shoptetu z marketplace (OAuth), na Upgates jako ověřený
              doplněk — bez ručního vkládání API klíčů. Přístup se předá
              automaticky a po instalaci se sem vrátíš s plně funkčním MCP
              endpointem.
            </p>
          </article>

          {devEnabled ? (
            <article
              className="card card-pad"
              style={{
                padding: 24,
                background:
                  'linear-gradient(180deg, rgba(103,232,249,0.06), var(--surface) 60%)',
                borderColor: 'rgba(103,232,249,0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div className="row gap-10" style={{ alignItems: 'center' }}>
                <span
                  aria-hidden
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(103,232,249,0.15)',
                    border: '1px solid rgba(103,232,249,0.40)',
                    color: '#67E8F9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Sparkles size={18} />
                </span>
                <h3 className="heading-3" style={{ margin: 0 }}>
                  Vytvořit demo obchod
                </h3>
                <span
                  className="pill"
                  style={{
                    marginLeft: 'auto',
                    color: '#67E8F9',
                    background: 'rgba(103,232,249,0.10)',
                    borderColor: 'rgba(103,232,249,0.32)',
                  }}
                >
                  DEV
                </span>
              </div>
              <p
                className="muted"
                style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}
              >
                Pro vývoj a testování — vytvoří fiktivní obchod
                přiřazený k vašemu e-mailu s funkčním MCP endpointem
                proti mocku platformy. Hned uvidíte plný dashboard.
              </p>
              <Form
                method="post"
                action="/dashboard?index"
                style={{ marginTop: 'auto' }}
              >
                <input type="hidden" name="intent" value="demo-shop" />
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn"
                  style={{
                    border: '1px solid rgba(103,232,249,0.40)',
                    color: '#67E8F9',
                    background: 'rgba(103,232,249,0.10)',
                    cursor: submitting ? 'progress' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? 'Vytvářím…' : 'Vytvořit demo obchod'}
                  {!submitting && <ArrowRight size={14} />}
                </button>
              </Form>
            </article>
          ) : null}
        </div>

        <section className="card card-pad" style={{ padding: 24 }}>
          <div className="row gap-10" style={{ marginBottom: 14 }}>
            <Zap size={16} color="var(--accent)" />
            <h4
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              Co uvidíte po napojení
            </h4>
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              color: 'var(--ink-2)',
              fontSize: 13.5,
              lineHeight: 1.75,
            }}
          >
            <li>
              Vlastní MCP endpoint URL pro Claude Desktop, ChatGPT,
              Cursor nebo Continue.
            </li>
            <li>
              Spotřebu kvóty, top tooly, latenci a posledních 50 volání
              s detailem.
            </li>
            <li>
              Přepínače jednotlivých MCP toolů podle vašeho tarifu.
            </li>
            <li>
              Setup wizard, který vás provede připojením do AI klienta.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
