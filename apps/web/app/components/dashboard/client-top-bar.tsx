import { Link, useRouteLoaderData } from 'react-router';
import { Bell } from 'lucide-react';
import { PulsLogo } from '~/components/puls-logo';
import { UserMenu } from '~/components/user-menu';

type RootData = {
  user: { id: string; email: string; isAdmin: boolean } | null;
};

export function ClientTopBar({
  shopName,
  email,
  quotaUsed,
  quotaTotal = 1000,
}: {
  shopName: string;
  email: string;
  quotaUsed: number;
  quotaTotal?: number;
}) {
  const root = useRouteLoaderData('root') as RootData | undefined;
  const isAdmin = root?.user?.isAdmin ?? false;
  const quotaPct = Math.min(
    100,
    Math.round((quotaUsed / Math.max(1, quotaTotal)) * 100)
  );
  const quotaLabel =
    quotaUsed === 0 ? 'Zatím nevyužito' : 'Reset denně 00:00 UTC';

  return (
    <header
      style={{
        height: 64,
        padding: '0 24px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <div className="row gap-24" style={{ minWidth: 0, flexWrap: 'wrap' }}>
        <Link to="/dashboard" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <PulsLogo size={26} />
        </Link>
        <span
          style={{ width: 1, height: 22, background: 'var(--line-2)' }}
          aria-hidden
        />
        <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{shopName}</span>
        </div>
      </div>
      <div className="row gap-12">
        <div
          className="row gap-10"
          title={`${quotaUsed} / ${quotaTotal} MCP volání · ${quotaLabel}`}
          style={{
            padding: '6px 12px',
            border: '1px solid var(--line)',
            borderRadius: 999,
            background: 'var(--surface)',
            minWidth: 168,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.12em',
            }}
          >
            QUOTA
          </span>
          <div
            style={{
              flex: 1,
              height: 4,
              background: 'var(--bg-3)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${quotaPct}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink)', whiteSpace: 'nowrap' }}
          >
            {quotaUsed} / {quotaTotal}
          </span>
        </div>
        <button type="button" className="btn btn-soft btn-sm" aria-label="Notifikace">
          <Bell size={14} />
        </button>
        <UserMenu email={email} isAdmin={isAdmin} variant="pill" />
      </div>
    </header>
  );
}
