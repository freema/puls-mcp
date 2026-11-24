import { Link, useLocation } from 'react-router';
import { Activity, History, Link2, Logs, Terminal } from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslations } from '~/lib/i18n-context';

type Item = {
  icon: ComponentType<{ size?: number }>;
  label: string;
  to: string;
};

export function ClientSidebar({ shopId }: { shopId: string }) {
  const location = useLocation();
  const t = useTranslations('dashboard');
  const items: Item[] = [
    {
      icon: Activity,
      label: t('nav.overview'),
      to: `/dashboard/${shopId}`,
    },
    {
      icon: Logs,
      label: t('nav.activity'),
      to: `/dashboard/${shopId}/activity`,
    },
    {
      icon: Terminal,
      label: t('nav.tools'),
      to: `/dashboard/${shopId}/tools`,
    },
    {
      icon: History,
      label: t('nav.write_history'),
      to: `/dashboard/${shopId}/write-history`,
    },
    {
      icon: Link2,
      label: t('nav.connections'),
      to: `/dashboard/${shopId}/connections`,
    },
  ];

  return (
    <aside
      className="dashboard-sidebar"
      style={{
        borderRight: '1px solid var(--line)',
        padding: '24px 12px',
        background: 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        position: 'sticky',
        top: 64,
        alignSelf: 'flex-start',
        height: 'calc(100dvh - 64px)',
      }}
    >
      <nav className="col gap-4">
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = location.pathname === it.to;

          return (
            <Link
              key={it.label}
              to={it.to}
              className="row gap-10"
              aria-current={isActive ? 'page' : undefined}
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 13.5,
                color: isActive ? 'var(--ink)' : 'var(--ink-3)',
                background: isActive ? 'var(--surface)' : 'transparent',
                cursor: 'pointer',
                textDecoration: 'none',
                position: 'relative',
                transition:
                  'background 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.color = 'var(--ink-2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--ink-3)';
                }
              }}
            >
              {isActive ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: 'var(--accent)',
                    borderRadius: 2,
                    animation: 'pulsNavPulse 2.4s ease-in-out infinite',
                  }}
                />
              ) : null}
              <Icon size={16} /> {it.label}
            </Link>
          );
        })}
      </nav>

    </aside>
  );
}
