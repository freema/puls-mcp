import { useLoaderData } from 'react-router';
import type { Route } from './+types/embed.upgates.$token';
import csUpgates from '../../locales/cs/upgates.json';
import skUpgates from '../../locales/sk/upgates.json';
import huUpgates from '../../locales/hu/upgates.json';
import enUpgates from '../../locales/en/upgates.json';

/** Reálný kontakt na podporu (žádná fake data). */
const SUPPORT_EMAIL = 'support@example.com';

const DICTS: Record<string, typeof csUpgates> = {
  cs: csUpgates,
  sk: skUpgates,
  hu: huUpgates,
  en: enUpgates,
};

/**
 * Aktivační iframe doplňku Puls v Upgates adminu. Poděkuje za aktivaci a
 * provede klienta propojením AI asistenta (MCP). ŽÁDNÁ komunikace iframe↔admin
 * (požadavek Upgates) — propojení se otevírá v nové záložce. Lokalizace dle
 * `?lang` (cs/sk/hu/en) předaného opening endpointem.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const langParam = (url.searchParams.get('lang') ?? 'cs').toLowerCase();
  const lang = langParam in DICTS ? langParam : 'cs';
  return {
    lang,
    token: params.token ?? '',
    t: DICTS[lang]!.embed,
    supportEmail: SUPPORT_EMAIL,
  };
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: 'Puls · Upgates' },
    { name: 'robots', content: 'noindex' },
  ];
}

export default function UpgatesEmbed() {
  const { lang, t, supportEmail } = useLoaderData<typeof loader>();

  return (
    <main
      lang={lang}
      style={{
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        maxWidth: 560,
        margin: '0 auto',
        padding: '32px 20px',
        color: '#1a1a2e',
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#6d28d9',
        }}
      >
        {t.eyebrow}
      </div>
      <h1 style={{ fontSize: 24, margin: '8px 0 12px' }}>{t.title}</h1>
      <p style={{ margin: '0 0 20px', color: '#3f3f5a' }}>{t.lede}</p>

      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>{t.stepsTitle}</h2>
      <ol style={{ margin: '0 0 24px', paddingLeft: 20, color: '#3f3f5a' }}>
        <li style={{ marginBottom: 6 }}>{t.step1}</li>
        <li style={{ marginBottom: 6 }}>{t.step2}</li>
        <li style={{ marginBottom: 6 }}>{t.step3}</li>
      </ol>

      <a
        href="/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          background: '#6d28d9',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
          padding: '12px 20px',
          borderRadius: 10,
        }}
      >
        {t.connect}
      </a>

      <p style={{ marginTop: 28, fontSize: 14, color: '#6b6b85' }}>
        {t.supportLabel} {t.supportText}{' '}
        <a href={`mailto:${supportEmail}`} style={{ color: '#6d28d9' }}>
          {supportEmail}
        </a>
      </p>
    </main>
  );
}
