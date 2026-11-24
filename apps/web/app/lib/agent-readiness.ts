/**
 * Agent-readiness helpers — shared origin / discovery-link logic used by the
 * /.well-known endpoints and the homepage Link header.
 *
 * Why centralized: the isitagentready.com scanner cross-checks that every
 * advertised URL (in robots.txt, the Link header, the api-catalog and the MCP
 * server card) actually resolves. Drifting copies of these strings are the #1
 * way scoring regresses silently.
 */

export const PRODUCTION_ORIGIN = 'https://pulsmcp.com';

export function webOrigin(request: Request): string {
  const fromEnv = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Behind nginx (TLS-terminated), request.url sees http://. Trust
  // X-Forwarded-Proto/Host so advertised discovery URLs stay https.
  const url = new URL(request.url);
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(/:$/, '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() || url.host;
  return `${proto}://${host}`;
}

export function mcpOrigin(request: Request): string {
  const fromEnv = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return webOrigin(request);
}

export function mcpEndpoint(request: Request): string {
  return `${mcpOrigin(request)}/mcp`;
}

/**
 * RFC 8288 Link header value pointing agents to discovery resources.
 * Order matters less than presence — the scanner parses by rel type.
 */
export function discoveryLinkHeader(origin: string): string {
  return [
    `<${origin}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
    `<${origin}/.well-known/mcp.json>; rel="describedby"; type="application/json"`,
    `<${origin}/.well-known/mcp/server-card.json>; rel="mcp-server-card"; type="application/json"`,
    `<${origin}/.well-known/agent-skills/index.json>; rel="agent-skills"; type="application/json"`,
    `<${origin}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"`,
    `<${origin}/.well-known/oauth-authorization-server>; rel="oauth-authorization-server"; type="application/json"`,
  ].join(', ');
}
