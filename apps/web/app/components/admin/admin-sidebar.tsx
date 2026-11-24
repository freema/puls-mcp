import { NavLink } from 'react-router';
import {
  Activity,
  AlertOctagon,
  Key,
  Logs,
  Mail,
  MessageSquare,
  Server,
  Sparkles,
  Store,
  Tag,
  Webhook,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslations } from '~/lib/i18n-context';

type Link = {
  to: string;
  labelKey: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
  count?: string;
};

const links: Link[] = [
  { to: '/admin', labelKey: 'nav.overview', icon: Activity, end: true },
  { to: '/admin/shops', labelKey: 'nav.shops', icon: Store },
  { to: '/admin/pricing', labelKey: 'nav.pricing', icon: Tag },
  { to: '/admin/logs', labelKey: 'nav.logs', icon: Logs },
  { to: '/admin/feedback', labelKey: 'nav.feedback', icon: MessageSquare },
  { to: '/admin/webhooks', labelKey: 'nav.webhooks', icon: Webhook },
  { to: '/admin/api-keys', labelKey: 'nav.apiKeys', icon: Key },
  { to: '/admin/emails', labelKey: 'nav.emails', icon: Mail },
  { to: '/admin/prompts', labelKey: 'nav.prompts', icon: Sparkles },
  { to: '/admin/system', labelKey: 'nav.system', icon: Server },
  { to: '/admin/status', labelKey: 'nav.incidents', icon: AlertOctagon },
];

export function AdminSidebar() {
  const t = useTranslations('admin');
  return (
    <aside
      style={{
        background: 'var(--bg-2)',
        borderRight: '1px solid var(--line)',
        padding: '20px 12px',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        className="mono"
        style={{
          padding: '4px 12px 16px',
          fontSize: 10,
          color: 'var(--ink-4)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {t('title')}
      </div>
      <nav className="col gap-4">
        {links.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `admin-nav-link${isActive ? ' is-active' : ''}`
              }
              style={({ isActive }) => ({
                padding: '8px 10px 8px 12px',
                borderRadius: 7,
                fontSize: 13,
                color: isActive ? 'var(--ink)' : 'var(--ink-3)',
                background: isActive ? 'var(--surface)' : 'transparent',
                textDecoration: 'none',
                borderLeft: isActive
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              })}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Icon size={15} /> {t(it.labelKey)}
              </span>
              {it.count && (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--ink-4)' }}
                >
                  {it.count}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
