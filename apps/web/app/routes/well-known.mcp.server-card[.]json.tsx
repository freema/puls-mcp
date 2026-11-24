import type { Route } from './+types/well-known.mcp.server-card[.]json';
import { mcpOrigin, webOrigin } from '~/lib/agent-readiness';
import { buildMcpServerCard } from '~/lib/mcp-server-card';

export async function loader({ request }: Route.LoaderArgs) {
  const card = buildMcpServerCard({
    webOrigin: webOrigin(request),
    mcpOrigin: mcpOrigin(request),
  });
  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
