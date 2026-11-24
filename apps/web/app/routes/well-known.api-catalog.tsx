import type { Route } from './+types/well-known.api-catalog';
import { mcpEndpoint, webOrigin } from '~/lib/agent-readiness';

/**
 * /.well-known/api-catalog — RFC 9727 linkset.
 * Type: application/linkset+json (RFC 9264).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const origin = webOrigin(request);
  const mcp = mcpEndpoint(request);

  const body = {
    $schema: 'https://datatracker.ietf.org/doc/rfc9727/',
    linkset: [
      {
        anchor: origin,
        'service-desc': [
          {
            href: `${origin}/.well-known/mcp.json`,
            type: 'application/json',
            rel: 'service-desc',
            title: 'Puls MCP Server Card',
          },
          {
            href: `${origin}/.well-known/agent-skills/index.json`,
            type: 'application/json',
            rel: 'service-desc',
            title: 'Puls Agent Skills',
          },
        ],
        status: [
          {
            href: `${origin}/healthz`,
            type: 'application/json',
            rel: 'status',
            title: 'Puls health endpoint',
          },
        ],
        mcp: [
          {
            href: mcp,
            type: 'application/json',
            rel: 'mcp-endpoint',
            title: 'Puls MCP JSON-RPC endpoint',
          },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/linkset+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
