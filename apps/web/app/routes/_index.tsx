import { data, Link } from 'react-router';
import type { Route } from './+types/_index';
import { SiteHeader } from '~/components/header';
import { discoveryLinkHeader, webOrigin } from '~/lib/agent-readiness';

const REPO_URL = 'https://github.com/freema/puls-mcp';
const DOCS_URL = `${REPO_URL}/tree/main/docs`;

export async function loader({ request }: Route.LoaderArgs) {
  // RFC 8288 discovery — points agents at the MCP server card, the
  // agent-skills index, the API catalog and the OAuth metadata.
  return data(null, {
    headers: { Link: discoveryLinkHeader(webOrigin(request)) },
  });
}

// React Router strips loader headers from the document response by default;
// re-export them so the Link header reaches the client.
export const headers: Route.HeadersFunction = ({ loaderHeaders }) =>
  loaderHeaders;

export const meta: Route.MetaFunction = () => [
  { title: 'Puls MCP — archived reference implementation' },
  {
    name: 'description',
    content:
      'Puls MCP connected AI assistants to e-shops via the Model Context Protocol. Shut down on 2026-07-23; the source is published as a read-only reference implementation.',
  },
  { name: 'robots', content: 'noindex' },
];

const HOW_IT_WORKED = [
  {
    title: 'Add the MCP URL',
    body: 'The shop owner pasted a single MCP server URL into their AI client (Claude, ChatGPT, Cursor, …).',
  },
  {
    title: 'Sign in and consent',
    body: 'The client ran an OAuth 2.1 flow: sign-in (e-mail code or Google), then a consent screen to pick which tool categories the assistant may use.',
  },
  {
    title: 'Token bound to one shop',
    body: 'The issued access token was bound to exactly one shop and the consented tool set — the MCP endpoint itself stayed generic.',
  },
  {
    title: 'Read and write shop data',
    body: 'The assistant could read and write orders, products, categories, customers and coupons. Every write was applied immediately, audited with a before/after diff and revertible from the dashboard.',
  },
];

const FEATURES = [
  'OAuth 2.1 authorization server with RFC 8414 / RFC 9728 discovery, Dynamic Client Registration and PKCE (S256)',
  'Streamable HTTP MCP server with tools, resources and prompts',
  'Write audit log with one-click revert',
  'Per-shop memory of learned preferences',
  'Platform-neutral connector architecture (live integration: Upgates)',
  'Web app: React Router v7 (SSR) — login, client dashboard, admin',
  'MCP server: Node.js + Express',
  'Drizzle ORM + PostgreSQL, Redis',
  'Playwright end-to-end tests',
];

const sectionStyle = { marginTop: 48 } as const;

export default function Index() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <SiteHeader />
      <main
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: '40px clamp(16px, 4vw, 40px) 80px',
        }}
      >
        <div
          role="status"
          className="card card-pad"
          style={{
            borderColor: 'rgba(245,158,11,0.45)',
            background: 'rgba(245,158,11,0.08)',
            fontSize: 14.5,
            lineHeight: 1.55,
          }}
        >
          <strong>Archived.</strong> Puls MCP was shut down on 2026-07-23.
          This site and its source code are a read-only reference
          implementation — the service is no longer operated.
        </div>

        <section style={{ marginTop: 40 }}>
          <span className="eyebrow">Puls MCP</span>
          <h1 className="heading-1" style={{ margin: '8px 0 16px' }}>
            AI assistants connected to e-shops via the Model Context Protocol
          </h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: 1.65 }}>
            Puls MCP let shop owners connect AI assistants — Claude, ChatGPT,
            Cursor and other MCP clients — directly to their e-shop. The live
            integration was Upgates; the connector layer was platform-neutral
            so further e-commerce platforms could be added behind the same MCP
            surface.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 className="heading-2">How it worked</h2>
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '16px 0 0',
              display: 'grid',
              gap: 12,
            }}
          >
            {HOW_IT_WORKED.map((step, i) => (
              <li key={step.title} className="card card-pad">
                <div className="row gap-12" style={{ alignItems: 'baseline' }}>
                  <span className="mono faint">{i + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p
                      className="muted"
                      style={{ margin: '6px 0 0', lineHeight: 1.6 }}
                    >
                      {step.body}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section style={sectionStyle}>
          <h2 className="heading-2">Features &amp; tech</h2>
          <ul
            className="muted"
            style={{ margin: '16px 0 0', paddingLeft: 20, lineHeight: 1.8 }}
          >
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 className="heading-2">Source</h2>
          <div className="row gap-12" style={{ flexWrap: 'wrap', marginTop: 16 }}>
            <a href={REPO_URL} className="btn btn-primary btn-sm">
              GitHub repository
            </a>
            <a href={DOCS_URL} className="btn btn-soft btn-sm">
              Documentation
            </a>
          </div>
          <p className="faint" style={{ fontSize: 13, marginTop: 20 }}>
            Running it locally? The app still works —{' '}
            <Link to="/login" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
