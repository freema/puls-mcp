import type { BrowserContext } from '@playwright/test';
import { seedBrowserSession } from './session.js';
import { SESSION_COOKIE } from './oauth.js';

/**
 * Seeds a Puls session for `email` directly via DB and installs the cookie
 * into the Playwright browser context. Bypasses the magic-link e-mail flow
 * which is not deterministic in CI (codes are sent to SMTP / Resend).
 *
 * Cookie domain is derived from the BASE_URL_WEB host so it works against
 * `app:3000` (compose) and `localhost:3000` (host).
 */
export async function loginViaSeed(args: {
  context: BrowserContext;
  databaseUrl: string;
  baseUrlWeb: string;
  email: string;
}): Promise<void> {
  const { token } = await seedBrowserSession({
    databaseUrl: args.databaseUrl,
    email: args.email,
  });

  const url = new URL(args.baseUrlWeb);
  await args.context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  ]);
}
