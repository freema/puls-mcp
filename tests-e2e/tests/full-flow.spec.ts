import { expect, test } from '@playwright/test';
import {
  dcrRegister,
  exchangeAuthCode,
  generatePkcePair,
  performAuthorizeAndConsent,
} from '../helpers/oauth';
import { installShopViaApi } from '../helpers/install';
import { loginViaSeed } from '../helpers/seed-session-cookie';
import { connectMcpClient } from '../helpers/mcp';

const TEST_EMAIL = 'full-flow@example.test';
const REDIRECT_URI = 'http://localhost:9999/cb';

/**
 * The smoke test that proves the four layers compose end-to-end:
 *
 *  1. Shoptet plugin install        — POST /api/install (mock-shoptet)
 *  2. User login                    — seeded session cookie (deterministic)
 *  3. MCP OAuth                     — DCR + authorize + consent + token (PKCE)
 *  4. MCP tool execution            — list_orders via Streamable HTTP + Bearer
 */
test('full flow: install → login → MCP OAuth → tool call', async ({
  browser,
  request,
}) => {
  const baseUrl = process.env.BASE_URL_WEB!;
  const mcpUrl = process.env.BASE_URL_MCP!;
  const dbUrl = process.env.DATABASE_URL!;
  if (!baseUrl) throw new Error('BASE_URL_WEB missing');
  if (!mcpUrl) throw new Error('BASE_URL_MCP missing');
  if (!dbUrl) throw new Error('DATABASE_URL missing');

  // 1. Install
  const installed = await installShopViaApi({
    baseUrl,
    databaseUrl: dbUrl,
    adminEmail: TEST_EMAIL,
  });
  expect(installed.shopId).toMatch(/^.+$/);
  expect(installed.domain).toContain('myshoptet.com');

  // 2. Login (seeded session cookie — bypasses magic-link e-mail)
  const context = await browser.newContext();
  await loginViaSeed({
    context,
    databaseUrl: dbUrl,
    baseUrlWeb: baseUrl,
    email: TEST_EMAIL,
  });

  // 3. MCP OAuth — DCR → authorize/consent → token exchange
  const dcr = await dcrRegister(request, baseUrl, {
    client_name: 'puls-e2e-full-flow',
    redirect_uris: [REDIRECT_URI],
    scope: 'mcp:read mcp:write',
  });
  const pkce = generatePkcePair();
  const consent = await performAuthorizeAndConsent({
    context,
    baseUrl,
    clientId: dcr.client_id,
    redirectUri: REDIRECT_URI,
    codeChallenge: pkce.challenge,
    state: 'full-flow-state',
    scope: 'mcp:read mcp:write',
  });
  expect(consent.state).toBe('full-flow-state');

  const tok = await exchangeAuthCode(request, baseUrl, {
    code: consent.code,
    code_verifier: pkce.verifier,
    redirect_uri: REDIRECT_URI,
    client_id: dcr.client_id,
  });
  expect(tok.access_token).toMatch(/^[A-Za-z0-9_-]+$/);
  await context.close();

  // 4. MCP tool execution — connect SDK client, list tools, call list_orders
  const handle = await connectMcpClient({
    url: `${mcpUrl}/mcp`,
    bearer: tok.access_token,
  });
  try {
    const list = await handle.client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_orders']));

    const callRes = await handle.client.callTool({
      name: 'list_orders',
      arguments: { limit: 5 },
    });
    const text =
      Array.isArray(callRes.content) && callRes.content[0]?.type === 'text'
        ? (callRes.content[0] as { text: string }).text
        : '';
    expect(text).toMatch(/MOCK-ORDER-001/);
  } finally {
    await handle.close();
  }
});
