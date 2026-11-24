import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { ArrowRight, ChevronRight, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Route } from './+types/dashboard.select';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { listShopsForEmail } from '~/lib/auth/shops-for-user.server';
import { getConfig } from '~/lib/config';
import { createDemoShopForEmail } from '~/lib/demo-shop.server';
import { SiteHeader } from '~/components/header';

const AVATAR_COLORS = ['#FF7A3D', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA'];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const shops = await listShopsForEmail(db, user.email);
  const cfg = getConfig();
  return {
    shops,
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

function PlatformConnectCard({
  to,
  name,
  desc,
  cta,
  accent,
}: {
  to: string;
  name: string;
  desc: string;
  cta: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '16px 18px',
        border: '1.5px dashed var(--line-2)',
        background: 'transparent',
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'var(--ink)',
        transition: 'all .15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.background = `${accent}0D`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-2)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div className="row gap-10" style={{ alignItems: 'center' }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: `${accent}1A`,
            border: `1px solid ${accent}55`,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          {name[0]}
        </span>
        <span
          style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}
        >
          {name}
        </span>
      </div>
      <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        {desc}
      </span>
      <span
        className="btn btn-soft btn-sm"
        style={{ alignSelf: 'flex-start', marginTop: 2 }}
      >
        {cta} <ArrowRight size={12} />
      </span>
    </Link>
  );
}

function initials(name: string | null, domain: string): string {
  const src = name ?? domain;
  const parts = src
    .replace(/[^a-zA-Z0-9 ·.-]/g, '')
    .split(/[ ·.-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

function relativeTime(date: Date | string | null): string {
  if (!date) return 'nikdy';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'teď';
  if (minutes < 60) return `před ${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `před ${days} d`;
  return d.toLocaleDateString('cs-CZ');
}

function isNew(date: Date | string | null): boolean {
  if (!date) return false;
  const d = typeof date === 'string' ? new Date(date) : date;
  return Date.now() - d.getTime() < 60 * 60 * 1000;
}

export default function DashboardSelect() {
  const { shops, email, devEnabled } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState('');
  const nav = useNavigation();
  const submitting =
    nav.state !== 'idle' &&
    nav.formData?.get('intent') === 'demo-shop';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) =>
      `${s.name ?? ''} ${s.domain}`.toLowerCase().includes(q)
    );
  }, [shops, query]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const aT = a.installedAt ? new Date(a.installedAt).getTime() : 0;
        const bT = b.installedAt ? new Date(b.installedAt).getTime() : 0;
        return bT - aT;
      }),
    [filtered]
  );

  return (
    <>
      <SiteHeader />
      <main
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: 'clamp(40px, 6vw, 56px) 24px 80px',
        }}
      >
        <div className="col gap-8" style={{ marginBottom: 28 }}>
          <span className="eyebrow">Dashboard</span>
          <h1
            style={{
              fontSize: 36,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              fontWeight: 600,
              margin: 0,
              color: 'var(--ink)',
            }}
          >
            Vyberte obchod
          </h1>
          <p
            className="muted"
            style={{
              fontSize: 14.5,
              lineHeight: 1.55,
              maxWidth: 520,
              margin: 0,
            }}
          >
            {shops.length === 0 ? (
              <>
                Zatím nemáte žádný obchod. Puls běží na{' '}
                <b style={{ color: 'var(--ink)' }}>Shoptetu</b> i{' '}
                <b style={{ color: 'var(--ink)' }}>Upgates</b> — vyberte
                platformu níže, nebo si vytvořte demo obchod pro testování.
                Přihlášený jako{' '}
                <b style={{ color: 'var(--ink)' }}>{email}</b>.
              </>
            ) : (
              <>
                Máte přístup k{' '}
                <b style={{ color: 'var(--ink)' }}>
                  {shops.length}{' '}
                  {shops.length === 1
                    ? 'obchodu'
                    : shops.length < 5
                      ? 'obchodům'
                      : 'obchodům'}
                </b>
                . Vyberte ten, který chcete spravovat — nastavení a MCP
                endpoint jsou pro každý shop oddělené. Přihlášený jako{' '}
                <b style={{ color: 'var(--ink)' }}>{email}</b>.
              </>
            )}
          </p>
        </div>

        <label
          className="row gap-10"
          style={{
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <Search size={14} color="var(--ink-3)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat podle názvu nebo domény…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ink)',
              fontFamily: 'var(--font)',
              fontSize: 13,
              minWidth: 0,
            }}
          />
          <span
            className="mono faint"
            style={{ fontSize: 11, flexShrink: 0 }}
          >
            ⌘K
          </span>
        </label>

        <div className="col gap-8" style={{ marginBottom: 24 }}>
          {sorted.map((s, i) => {
            const isMostRecent = i === 0 && !query;
            const fresh = isNew(s.installedAt);
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
            return (
              <Link
                key={s.id}
                to={`/dashboard/${s.id}`}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '16px 18px',
                  gap: 16,
                  cursor: 'pointer',
                  textDecoration: 'none',
                  color: 'var(--ink)',
                  transition:
                    'border-color .15s ease, transform .15s ease, box-shadow .15s ease',
                  borderColor: isMostRecent
                    ? 'rgba(255,122,61,0.30)'
                    : 'var(--line)',
                  background: isMostRecent
                    ? 'linear-gradient(180deg, rgba(255,122,61,0.05), var(--surface))'
                    : 'var(--surface)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line-2)';
                  e.currentTarget.style.transform = 'translateX(2px)';
                  e.currentTarget.style.boxShadow =
                    '0 8px 24px -16px rgba(0,0,0,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = isMostRecent
                    ? 'rgba(255,122,61,0.30)'
                    : 'var(--line)';
                  e.currentTarget.style.transform = 'translateX(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    background: `linear-gradient(135deg, ${color}, ${color}99)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: 14,
                    flexShrink: 0,
                    boxShadow: `0 6px 16px -8px ${color}80`,
                  }}
                  aria-hidden
                >
                  {initials(s.name, s.domain)}
                </div>

                <div
                  className="col gap-3"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <div
                    className="row gap-10"
                    style={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <span
                      style={{
                        fontSize: 14.5,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 320,
                      }}
                    >
                      {s.name ?? s.domain}
                    </span>
                    {isMostRecent ? (
                      <span
                        className="pill pill-accent"
                        style={{ fontSize: 9, padding: '2px 7px' }}
                      >
                        NAPOSLEDY
                      </span>
                    ) : null}
                    {fresh ? (
                      <span
                        className="pill pill-warn"
                        style={{ fontSize: 9, padding: '2px 7px' }}
                      >
                        NOVÝ · DOKONČIT SETUP
                      </span>
                    ) : null}
                  </div>
                  <span
                    className="mono faint"
                    style={{
                      fontSize: 11.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.domain}
                  </span>
                </div>

                <div
                  className="col gap-3"
                  style={{
                    alignItems: 'flex-end',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  <span
                    className={`pill ${
                      s.status === 'ACTIVE' ? 'pill-ok' : 'pill-warn'
                    }`}
                    style={{ fontSize: 10 }}
                  >
                    {s.status}
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Owner · instalováno {relativeTime(s.installedAt)}
                  </span>
                </div>

                <ChevronRight
                  size={16}
                  color="var(--ink-3)"
                  style={{ marginLeft: 4, flexShrink: 0 }}
                />
              </Link>
            );
          })}

          {sorted.length === 0 ? (
            <div
              className="card card-pad muted"
              style={{
                textAlign: 'center',
                padding: '32px 22px',
                fontSize: 13.5,
              }}
            >
              Pro „{query}" nic nenalezeno.
            </div>
          ) : null}
        </div>

        <div className="col gap-8">
          <div className="col gap-10">
            <span
              className="mono faint"
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {shops.length === 0
                ? 'Připojit obchod — vyberte platformu'
                : 'Přidat další obchod'}
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              <PlatformConnectCard
                to="https://github.com/freema/puls-mcp"
                name="Shoptet"
                accent="#FF7A3D"
                desc="Instalace z Shoptet marketplace — jeden klik, bez ručního vkládání API klíčů."
                cta="Marketplace"
              />
              <PlatformConnectCard
                to="https://github.com/freema/puls-mcp"
                name="Upgates"
                accent="#22C55E"
                desc="Ověřený doplněk v adminu Upgates — aktivace jedním klikem, přístup se předá automaticky."
                cta="Zdrojový kód (GitHub)"
              />
            </div>
          </div>

          {devEnabled ? (
            <Form method="post" style={{ display: 'contents' }}>
              <input type="hidden" name="intent" value="demo-shop" />
              <button
                type="submit"
                disabled={submitting}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '16px 18px',
                  gap: 14,
                  border: '1.5px dashed rgba(103,232,249,0.32)',
                  background: 'rgba(103,232,249,0.04)',
                  cursor: submitting ? 'progress' : 'pointer',
                  color: 'var(--ink)',
                  textAlign: 'left',
                  fontFamily: 'var(--font)',
                  transition: 'all .15s ease',
                  opacity: submitting ? 0.7 : 1,
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (submitting) return;
                  e.currentTarget.style.borderColor =
                    'rgba(103,232,249,0.55)';
                  e.currentTarget.style.background =
                    'rgba(103,232,249,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor =
                    'rgba(103,232,249,0.32)';
                  e.currentTarget.style.background =
                    'rgba(103,232,249,0.04)';
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    background: 'rgba(103,232,249,0.12)',
                    border: '1px solid rgba(103,232,249,0.32)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#67E8F9',
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  <Sparkles size={18} />
                </div>
                <div
                  className="col gap-2"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--ink)',
                      }}
                    >
                      Vytvořit demo obchod
                    </span>
                    <span
                      className="pill"
                      style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        color: '#67E8F9',
                        background: 'rgba(103,232,249,0.10)',
                        borderColor: 'rgba(103,232,249,0.32)',
                      }}
                    >
                      DEV
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Fiktivní obchod přiřazený k vašemu e-mailu —
                    funkční MCP endpoint proti mocku platformy.
                  </span>
                </div>
                <span
                  className="btn btn-sm"
                  style={{
                    flexShrink: 0,
                    border: '1px solid rgba(103,232,249,0.40)',
                    color: '#67E8F9',
                    background: 'rgba(103,232,249,0.08)',
                  }}
                >
                  {submitting ? 'Vytvářím…' : 'Vytvořit'}
                  {!submitting ? <ArrowRight size={12} /> : null}
                </span>
              </button>
            </Form>
          ) : null}
        </div>

        <div
          className="row between"
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: '1px solid var(--line)',
            fontSize: 12,
            color: 'var(--ink-3)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span>
            Spravujete obchody pro klienta?{' '}
            <a
              href="mailto:support@example.com?subject=Agency+režim"
              style={{
                color: 'var(--accent)',
                textDecoration: 'none',
              }}
            >
              Aktivujte agency režim →
            </a>
          </span>
          <span className="mono">
            {shops.length}{' '}
            {shops.length === 1
              ? 'shop'
              : shops.length < 5
                ? 'shopy'
                : 'shopů'}
          </span>
        </div>
      </main>
    </>
  );
}
