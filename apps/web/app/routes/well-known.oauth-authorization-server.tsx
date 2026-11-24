import type { Route } from './+types/well-known.oauth-authorization-server';

function origin(request: Request): string {
  const fromEnv = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const issuer = origin(request);
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
}
