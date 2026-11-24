import { oauthClients } from '@puls/db/schema';
import type { Route } from './+types/oauth.register';
import { getDb } from '~/lib/db';
import { generateClientId, generateOpaqueToken } from '~/lib/oauth/oauth.server';

type RegisterBody = {
  client_name?: unknown;
  redirect_uris?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  scope?: unknown;
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'method_not_allowed' },
      { status: 405 }
    );
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return Response.json(
      { error: 'invalid_request', error_description: 'JSON body required' },
      { status: 400 }
    );
  }

  if (typeof body.client_name !== 'string' || !body.client_name.trim()) {
    return Response.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'client_name is required',
      },
      { status: 400 }
    );
  }

  if (!isStringArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return Response.json(
      {
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris must be a non-empty array',
      },
      { status: 400 }
    );
  }

  for (const uri of body.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      return Response.json(
        {
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri "${uri}" is not a valid URL`,
        },
        { status: 400 }
      );
    }
  }

  const db = getDb();
  const clientId = generateClientId();
  const clientSecret = generateOpaqueToken(32);

  await db.insert(oauthClients).values({
    clientId,
    clientSecret,
    clientName: body.client_name.trim(),
    redirectUris: JSON.stringify(body.redirect_uris),
    clientUri: typeof body.client_uri === 'string' ? body.client_uri : null,
    logoUri: typeof body.logo_uri === 'string' ? body.logo_uri : null,
    scope:
      typeof body.scope === 'string' && body.scope.trim()
        ? body.scope
        : 'mcp:read mcp:write',
    isActive: true,
  });

  return new Response(
    JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope:
        typeof body.scope === 'string' && body.scope.trim()
          ? body.scope
          : 'mcp:read mcp:write',
    }),
    {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }
  );
}
