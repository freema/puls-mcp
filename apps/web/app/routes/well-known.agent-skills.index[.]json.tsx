import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Route } from './+types/well-known.agent-skills.index[.]json';
import { mcpEndpoint, webOrigin } from '~/lib/agent-readiness';
import { SKILLS } from '~/lib/agent-skills';

/**
 * Agent Skills Discovery v0.2.0 index.
 * Hashes each SKILL.md at request time so the published sha256 always matches
 * the served file.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const origin = webOrigin(request);
  const skillsRoot = path.join(
    process.cwd(),
    'public',
    '.well-known',
    'agent-skills'
  );

  const skills = SKILLS.map((s) => {
    const filePath = path.join(skillsRoot, s.name, 'SKILL.md');
    let sha256 = '';
    try {
      const buf = readFileSync(filePath);
      sha256 = createHash('sha256').update(buf).digest('hex');
    } catch {
      // file missing — emit empty digest rather than 500 so the rest of the
      // discovery surface keeps working. Logged via the route's error path.
    }
    return {
      name: s.name,
      type: s.type,
      description: s.description,
      url: `${origin}/.well-known/agent-skills/${s.name}/SKILL.md`,
      sha256,
    };
  });

  const body = {
    $schema:
      'https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schemas/v0.2.0/index.json',
    version: '0.2.0',
    name: 'Puls E-shop Skills',
    description:
      'High-level e-shop operations an AI agent can run end-to-end through the Puls MCP server — orders, products, customers, low-stock alerts and sales summaries.',
    server: `${origin}/.well-known/mcp/server-card.json`,
    mcp_endpoint: mcpEndpoint(request),
    skills,
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
