import type { Route } from './+types/well-known.oauth-protected-resource';

function webOrigin(request: Request): string {
  const fromEnv = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function mcpOrigin(request: Request): string {
  const fromEnv = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return webOrigin(request);
}

export async function loader({ request }: Route.LoaderArgs) {
  return Response.json({
    resource: mcpOrigin(request),
    authorization_servers: [webOrigin(request)],
    scopes_supported: ['mcp:read', 'mcp:write'],
    bearer_methods_supported: ['header'],
  });
}
