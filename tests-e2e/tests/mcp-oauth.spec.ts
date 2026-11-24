import { expect, test } from '@playwright/test';
import {
  dcrRegister,
  discoverAuthServer,
  exchangeAuthCode,
  generatePkcePair,
  performAuthorizeAndConsent,
} from '../helpers/oauth';
import { installShopViaApi } from '../helpers/install';
import { loginViaSeed } from '../helpers/seed-session-cookie';

const TEST_EMAIL = 'mcp-oauth@example.test';
const REDIRECT_URI = 'http://localhost:9999/cb';

test.describe('MCP OAuth flow (DCR + authorize + consent + token)', () => {
  test('discovery advertises endpoints that are actually reachable', async ({
    request,
  }) => {
    const mcpUrl = process.env.BASE_URL_MCP!;
    if (!mcpUrl) throw new Error('BASE_URL_MCP missing');

    const md = await discoverAuthServer(request, mcpUrl);

    // All endpoints must share an origin — that's the auth server.
    const issuerOrigin = new URL(md.issuer).origin;
    expect(new URL(md.authorization_endpoint).origin).toBe(issuerOrigin);
    expect(new URL(md.token_endpoint).origin).toBe(issuerOrigin);
    expect(new URL(md.registration_endpoint).origin).toBe(issuerOrigin);

    // The advertised authorize endpoint must serve something — a 404
    // means MCP is pointing clients at a host where the route doesn't
    // exist (the bug Inspector hits as "Cannot GET /oauth/authorize").
    const probe = await request.get(md.authorization_endpoint, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(
      probe.status(),
      `discovery advertised ${md.authorization_endpoint} but GET returned ${probe.status()}`
    ).not.toBe(404);
  });

  test('full happy path mints a token bound to shop + scopes', async ({
    browser,
    request,
  }) => {
    const mcpUrl = process.env.BASE_URL_MCP!;
    const dbUrl = process.env.DATABASE_URL!;
    if (!mcpUrl) throw new Error('BASE_URL_MCP missing');
    if (!dbUrl) throw new Error('DATABASE_URL missing');

    // Drive the flow off discovery, exactly like a real MCP client.
    const md = await discoverAuthServer(request, mcpUrl);
    const baseUrl = new URL(md.authorization_endpoint).origin;

    const installed = await installShopViaApi({
      baseUrl,
      databaseUrl: dbUrl,
      adminEmail: TEST_EMAIL,
    });

    const context = await browser.newContext();
    await loginViaSeed({
      context,
      databaseUrl: dbUrl,
      baseUrlWeb: baseUrl,
      email: TEST_EMAIL,
    });

    const dcr = await dcrRegister(request, baseUrl, {
      client_name: 'e2e-mcp-oauth-spec',
      redirect_uris: [REDIRECT_URI],
      scope: 'mcp:read mcp:write',
    });
    expect(dcr.client_id).toMatch(/^.+$/);

    const pkce = generatePkcePair();
    const consent = await performAuthorizeAndConsent({
      context,
      baseUrl,
      clientId: dcr.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: pkce.challenge,
      state: 'spec-state-1',
      scope: 'mcp:read mcp:write',
      enabledTools: ['orders', 'catalog'],
    });

    expect(consent.state).toBe('spec-state-1');
    expect(consent.code).toMatch(/^[A-Za-z0-9_-]+$/);

    const token = await exchangeAuthCode(request, baseUrl, {
      code: consent.code,
      code_verifier: pkce.verifier,
      redirect_uri: REDIRECT_URI,
      client_id: dcr.client_id,
    });

    expect(token.token_type).toBe('Bearer');
    expect(token.access_token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.expires_in).toBeGreaterThan(0);

    const pg = await import('pg');
    const c = new pg.default.Client({ connectionString: dbUrl });
    await c.connect();
    try {
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256')
        .update(token.access_token)
        .digest('hex');
      const r = await c.query<{
        shopId: string;
        disabledTools: string | null;
        scope: string | null;
      }>(
        `select shop_id as "shopId",
                disabled_tools as "disabledTools",
                scope
           from oauth_access_tokens
          where token_hash = $1
          limit 1`,
        [tokenHash]
      );
      expect(r.rows[0]).toBeTruthy();
      expect(r.rows[0]?.shopId).toBe(installed.shopId);
      const disabled = (r.rows[0]?.disabledTools ?? '').split(',').filter(Boolean);
      // Consent UI today exposes: orders, products, customers, catalog,
      // insights, write, memory. We enabled only orders + catalog above,
      // so everything else must end up in disabled_tools.
      expect(new Set(disabled)).toEqual(
        new Set(['products', 'customers', 'insights', 'write', 'memory'])
      );
    } finally {
      await c.end();
    }

    await context.close();
  });

  test('rejects token exchange with wrong PKCE verifier', async ({
    browser,
    request,
  }) => {
    const mcpUrl = process.env.BASE_URL_MCP!;
    const dbUrl = process.env.DATABASE_URL!;
    if (!mcpUrl) throw new Error('BASE_URL_MCP missing');

    const md = await discoverAuthServer(request, mcpUrl);
    const baseUrl = new URL(md.authorization_endpoint).origin;

    await installShopViaApi({
      baseUrl,
      databaseUrl: dbUrl,
      adminEmail: TEST_EMAIL,
    });

    const context = await browser.newContext();
    await loginViaSeed({
      context,
      databaseUrl: dbUrl,
      baseUrlWeb: baseUrl,
      email: TEST_EMAIL,
    });

    const dcr = await dcrRegister(request, baseUrl, {
      client_name: 'e2e-pkce-neg',
      redirect_uris: [REDIRECT_URI],
    });
    const pkce = generatePkcePair();
    const consent = await performAuthorizeAndConsent({
      context,
      baseUrl,
      clientId: dcr.client_id,
      redirectUri: REDIRECT_URI,
      codeChallenge: pkce.challenge,
    });

    const wrong = generatePkcePair();
    const res = await request.post(`${baseUrl}/oauth/token`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code: consent.code,
        code_verifier: wrong.verifier,
        redirect_uri: REDIRECT_URI,
        client_id: dcr.client_id,
      }).toString(),
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');

    await context.close();
  });
});
