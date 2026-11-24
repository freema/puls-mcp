import { eq } from 'drizzle-orm';
import { Form, Link, useLoaderData } from 'react-router';
import {
  Info,
  KeyRound,
  LogOut,
  Mail,
  Shield,
  Store,
} from 'lucide-react';
import { users } from '@puls/db/schema';
import type { Route } from './+types/nastaveni';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import {
  isAdminEmail,
  listShopsForEmail,
} from '~/lib/auth/shops-for-user.server';
import { SiteHeader } from '~/components/header';

export const meta: Route.MetaFunction = () => [{ title: 'Nastavení účtu — Puls' }];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      googleSub: users.googleSub,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const shops = await listShopsForEmail(db, user.email);

  return {
    user: {
      email: row?.email ?? user.email,
      provider: row?.googleSub ? ('google' as const) : ('email' as const),
      createdAt: row?.createdAt ?? null,
      isAdmin: isAdminEmail(user.email),
    },
    shopCount: shops.length,
  };
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function NastaveniPage() {
  const { user, shopCount } = useLoaderData<typeof loader>();

  return (
    <div
      className="min-h-dvh"
      style={{ background: 'var(--bg)', color: 'var(--ink)' }}
    >
      <SiteHeader />
      <main
        style={{ maxWidth: 800, margin: '0 auto', padding: '56px 24px 96px' }}
      >
        <div className="row gap-10" style={{ marginBottom: 12 }}>
          <Shield size={16} color="var(--accent)" />
          <span className="eyebrow">Nastavení účtu</span>
        </div>
        <h1 className="heading-1" style={{ marginTop: 12, marginBottom: 12 }}>
          Váš účet v Puls.
        </h1>
        <p className="lede" style={{ maxWidth: 580, marginBottom: 36 }}>
          Tady najdete přehled svého přihlášení. Nastavení jednotlivých
          obchodů (kvóty, tooly, webhooky) je v dashboardu konkrétního
          obchodu.
        </p>

        <section
          className="card card-pad"
          style={{ padding: 24, marginBottom: 16 }}
        >
          <h2 className="heading-3" style={{ margin: '0 0 14px', fontSize: 16 }}>
            Profil
          </h2>
          <Row
            icon={<Mail size={14} />}
            label="E-mail"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {user.email}
                {user.isAdmin && (
                  <span className="pill pill-accent" style={{ fontSize: 10 }}>
                    Admin
                  </span>
                )}
              </span>
            }
          />
          <Row
            icon={<KeyRound size={14} />}
            label="Způsob přihlášení"
            value={
              user.provider === 'google'
                ? 'Google (OAuth)'
                : 'E-mail (jednorázový kód)'
            }
          />
          <Row
            icon={<Info size={14} />}
            label="Účet vytvořen"
            value={formatDate(user.createdAt)}
            last
          />
        </section>

        <section
          className="card card-pad"
          style={{ padding: 24, marginBottom: 16 }}
        >
          <div className="row between" style={{ marginBottom: 6 }}>
            <h2 className="heading-3" style={{ margin: 0, fontSize: 16 }}>
              Vaše obchody
            </h2>
            <span className="pill" style={{ fontSize: 10 }}>
              {shopCount} připojeno
            </span>
          </div>
          <p
            className="muted"
            style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}
          >
            {shopCount === 0
              ? 'Zatím nemáte připojený žádný e-shop. Připojení proběhne jako doplněk z marketplace vaší platformy — Shoptet nebo Upgates.'
              : shopCount === 1
                ? 'Máte připojený jeden obchod. Nastavení kvót a toolů řešíte v jeho dashboardu.'
                : `Máte připojených ${shopCount} obchodů. Mezi obchody můžete přepínat z výběru.`}
          </p>
          <div className="row gap-8">
            {shopCount > 0 && (
              <Link
                to={shopCount > 1 ? '/dashboard/select' : '/dashboard'}
                className="btn btn-soft btn-sm"
              >
                <Store size={13} />{' '}
                {shopCount > 1 ? 'Vybrat obchod' : 'Otevřít dashboard'}
              </Link>
            )}
          </div>
        </section>

        {user.isAdmin && (
          <section
            className="card card-pad"
            style={{
              padding: 24,
              marginBottom: 16,
              background:
                'linear-gradient(180deg, rgba(255,122,61,0.06), var(--surface) 60%)',
              borderColor: 'rgba(255,122,61,0.20)',
            }}
          >
            <h2 className="heading-3" style={{ margin: '0 0 6px', fontSize: 16 }}>
              Administrace
            </h2>
            <p
              className="muted"
              style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}
            >
              Máte přiřazenou administrátorskou roli — vidíte všechny obchody,
              logy a nastavení systému.
            </p>
            <Link to="/admin" className="btn btn-primary btn-sm">
              <Shield size={13} /> Otevřít admin panel
            </Link>
          </section>
        )}

        <section className="card card-pad" style={{ padding: 24 }}>
          <h2 className="heading-3" style={{ margin: '0 0 6px', fontSize: 16 }}>
            Bezpečnost
          </h2>
          <p
            className="muted"
            style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}
          >
            Pokud používáte Puls na sdíleném počítači, odhlaste se. Tím
            zneplatníte session cookie pro tento prohlížeč.
          </p>
          <Form method="post" action="/auth/logout" reloadDocument>
            <button
              type="submit"
              className="btn btn-soft btn-sm"
              style={{ color: 'var(--err)' }}
            >
              <LogOut size={13} /> Odhlásit se
            </button>
          </Form>
        </section>

        <section
          className="card card-pad"
          style={{
            padding: 24,
            marginTop: 16,
            borderColor: 'rgba(220, 60, 60, 0.28)',
            background:
              'linear-gradient(180deg, rgba(220,60,60,0.05), var(--surface) 70%)',
          }}
        >
          <h2 className="heading-3" style={{ margin: '0 0 6px', fontSize: 16 }}>
            Smazat účet
          </h2>
          <p
            className="muted"
            style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 8px' }}
          >
            Smaže uživatelský záznam (e-mail, vazbu na Google), všechny
            aktivní session a vydané OAuth bearer tokeny pro MCP klienty.
            Záznamy e-shopů samotné se nemažou — ty jsou vázané na
            instalaci doplňku ve vašem e-shopu.
          </p>
          <p
            className="muted"
            style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 14px' }}
          >
            Akce je nevratná.
          </p>
          <Form
            method="post"
            action="/nastaveni/delete-account"
            reloadDocument
            onSubmit={(e) => {
              if (
                !window.confirm(
                  'Opravdu chcete trvale smazat svůj účet? Tato akce je nevratná.'
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              className="btn btn-soft btn-sm"
              style={{
                color: 'var(--err)',
                borderColor: 'rgba(220, 60, 60, 0.4)',
              }}
            >
              Smazat účet trvale
            </button>
          </Form>
        </section>
      </main>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="row between"
      style={{
        padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid var(--line)',
        gap: 16,
      }}
    >
      <span className="row gap-10" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
        <span style={{ color: 'var(--ink-3)' }}>{icon}</span>
        {label}
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--ink)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
