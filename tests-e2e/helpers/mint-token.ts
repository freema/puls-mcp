import type { APIRequestContext, Browser } from '@playwright/test';
import {
  dcrRegister,
  exchangeAuthCode,
  generatePkcePair,
  performAuthorizeAndConsent,
  type ToolCategoryId,
} from './oauth.js';
import { installShopViaApi } from './install.js';
import { seedUpgatesShop } from './upgates-seed.js';
import { loginViaSeed } from './seed-session-cookie.js';

/**
 * One-shot helper: install a fresh shop bound to `email`, log that user in,
 * walk through DCR + consent (toggling tool categories per `enabledTools`),
 * and exchange the resulting auth code for an access token.
 *
 * Returns the bearer + the absolute MCP endpoint so a Playwright test can
 * immediately open an MCP client.
 */
export async function mintAccessToken(args: {
  browser: Browser;
  request: APIRequestContext;
  email: string;
  enabledTools?: ToolCategoryId[];
  clientName?: string;
  /** Platform of the shop to bind the token to. Default: 'shoptet'. */
  platform?: 'shoptet' | 'upgates';
}): Promise<{
  accessToken: string;
  mcpUrl: string;
  shopId: string;
  domain: string;
}> {
  const baseUrl = process.env.BASE_URL_WEB!;
  const dbUrl = process.env.DATABASE_URL!;
  const mcpUrl = process.env.BASE_URL_MCP!;
  if (!baseUrl) throw new Error('BASE_URL_WEB missing');
  if (!mcpUrl) throw new Error('BASE_URL_MCP missing');
  if (!dbUrl) throw new Error('DATABASE_URL missing');

  const REDIRECT_URI = `http://localhost:9999/cb-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  // Shoptet installs via the real OAuth handshake against mock-shoptet; Upgates
  // has no install route yet (activation = task 03), so it seeds directly.
  const installed =
    args.platform === 'upgates'
      ? await seedUpgatesShop({ databaseUrl: dbUrl, adminEmail: args.email })
      : await installShopViaApi({
          baseUrl,
          databaseUrl: dbUrl,
          adminEmail: args.email,
        });

  const context = await args.browser.newContext();
  await loginViaSeed({
    context,
    databaseUrl: dbUrl,
    baseUrlWeb: baseUrl,
    email: args.email,
  });

  const dcr = await dcrRegister(args.request, baseUrl, {
    client_name: args.clientName ?? 'puls-e2e',
    redirect_uris: [REDIRECT_URI],
  });
  const pkce = generatePkcePair();
  const consent = await performAuthorizeAndConsent({
    context,
    baseUrl,
    clientId: dcr.client_id,
    redirectUri: REDIRECT_URI,
    codeChallenge: pkce.challenge,
    enabledTools: args.enabledTools,
  });
  const tok = await exchangeAuthCode(args.request, baseUrl, {
    code: consent.code,
    code_verifier: pkce.verifier,
    redirect_uri: REDIRECT_URI,
    client_id: dcr.client_id,
  });
  await context.close();

  return {
    accessToken: tok.access_token,
    mcpUrl: `${mcpUrl}/mcp`,
    shopId: installed.shopId,
    domain: installed.domain,
  };
}

export function decodeText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return '';
  return first.text;
}

export function parseJsonText(content: unknown): unknown {
  const text = decodeText(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
