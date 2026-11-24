type Props = {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down' | 'flat';
  ok?: boolean;
};

function Sparkline({ trend = 'up' }: { trend?: 'up' | 'down' | 'flat' }) {
  const path =
    trend === 'up'
      ? 'M0 18 L8 16 L16 12 L24 14 L32 8 L40 9 L48 4'
      : trend === 'flat'
        ? 'M0 12 L8 11 L16 13 L24 12 L32 11 L40 12 L48 11'
        : 'M0 4 L8 8 L16 6 L24 12 L32 14 L40 13 L48 18';
  return (
    <svg width="48" height="20" viewBox="0 0 48 20" fill="none" aria-hidden>
      <path
        d={path}
        stroke={trend === 'flat' ? 'var(--ink-3)' : 'var(--accent)'}
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

export function BigStatCard({ label, value, hint, trend, ok }: Props) {
  const arrow =
    trend === 'up' ? '▲' : trend === 'down' ? '▼' : '';
  return (
    <div className="card card-pad" style={{ padding: 18 }}>
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
          {label}
        </span>
        {arrow ? (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: ok || trend === 'up' ? 'var(--ok)' : 'var(--ink-3)',
            }}
          >
            {arrow}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div className="row between">
        <span className="muted" style={{ fontSize: 11 }}>
          {hint ?? ''}
        </span>
        {trend ? <Sparkline trend={trend} /> : null}
      </div>
    </div>
  );
}
