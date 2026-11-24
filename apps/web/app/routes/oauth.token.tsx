import { and, eq, gt } from 'drizzle-orm';
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthClients,
} from '@puls/db/schema';
import type { Route } from './+types/oauth.token';
import { getDb } from '~/lib/db';
import {
  ACCESS_TOKEN_TTL_SEC,
  generateOpaqueToken,
  hashToken,
  verifyPkceS256,
} from '~/lib/oauth/oauth.server';

function jsonError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status }
  );
}

async function readParams(request: Request): Promise<URLSearchParams> {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    return new URLSearchParams(text);
  }
  if (ct.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') out.set(k, v);
    }
    return out;
  }
  // Fallback — try formData (multipart or query-style).
  try {
    const fd = await request.formData();
    const out = new URLSearchParams();
    fd.forEach((value, key) => {
      if (typeof value === 'string') out.append(key, value);
    });
    return out;
  } catch {
    return new URLSearchParams();
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return jsonError('invalid_request', 'POST required', 405);
  }

  const params = await readParams(request);
  const grantType = params.get('grant_type');
  const code = params.get('code');
  const redirectUri = params.get('redirect_uri');
  const codeVerifier = params.get('code_verifier');
  const clientId = params.get('client_id');

  if (grantType !== 'authorization_code') {
    return jsonError(
      'unsupported_grant_type',
      'Only authorization_code grant is supported'
    );
  }
  if (!code || !codeVerifier) {
    return jsonError('invalid_request', 'code and code_verifier are required');
  }

  const codeHash = hashToken(code);
  const db = getDb();

  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(
      and(
        eq(oauthAuthorizationCodes.codeHash, codeHash),
        eq(oauthAuthorizationCodes.used, false),
        gt(oauthAuthorizationCodes.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!authCode) {
    return jsonError(
      'invalid_grant',
      'authorization code is invalid, expired, or already used'
    );
  }

  if (redirectUri && authCode.redirectUri !== redirectUri) {
    return jsonError('invalid_grant', 'redirect_uri mismatch');
  }

  if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) {
    return jsonError('invalid_grant', 'code_verifier is invalid');
  }

  await db
    .update(oauthAuthorizationCodes)
    .set({ used: true })
    .where(eq(oauthAuthorizationCodes.id, authCode.id));

  let oauthClientPk: string | null = null;
  if (clientId) {
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);
    if (client) oauthClientPk = client.id;
  }

  const accessToken = generateOpaqueToken(32);
  const tokenHash = hashToken(accessToken);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);

  await db.insert(oauthAccessTokens).values({
    tokenHash,
    userId: authCode.userId,
    shopId: authCode.shopId,
    oauthClientId: oauthClientPk,
    scope: authCode.scope,
    disabledTools: authCode.disabledTools,
    expiresAt,
  });

  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: authCode.scope ?? 'mcp:read mcp:write',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        pragma: 'no-cache',
      },
    }
  );
}
