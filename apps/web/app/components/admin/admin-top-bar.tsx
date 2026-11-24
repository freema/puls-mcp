import { Link } from 'react-router';
import { Bell, Search } from 'lucide-react';
import { PulsLogo } from '~/components/puls-logo';
import { UserMenu } from '~/components/user-menu';

export function AdminTopBar({ email }: { email: string }) {
  return (
    <header
      style={{
        height: 64,
        padding: '0 24px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-2)',
        gap: 16,
      }}
    >
      <div className="row gap-16" style={{ minWidth: 0 }}>
        <Link
          to="/admin"
          style={{ textDecoration: 'none', color: 'var(--ink)' }}
        >
          <PulsLogo size={26} />
        </Link>
        <span
          style={{ width: 1, height: 22, background: 'var(--line-2)' }}
          aria-hidden
        />
        <span
          className="pill pill-err"
          style={{ fontSize: 10, padding: '2px 8px' }}
        >
          ADMIN
        </span>
      </div>
      <div
        className="row gap-8"
        style={{ flex: 1, maxWidth: 420, minWidth: 0 }}
      >
        <div
          className="row gap-10"
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 13,
            minWidth: 0,
          }}
        >
          <Search size={14} color="var(--ink-3)" />
          <span className="muted">Search shops, logs, tools…</span>
          <span style={{ flex: 1 }} />
          <span className="mono faint" style={{ fontSize: 11 }}>
            ⌘K
          </span>
        </div>
      </div>
      <div className="row gap-12">
        <button type="button" className="btn btn-soft btn-sm" aria-label="Notifikace">
          <Bell size={13} />
        </button>
        <div
          style={{
            paddingLeft: 12,
            borderLeft: '1px solid var(--line)',
            minWidth: 0,
          }}
        >
          <UserMenu email={email} isAdmin variant="compact" />
        </div>
      </div>
    </header>
  );
}
