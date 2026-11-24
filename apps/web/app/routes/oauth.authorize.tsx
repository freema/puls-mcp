import { oauthPendingSessions } from '@puls/db/schema';
import { redirect } from 'react-router';
import type { Route } from './+types/oauth.authorize';
import { getDb } from '~/lib/db';
import { generateOpaqueToken, PENDING_TTL_MS } from '~/lib/oauth/oauth.server';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const responseType = url.searchParams.get('response_type');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope');
  const clientId = url.searchParams.get('client_id');

  if (responseType !== 'code') {
    return Response.json(
      {
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      },
      { status: 400 }
    );
  }
  if (!redirectUri) {
    return Response.json(
      { error: 'invalid_request', error_description: 'redirect_uri required' },
      { status: 400 }
    );
  }
  try {
    new URL(redirectUri);
  } catch {
    return Response.json(
      {
        error: 'invalid_request',
        error_description: 'redirect_uri must be a valid URL',
      },
      { status: 400 }
    );
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return Response.json(
      {
        error: 'invalid_request',
        error_description: 'PKCE with code_challenge_method=S256 is required',
      },
      { status: 400 }
    );
  }

  const mcpState = generateOpaqueToken(24);
  const db = getDb();
  await db.insert(oauthPendingSessions).values({
    mcpState,
    clientId,
    clientState: state,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
  });

  throw redirect(`/auth/mcp-connect?mcp_state=${encodeURIComponent(mcpState)}`);
}
