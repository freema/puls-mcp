import type { DashboardStats } from '~/lib/dashboard-stats.server';

export function QuickStatsGrid({
  stats,
  embed = false,
}: {
  stats: DashboardStats;
  embed?: boolean;
}) {
  const items: {
    k: string;
    v: string;
    d: string;
    trend?: string;
    mono?: boolean;
  }[] = [
    {
      k: 'Aktivní AI klienti',
      v: String(stats.aiClients || 0),
      d: 'počet MCP inicializací',
    },
    {
      k: 'MCP volání · 7d',
      v: String(stats.mcpCalls),
      d: 'cum. volání tools',
    },
    {
      k: 'Top tool',
      v: stats.topTool ?? '—',
      d: 'nejčastější tool',
      mono: true,
    },
    {
      k: 'Kvóta dnes',
      v: `${stats.callsToday} / ${stats.callsPerDay}`,
      d: `${stats.quotaPct}% denního limitu`,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: embed
          ? 'repeat(auto-fit, minmax(160px, 1fr))'
          : 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}
    >
      {items.map((s) => (
        <div key={s.k} className="card card-pad" style={{ padding: 18 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
              }}
            >
              {s.k}
            </span>
            {s.trend ? (
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--ok)' }}
              >
                {s.trend}
              </span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: s.mono ? 18 : 28,
              fontWeight: 600,
              fontFamily: s.mono ? 'var(--mono)' : 'var(--font)',
              letterSpacing: '-0.02em',
              marginBottom: 4,
              wordBreak: 'break-word',
            }}
          >
            {s.v}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {s.d}
          </div>
        </div>
      ))}
    </div>
  );
}
