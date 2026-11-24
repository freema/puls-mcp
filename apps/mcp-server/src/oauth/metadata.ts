import type { Request, Response } from 'express';

function publicOrigin(req: Request): string {
  const fromEnv = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ||
    (req.protocol ?? 'http');
  const host = req.headers.host ?? 'localhost:3001';
  return `${proto}://${host}`;
}

function authServerOrigin(req: Request): string {
  const fromEnv = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return publicOrigin(req);
}

/** RFC 9728 — OAuth 2.0 Protected Resource Metadata */
export function getProtectedResourceMetadata(req: Request, res: Response) {
  const resource = publicOrigin(req);
  const authServer = authServerOrigin(req);
  res.json({
    resource,
    authorization_servers: [authServer],
    scopes_supported: ['mcp:read', 'mcp:write'],
    bearer_methods_supported: ['header'],
  });
}

/** RFC 8414 — OAuth 2.0 Authorization Server Metadata */
export function getAuthServerMetadata(req: Request, res: Response) {
  const issuer = authServerOrigin(req);
  res.json({
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
