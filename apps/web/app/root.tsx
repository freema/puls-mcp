import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from 'react-router';
import * as Sentry from '@sentry/react-router';

import type { Route } from './+types/root';
import { getDb } from '~/lib/db';
import { getSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';
import {
  ErrorPage,
  type ErrorPageProps,
} from '~/components/error/error-page';
import { resolveLocale } from '~/lib/locale.server';
import { DEFAULT_LOCALE, type Locale } from '~/lib/locale';
import { getTranslationBundles } from '~/lib/translations.server';
import { I18nProvider } from '~/lib/i18n-context';
import { users } from '@puls/db/schema';
import { eq } from 'drizzle-orm';
import './app.css';

const ROOT_NAMESPACES = [
  'common',
  'dashboard',
  'admin',
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await getSessionUser(db, request);

  let preferredLocale: string | null = null;
  if (user) {
    const rows = await db
      .select({ preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    preferredLocale = rows[0]?.preferredLocale ?? null;
  }

  const locale = resolveLocale(request, user ? { preferredLocale } : null);
  const bundles = getTranslationBundles(locale, ROOT_NAMESPACES);

  return {
    user: user
      ? {
          id: user.id,
          email: user.email,
          isAdmin: isAdminEmail(user.email),
        }
      : null,
    locale,
    bundles,
  };
}

export const links: Route.LinksFunction = () => [
  { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
  { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // useLoaderData returns undefined inside ErrorBoundary; guard with fallback.
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const data = useLoaderData<typeof loader>() as
      | { locale?: Locale }
      | undefined;
    if (data?.locale) locale = data.locale;
  } catch {
    // no loader data
  }
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { locale, bundles } = useLoaderData<typeof loader>();
  return (
    <I18nProvider locale={locale} bundles={bundles}>
      <Outlet />
    </I18nProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isExpectedResponse =
    isRouteErrorResponse(error) &&
    [401, 403, 404, 503].includes(error.status);
  if (!isExpectedResponse) {
    Sentry.captureException(error);
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error);
    }
  }

  let pageProps: ErrorPageProps = {
    code: 500,
    title: 'Něco se pokazilo.',
    description:
      'Na naší straně to spadlo. Už o tom víme a koukáme na to. Zkuste to za chvíli znovu.',
    primary: { to: '/', label: 'Zkusit znovu' },
    secondary: { to: '/dashboard', label: 'Otevřít dashboard' },
    illustration: 'broken',
    tone: 'err',
  };
  let stack: string | undefined;
  let devMessage: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      pageProps = {
        code: 404,
        title: 'Tahle stránka neexistuje.',
        description:
          'Možná byla přesunutá, přejmenovaná, nebo nikdy nebyla. Skoč zpátky do dashboardu nebo nám napiš.',
        primary: { to: '/', label: 'Zpět na úvod' },
        secondary: { to: '/dashboard', label: 'Otevřít dashboard' },
        illustration: 'lost',
        tone: 'warn',
      };
    } else if (error.status === 401) {
      pageProps = {
        code: 401,
        title: 'Nejdřív se přihlaste.',
        description:
          'K této stránce se nedostanete, dokud nejste přihlášeni. Trvá to deset vteřin.',
        primary: { to: '/login', label: 'Přihlásit se' },
        secondary: { to: '/', label: 'Na úvod' },
        illustration: 'forbidden',
        tone: 'info',
      };
    } else if (error.status === 403) {
      pageProps = {
        code: 403,
        title: 'Sem prosím ne.',
        description:
          'Tahle stránka existuje, ale váš účet ji vidět nemá. Zkuste si vybrat jiný obchod nebo se ozvat administrátorovi.',
        primary: { to: '/dashboard/select', label: 'Vybrat obchod' },
        secondary: { to: '/', label: 'Na úvod' },
        illustration: 'forbidden',
        tone: 'err',
      };
    } else if (error.status === 503) {
      pageProps = {
        code: 503,
        title: 'Provádíme údržbu.',
        description: 'Jsme zpět za chvíli. Zkuste to prosím za pár minut.',
        primary: { to: '/', label: 'Na úvod' },
        illustration: 'maintenance',
        tone: 'warn',
      };
    } else {
      pageProps = {
        ...pageProps,
        code: error.status,
        title: error.statusText || pageProps.title,
      };
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    devMessage = error.message;
    stack = error.stack;
  }

  return (
    <>
      <ErrorPage {...pageProps} />
      {stack || devMessage ? (
        <pre
          className="code"
          style={{
            margin: '0 clamp(20px, 4vw, 40px) 32px',
            padding: 16,
            overflowX: 'auto',
            fontSize: 12,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--ink-2)',
          }}
        >
          <code>{devMessage ? `${devMessage}\n\n` : ''}{stack}</code>
        </pre>
      ) : null}
    </>
  );
}
