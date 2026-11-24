import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type McpClientHandle = {
  client: Client;
  close: () => Promise<void>;
};

/**
 * Open an authenticated MCP client against a Streamable-HTTP MCP endpoint.
 * Returns the SDK client + an explicit close() — caller is responsible for
 * cleanup so transports don't leak between specs.
 */
export async function connectMcpClient(args: {
  url: string;
  bearer: string;
  clientName?: string;
}): Promise<McpClientHandle> {
  const transport = new StreamableHTTPClientTransport(new URL(args.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${args.bearer}`,
      },
    },
  });
  const client = new Client(
    { name: args.clientName ?? 'puls-e2e', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}
