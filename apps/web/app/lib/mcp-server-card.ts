/**
 * Source of truth for the MCP Server Card JSON document.
 *
 * The same payload is served from both /.well-known/mcp.json (legacy /
 * Cloudflare convention) and /.well-known/mcp/server-card.json (SEP-1649).
 * Counts in `capabilities.tools.groups` track the live tool registrations in
 * apps/mcp-server/src/tools/*.ts — keep in sync when adding tools.
 */

export interface BuildArgs {
  webOrigin: string;
  mcpOrigin: string;
}

export function buildMcpServerCard({ webOrigin, mcpOrigin }: BuildArgs) {
  // Single source of truth: APP_VERSION is injected from the release tag by
  // GitHub Actions (the original deploy workflow) and promoted ARG→ENV in the
  // Dockerfiles — same value /api/version reports. No hardcoded version string.
  const version = process.env.APP_VERSION || 'development';
  return {
    $schema: 'https://modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    serverInfo: {
      name: 'Puls',
      version,
      transport: 'streamable-http',
    },
    name: 'Puls',
    description:
      'Puls connects e-shops on Shoptet and Upgates with AI assistants like Claude, ChatGPT and Cursor — orders, products, customers and operational insights, plus immediate writes with a full audit log and one-click revert, over the Model Context Protocol.',
    version,
    icon: `${webOrigin}/puls-logo-512.png`,
    publisher: {
      name: 'Puls',
      url: webOrigin,
      support_email: 'support@example.com',
    },
    endpoint: `${mcpOrigin}/mcp`,
    transport: 'streamable-http',
    protocol_version: '2025-03-26',
    authentication: {
      type: 'oauth2',
      authorization_server_metadata: `${webOrigin}/.well-known/oauth-authorization-server`,
      protected_resource_metadata: `${webOrigin}/.well-known/oauth-protected-resource`,
      scopes_supported: ['mcp:read', 'mcp:write'],
      pkce_required: true,
    },
    capabilities: {
      tools: {
        groups: [
          {
            id: 'orders',
            description: 'E-shop orders — list, search, fetch detail',
          },
          {
            id: 'products',
            description: 'E-shop products — list, search, stock levels',
          },
          {
            id: 'customers',
            description: 'E-shop customers — list, search, profile detail',
          },
          {
            id: 'catalog',
            description:
              'Catalog metadata — categories, price lists, warehouses',
          },
          {
            id: 'insights',
            description:
              'Composite analytics — sales summary, low-stock, top products, top customers',
          },
          {
            id: 'writes',
            description:
              'Mutating writes (create / update / delete) applied immediately with full audit log and one-click revert',
          },
          {
            id: 'memory',
            description: 'Per-shop learned memory and preferences',
          },
        ],
      },
      resources: { supported: true },
      prompts: { supported: true },
    },
    documentation: {
      home: `${webOrigin}/`,
      source: 'https://github.com/freema/puls-mcp',
    },
    discovery: {
      api_catalog: `${webOrigin}/.well-known/api-catalog`,
      agent_skills: `${webOrigin}/.well-known/agent-skills/index.json`,
    },
    languages: ['cs', 'en'],
  };
}
