type Tool = {
  name: string;
  description: string;
};

export function ToolsList({ tools }: { tools: Tool[] }) {
  return (
    <section
      className="card"
      style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}
    >
      <div
        className="row between"
        style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="heading-3" style={{ margin: 0, marginBottom: 8 }}>
            Dostupné MCP tools
          </h3>
          <span className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
            {tools.length} tools · vše aktivní
          </span>
        </div>
      </div>
      <div>
        {tools.length === 0 ? (
          <div
            className="muted"
            style={{ padding: '24px 22px', fontSize: 13 }}
          >
            Tooly se nepodařilo načíst — zkontrolujte stav MCP serveru.
          </div>
        ) : (
          tools.map((t, i) => (
            <div
              key={t.name}
              className="row between"
              style={{
                padding: '14px 22px',
                borderBottom:
                  i < tools.length - 1 ? '1px solid var(--line)' : 'none',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 13, color: 'var(--ink)' }}
                >
                  {t.name}
                </span>
                <span
                  className="muted"
                  style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}
                >
                  {t.description || '—'}
                </span>
              </div>
              <span className="pill pill-ok" style={{ fontSize: 11 }}>
                <span className="dot dot-ok" /> Aktivní
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
