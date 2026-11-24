import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

type ClientId = 'claude' | 'chatgpt' | 'cursor' | 'continue';

type ClientGuide = {
  id: ClientId;
  label: string;
  configPath: string;
  configLabel: string;
  intro: string;
  snippet: (mcpUrl: string) => string;
  docsUrl?: string;
};

const CLIENTS: ClientGuide[] = [
  {
    id: 'claude',
    label: 'Claude Desktop',
    configPath:
      '~/Library/Application Support/Claude/claude_desktop_config.json',
    configLabel: 'claude_desktop_config.json',
    intro:
      'Otevřete konfigurační soubor a vložte záznam do mcpServers. Po uložení Claude Desktop restartujte.',
    snippet: (url) =>
      JSON.stringify(
        {
          mcpServers: {
            puls: {
              url,
            },
          },
        },
        null,
        2
      ),
    docsUrl: 'https://docs.anthropic.com/claude/docs/mcp',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configPath: 'Settings → MCP → Add Server',
    configLabel: '~/.cursor/mcp.json',
    intro:
      'V Cursoru otevřete Settings → MCP a přidejte nový server. Případně vložte přímo do ~/.cursor/mcp.json.',
    snippet: (url) =>
      JSON.stringify(
        {
          mcpServers: {
            puls: {
              url,
            },
          },
        },
        null,
        2
      ),
    docsUrl: 'https://docs.cursor.com/context/mcp',
  },
  {
    id: 'continue',
    label: 'Continue',
    configPath: '~/.continue/config.json',
    configLabel: 'config.json',
    intro:
      'V config.json přidejte do experimental.modelContextProtocolServers nový záznam s URL MCP serveru.',
    snippet: (url) =>
      JSON.stringify(
        {
          experimental: {
            modelContextProtocolServers: [
              {
                transport: { type: 'streamable-http', url },
              },
            ],
          },
        },
        null,
        2
      ),
    docsUrl: 'https://docs.continue.dev/customize/deep-dives/mcp',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    configPath: 'ChatGPT → Settings → Connectors → Add custom',
    configLabel: 'OpenAI Custom Connector',
    intro:
      'V ChatGPT (Plus / Team / Enterprise) otevřete Settings → Connectors → Add custom connector a vložte URL níže. ChatGPT projde OAuth flow proti vašemu Puls účtu.',
    snippet: (url) => url,
    docsUrl: 'https://platform.openai.com/docs/guides/tools-connectors-mcp',
  },
];

export function McpUrlCard({ mcpUrl }: { mcpUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [activeClient, setActiveClient] = useState<ClientId>('claude');

  const guide = CLIENTS.find((c) => c.id === activeClient) ?? CLIENTS[0];
  const snippet = guide.snippet(mcpUrl);

  async function copyUrl() {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 1800);
  }

  return (
    <section
      className="card"
      style={{
        padding: 32,
        marginBottom: 24,
        position: 'relative',
        overflow: 'hidden',
        background:
          'linear-gradient(180deg, rgba(255,122,61,0.06), var(--surface) 60%)',
        borderColor: 'rgba(255,122,61,0.20)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 360,
          height: 360,
          background:
            'radial-gradient(circle, rgba(255,122,61,0.18), transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <h2
        style={{
          margin: 0,
          marginBottom: 10,
          position: 'relative',
          fontSize: 28,
          lineHeight: 1.25,
          letterSpacing: '-0.02em',
          fontWeight: 600,
          color: 'var(--ink)',
        }}
      >
        Vaše MCP endpoint URL
      </h2>
      <p
        className="muted"
        style={{
          marginTop: 0,
          marginBottom: 22,
          fontSize: 14,
          lineHeight: 1.55,
          position: 'relative',
        }}
      >
        Zkopírujte do AI klienta. Klient projde OAuth přihlášením a vy si na
        consent obrazovce vyberete eshop a nástroje.
      </p>
      <div
        className="row gap-8"
        style={{ marginBottom: 22, position: 'relative' }}
      >
        <div
          className="row"
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'var(--bg)',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
            fontFamily: 'var(--mono)',
            fontSize: 13,
            color: 'var(--ink)',
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {mcpUrl}
          </span>
          <button
            type="button"
            className={`btn btn-sm ${copied ? 'btn-soft' : 'btn-primary'}`}
            onClick={() => void copyUrl()}
          >
            {copied ? (
              <>
                <Check size={12} /> Zkopírováno
              </>
            ) : (
              <>
                <Copy size={12} /> Kopírovat
              </>
            )}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Návod pro AI klienta"
        className="row gap-6"
        style={{
          position: 'relative',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {CLIENTS.map((c) => {
          const active = c.id === activeClient;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveClient(c.id)}
              style={{
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 500,
                color: active ? 'var(--ink)' : 'var(--ink-3)',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${
                  active ? 'var(--accent)' : 'transparent'
                }`,
                cursor: 'pointer',
                marginBottom: -1,
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        style={{
          position: 'relative',
          paddingTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <p
          className="muted"
          style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}
        >
          {guide.intro}
        </p>
        <div
          className="row gap-8"
          style={{ flexWrap: 'wrap', alignItems: 'baseline' }}
        >
          <span
            className="mono muted"
            style={{ fontSize: 11, letterSpacing: '0.06em' }}
          >
            {guide.configLabel}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-3)' }}
          >
            {guide.configPath}
          </span>
        </div>
        <div
          style={{
            position: 'relative',
            background: 'var(--bg)',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
          }}
        >
          <button
            type="button"
            onClick={() => void copySnippet()}
            className={`btn btn-sm ${snippetCopied ? 'btn-soft' : 'btn-ghost'}`}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 1,
            }}
          >
            {snippetCopied ? (
              <>
                <Check size={12} /> Zkopírováno
              </>
            ) : (
              <>
                <Copy size={12} /> Kopírovat
              </>
            )}
          </button>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: '14px 16px',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowX: 'auto',
            }}
          >
            {snippet}
          </pre>
        </div>
        {guide.docsUrl ? (
          <a
            href={guide.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="row gap-6"
            style={{
              fontSize: 12.5,
              color: 'var(--ink-3)',
              textDecoration: 'none',
              width: 'fit-content',
            }}
          >
            Oficiální návod {guide.label} <ExternalLink size={11} />
          </a>
        ) : null}
      </div>
    </section>
  );
}
