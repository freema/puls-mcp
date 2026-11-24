import { Link, useRouteLoaderData } from 'react-router';
import { PulsLogo } from '~/components/puls-logo';
import { UserMenu } from '~/components/user-menu';
import { LocaleSwitcher } from '~/components/locale-switcher';
import { useTranslations, useLocale } from '~/lib/i18n-context';
import { getLocalePath } from '~/lib/locale';

type RootData = {
  user: { id: string; email: string; isAdmin: boolean } | null;
};

function shortName(email: string): string {
  const local = email.split('@')[0] ?? email;
  if (local.length <= 14) return local;
  return `${local.slice(0, 12)}…`;
}

export function SiteHeader() {
  const root = useRouteLoaderData('root') as RootData | undefined;
  const user = root?.user ?? null;
  const t = useTranslations('common');
  const locale = useLocale();
  const lp = (path: string) => getLocalePath(locale, path);

  return (
    <header
      style={{
        borderBottom: '1px solid var(--line)',
        padding: '18px clamp(24px, 4vw, 56px)',
        background: 'rgba(10,18,32,0.7)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}
    >
      <div
        className="row between"
        style={{ maxWidth: 1280, margin: '0 auto', gap: 24 }}
      >
        <Link
          to={lp('/')}
          style={{ textDecoration: 'none', color: 'var(--ink)' }}
        >
          <PulsLogo />
        </Link>
        <div className="row gap-12" style={{ alignItems: 'center' }}>
          <LocaleSwitcher variant="header" />
          {user ? (
            <UserMenu
              email={user.email}
              isAdmin={user.isAdmin}
              variant="compact"
              displayName={shortName(user.email)}
            />
          ) : (
            <Link to={lp('/login')} className="btn btn-ghost btn-sm">
              {t('nav.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
