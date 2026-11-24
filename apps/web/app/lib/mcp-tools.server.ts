import { getConfig } from '~/lib/config';

export type McpTool = {
  name: string;
  description: string;
};

function lastEnvelope(bodyText: string): Record<string, unknown> | null {
  const lines = bodyText.split('\n');
  const payloads: unknown[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === '[DONE]') continue;
    const text = line.startsWith('data:') ? line.slice('data:'.length).trim() : line;
    try {
      payloads.push(JSON.parse(text));
    } catch {
      // ignore
    }
  }
  if (payloads.length === 0) {
    try {
      payloads.push(JSON.parse(bodyText.trim()));
    } catch {
      // ignore
    }
  }
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    const p = payloads[i];
    if (p && typeof p === 'object' && ('result' in p || 'error' in p)) {
      return p as Record<string, unknown>;
    }
  }
  return null;
}

/** Fetch live tools/list from the MCP server for a given shop. */
export async function fetchShopMcpTools(args: {
  shopId: string;
  mcpSecret: string;
}): Promise<McpTool[]> {
  const env = getConfig();
  const proto = '2025-03-26';
  const url = new URL(
    `/mcp/${encodeURIComponent(args.shopId)}`,
    env.MCP_INTERNAL_URL
  );
  url.searchParams.set('key', args.mcpSecret);

  const initRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-protocol-version': proto,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: proto,
        capabilities: {},
        clientInfo: { name: 'puls-dashboard', version: '1' },
      },
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  await initRes.text();
  if (!sessionId) return [];

  const listRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-protocol-version': proto,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });
  const text = await listRes.text();
  const env2 = lastEnvelope(text);
  const result = env2?.result as { tools?: { name: string; description?: string }[] } | undefined;
  if (!result?.tools) return [];
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
  }));
}
