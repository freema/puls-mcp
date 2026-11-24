import { createHash, randomBytes } from 'node:crypto';
import type {
  APIRequestContext,
  BrowserContext,
} from '@playwright/test';

export const SESSION_COOKIE = 'puls_session';

/** Mirror of TOOL_CATEGORIES in mcp-server / consent UI. */
export type ToolCategoryId =
  | 'orders'
  | 'products'
  | 'customers'
  | 'catalog'
  | 'insights'
  | 'write'
  | 'memory';

export type AuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
};

/**
 * RFC 8414 discovery — what every real MCP client does first.
 * Real clients trust the metadata blindly, so the test must too.
 *
 * In compose, MCP advertises the issuer as `http://localhost:13000` (the
 * host-published port the browser sees). Inside the e2e container that
 * doesn't resolve — we have to talk to `app:3000` over the docker network.
 * Rewrite localhost:* origins to BASE_URL_WEB so the test can actually hit
 * the advertised endpoints.
 */
export async function discoverAuthServer(
  req: APIRequestContext,
  mcpBaseUrl: string
): Promise<AuthServerMetadata> {
  const res = await req.get(
    `${mcpBaseUrl}/.well-known/oauth-authorization-server`
  );
  if (!res.ok()) {
    throw new Error(
      `OAuth metadata fetch failed: ${res.status()} ${await res.text()}`
    );
  }
  const md = (await res.json()) as AuthServerMetadata;
  const containerWebOrigin = process.env.BASE_URL_WEB?.replace(/\/$/, '');
  if (!containerWebOrigin) return md;
  return {
    ...md,
    issuer: rewriteToContainerOrigin(md.issuer, containerWebOrigin),
    authorization_endpoint: rewriteToContainerOrigin(
      md.authorization_endpoint,
      containerWebOrigin
    ),
    token_endpoint: rewriteToContainerOrigin(
      md.token_endpoint,
      containerWebOrigin
    ),
    registration_endpoint: rewriteToContainerOrigin(
      md.registration_endpoint,
      containerWebOrigin
    ),
  };
}

function rewriteToContainerOrigin(
  advertisedUrl: string,
  containerOrigin: string
): string {
  try {
    const u = new URL(advertisedUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const co = new URL(containerOrigin);
      u.protocol = co.protocol;
      u.hostname = co.hostname;
      u.port = co.port;
      return u.toString();
    }
    return advertisedUrl;
  } catch {
    return advertisedUrl;
  }
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

export async function dcrRegister(
  req: APIRequestContext,
  baseUrl: string,
  opts: {
    client_name: string;
    redirect_uris: string[];
    scope?: string;
  }
): Promise<{
  client_id: string;
  client_secret: string | null;
  scope: string;
}> {
  const res = await req.post(`${baseUrl}/oauth/register`, {
    headers: { 'content-type': 'application/json' },
    data: opts,
  });
  if (!res.ok()) {
    throw new Error(`DCR failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    client_id: string;
    client_secret?: string;
    scope?: string;
  };
  return {
    client_id: body.client_id,
    client_secret: body.client_secret ?? null,
    scope: body.scope ?? '',
  };
}

export async function exchangeAuthCode(
  req: APIRequestContext,
  baseUrl: string,
  opts: {
    code: string;
    code_verifier: string;
    redirect_uri: string;
    client_id: string;
  }
): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.code_verifier,
    redirect_uri: opts.redirect_uri,
    client_id: opts.client_id,
  });
  const res = await req.post(`${baseUrl}/oauth/token`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  if (!res.ok()) {
    throw new Error(
      `Token exchange failed: ${res.status()} ${await res.text()}`
    );
  }
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
}

export type ConsentResult = {
  code: string;
  state: string | null;
  capturedRedirect: string;
};

/**
 * Drive Playwright through `/oauth/authorize` → `/auth/mcp-connect` consent
 * screen → capture the final redirect to `redirect_uri` and pull `code` &
 * `state` out of the query.
 *
 * The browser context must already have a session cookie set so the consent
 * screen is reachable without going through `/login`.
 */
export async function performAuthorizeAndConsent(args: {
  context: BrowserContext;
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope?: string;
  /** Substring of shop label to pick from the dropdown. Defaults to first option. */
  shopLabelMatch?: string;
  /**
   * Categories to leave checked. Others get unchecked. Default: keep the
   * pre-checked state from the consent UI (read-only categories are on,
   * `write` is off — strict opt-in).
   */
  enabledTools?: ToolCategoryId[];
}): Promise<ConsentResult> {
  const ALL_CATEGORIES = [
    'orders',
    'products',
    'customers',
    'catalog',
    'insights',
    'write',
    'memory',
  ] as const satisfies readonly ToolCategoryId[];

  const page = await args.context.newPage();
  let capturedUrl: string | null = null;

  const redirectMatcher = new RegExp(
    '^' + args.redirectUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

  // Intercept the final redirect to redirect_uri (which has no real server
  // behind it). Two layers of capture so it works regardless of whether
  // Remix submits via SPA fetch (`.data` endpoint, then JS redirect) or as
  // a plain HTML form POST that gets a 302 the browser follows.
  await page.route(redirectMatcher, async (route) => {
    capturedUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>captured</body></html>',
    });
  });
  page.on('request', (req) => {
    if (
      capturedUrl === null &&
      req.url().startsWith(args.redirectUri)
    ) {
      capturedUrl = req.url();
    }
    if (process.env.DEBUG_E2E) console.log('[req]', req.method(), req.url());
  });
  page.on('console', (msg) => {
    if (process.env.DEBUG_E2E) console.log('[page]', msg.type(), msg.text());
  });
  page.on('response', (res) => {
    if (process.env.DEBUG_E2E)
      console.log('[res]', res.status(), res.url());
  });

  const u = new URL(`${args.baseUrl}/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (args.state) u.searchParams.set('state', args.state);
  if (args.scope) u.searchParams.set('scope', args.scope);

  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  // The shop picker is a custom NiceSelect — its source of truth is a
  // hidden input, which the loader pre-fills with shops[0].id. Hidden
  // inputs are never "visible", so we wait for `attached`.
  await page.waitForSelector('input[type="hidden"][name="shop_id"]', {
    state: 'attached',
  });

  if (args.shopLabelMatch) {
    // Open the dropdown, click the matching option.
    const trigger = page
      .locator('input[type="hidden"][name="shop_id"]')
      .locator('xpath=preceding-sibling::button | following-sibling::button')
      .first();
    await trigger.click();
    const option = page.getByRole('option', {
      name: new RegExp(args.shopLabelMatch),
    });
    await option.first().click();
  }

  if (args.enabledTools) {
    const enabled = new Set(args.enabledTools);
    for (const cat of ALL_CATEGORIES) {
      const cb = page.locator(`input[name="tool_${cat}"]`);
      if (enabled.has(cat)) {
        if (!(await cb.isChecked())) await cb.check();
      } else {
        if (await cb.isChecked()) await cb.uncheck();
      }
    }
  }

  const allowButton = page.locator(
    'button[name="decision"][value="allow"]'
  );
  await allowButton.scrollIntoViewIfNeeded().catch(() => undefined);

  // `noWaitAfter` so we don't deadlock if the post-submit redirect is a
  // plain 302 the browser follows to localhost:9999 (no server there).
  await allowButton.click({ noWaitAfter: true });

  const start = Date.now();
  while (capturedUrl === null && Date.now() - start < 15_000) {
    await page.waitForTimeout(50);
  }
  await page.close().catch(() => {});

  if (!capturedUrl) {
    throw new Error('consent: never captured redirect to redirect_uri');
  }

  const finalUrl = new URL(capturedUrl);
  const code = finalUrl.searchParams.get('code');
  if (!code) {
    throw new Error(
      `consent: no code in captured redirect: ${capturedUrl}`
    );
  }
  return {
    code,
    state: finalUrl.searchParams.get('state'),
    capturedRedirect: capturedUrl,
  };
}
