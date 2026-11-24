import { Link, useLoaderData } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { eq } from 'drizzle-orm';
import type { Route } from './+types/dashboard.$shopId.tools';
import { shops } from '@puls/db/schema';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { fetchShopMcpTools } from '~/lib/mcp-tools.server';
import { ToolsList } from '~/components/dashboard/tools-list';

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  const shopId = params.shopId;
  if (!shopId) throw new Response('Not found', { status: 404 });

  const [shop] = await db
    .select({
      id: shops.id,
      adminEmail: shops.adminEmail,
      mcpEndpointSecret: shops.mcpEndpointSecret,
    })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) throw new Response('Not found', { status: 404 });

  if (
    !shop.adminEmail ||
    shop.adminEmail.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new Response('Forbidden', { status: 403 });
  }

  const tools = await fetchShopMcpTools({
    shopId: shop.id,
    mcpSecret: shop.mcpEndpointSecret,
  }).catch(() => []);

  return { shopId, tools };
}

export default function DashboardTools() {
  const { shopId, tools } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="col gap-8" style={{ marginBottom: 24 }}>
        <Link
          to={`/dashboard/${shopId}`}
          className="row gap-6"
          style={{
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontSize: 12.5,
            width: 'fit-content',
          }}
        >
          <ArrowLeft size={12} /> Přehled
        </Link>
        <h1
          style={{
            fontSize: 32,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            fontWeight: 600,
            margin: 0,
            color: 'var(--ink)',
          }}
        >
          MCP tools
        </h1>
        <p
          className="muted"
          style={{ fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 640 }}
        >
          Seznam MCP tools, které váš endpoint aktuálně vystavuje. Popisy
          přicházejí přímo z MCP serveru — všechny tooly jsou ve výchozím
          stavu aktivní.
        </p>
      </div>

      <ToolsList tools={tools} />
    </>
  );
}
