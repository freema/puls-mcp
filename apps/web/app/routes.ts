import { type RouteConfig, index, route } from '@react-router/dev/routes';

/**
 * Locales that get URL prefixes (CZ stays unprefixed). Keep in sync with
 * `apps/web/app/lib/locale.ts` `SUPPORTED_LOCALES`.
 */
const LANG_PREFIXES = ['sk', 'hu', 'en'] as const;

type Localized = readonly [path: string, file: string];

/**
 * Public routes that get a localized variant for each non-default locale. Logged-in app (dashboard, admin) and infra routes
 * (api, oauth, .well-known) stay flat — locale comes from cookie/user pref.
 */
const LOCALIZED_ROUTES: readonly Localized[] = [
  ['nastaveni', 'routes/nastaveni.tsx'],
  ['nastaveni/delete-account', 'routes/nastaveni.delete-account.tsx'],
  ['login', 'routes/login.tsx'],
  ['login/verify', 'routes/login.verify.tsx'],
];

function localizedAlternates() {
  return LANG_PREFIXES.flatMap((lang) =>
    LOCALIZED_ROUTES.map(([p, file]) =>
      route(`${lang}/${p}`, file, { id: `${file}__${lang}` })
    )
  );
}

function localizedIndexes() {
  return LANG_PREFIXES.map((lang) =>
    route(lang, 'routes/_index.tsx', { id: `routes/_index__${lang}` })
  );
}

export default [
  index('routes/_index.tsx'),
  ...LOCALIZED_ROUTES.map(([p, file]) => route(p, file)),
  ...localizedIndexes(),
  ...localizedAlternates(),

  route('robots.txt', 'routes/robots[.]txt.tsx'),
  route('maintenance', 'routes/maintenance.tsx'),

  route('auth/google', 'routes/auth.google.tsx'),
  route('auth/google/callback', 'routes/auth.google.callback.tsx'),
  route('auth/logout', 'routes/auth.logout.tsx'),
  route('healthz', 'routes/healthz.tsx'),
  route('api/version', 'routes/api.version.tsx'),
  route('api/install', 'routes/api.install.tsx'),
  route('api/webhooks', 'routes/api.webhooks.tsx'),
  route('api/webhooks/upgates', 'routes/api.webhooks.upgates.tsx'),
  route('api/upgates/install', 'routes/api.upgates.install.tsx'),
  route('api/upgates/opening', 'routes/api.upgates.opening.tsx'),
  route('api/upgates/uninstall', 'routes/api.upgates.uninstall.tsx'),
  route('api/upgates/versioning', 'routes/api.upgates.versioning.tsx'),
  route('embed/upgates/:token', 'routes/embed.upgates.$token.tsx'),
  route('api/cron', 'routes/api.cron.tsx'),
  route('api/locale', 'routes/api.locale.tsx'),
  route('api/admin/logs', 'routes/api.admin.logs.tsx'),
  route('api/admin/shops', 'routes/api.admin.shops.tsx'),
  route('api/admin/stats', 'routes/api.admin.stats.tsx'),
  route('api/admin/system', 'routes/api.admin.system.tsx'),
  route('settings/:shopId', 'routes/settings.$shopId.tsx'),

  route('oauth/authorize', 'routes/oauth.authorize.tsx'),
  route('oauth/token', 'routes/oauth.token.tsx'),
  route('oauth/register', 'routes/oauth.register.tsx'),
  route('auth/mcp-connect', 'routes/auth.mcp-connect.tsx'),
  route(
    '.well-known/oauth-authorization-server',
    'routes/well-known.oauth-authorization-server.tsx'
  ),
  route(
    '.well-known/oauth-protected-resource',
    'routes/well-known.oauth-protected-resource.tsx'
  ),
  route('.well-known/api-catalog', 'routes/well-known.api-catalog.tsx'),
  route('.well-known/mcp.json', 'routes/well-known.mcp[.]json.tsx'),
  route(
    '.well-known/mcp/server-card.json',
    'routes/well-known.mcp.server-card[.]json.tsx'
  ),
  route(
    '.well-known/agent-skills/index.json',
    'routes/well-known.agent-skills.index[.]json.tsx'
  ),

  route('dashboard', 'routes/dashboard.tsx', [
    index('routes/dashboard._index.tsx'),
    route('select', 'routes/dashboard.select.tsx'),
    route(':shopId', 'routes/dashboard.$shopId.tsx', [
      index('routes/dashboard.$shopId._index.tsx'),
      route('activity', 'routes/dashboard.$shopId.activity.tsx'),
      route('tools', 'routes/dashboard.$shopId.tools.tsx'),
      route('connections', 'routes/dashboard.$shopId.connections.tsx'),
      route(
        'write-history',
        'routes/dashboard.$shopId.write-history._index.tsx'
      ),
      route(
        'write-history/:id',
        'routes/dashboard.$shopId.write-history.$id.tsx'
      ),
    ]),
  ]),

  route('admin', 'routes/admin.tsx', [
    index('routes/admin._index.tsx'),
    route('shops', 'routes/admin.shops._index.tsx'),
    route('shops/:shopId', 'routes/admin.shops.$shopId.tsx'),
    route('pricing', 'routes/admin.pricing._index.tsx'),
    route('pricing/:tierId', 'routes/admin.pricing.$tierId.tsx'),
    route('logs', 'routes/admin.logs._index.tsx'),
    route('feedback', 'routes/admin.feedback._index.tsx'),
    route('webhooks', 'routes/admin.webhooks._index.tsx'),
    route('api-keys', 'routes/admin.api-keys._index.tsx'),
    route('emails', 'routes/admin.emails._index.tsx'),
    route('system', 'routes/admin.system._index.tsx'),
    route('status', 'routes/admin.status._index.tsx'),
    route('status/new', 'routes/admin.status.new.tsx'),
    route('status/:id', 'routes/admin.status.$id.tsx'),
    route('prompts', 'routes/admin.prompts._index.tsx'),
    route('prompts/new', 'routes/admin.prompts.new.tsx'),
    route('prompts/:id', 'routes/admin.prompts.$id.tsx'),
  ]),

  route('*', 'routes/$.tsx'),
] satisfies RouteConfig;
