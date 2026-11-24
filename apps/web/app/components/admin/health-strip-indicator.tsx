type Item = { label: string; ok: boolean; detail?: string };

export function HealthStripIndicator({ items }: { items: Item[] }) {
  return (
    <div
      className="card"
      style={{
        padding: 0,
        marginBottom: 16,
        display: 'flex',
        flexWrap: 'wrap',
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className="row gap-10"
          style={{
            padding: '14px 18px',
            borderRight:
              i < items.length - 1 ? '1px solid var(--line)' : 'none',
            flex: '1 1 180px',
            minWidth: 0,
          }}
          title={it.detail}
        >
          <span className={`dot ${it.ok ? 'dot-ok' : 'dot-err'}`} />
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              {it.label}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {it.ok ? (it.detail ?? 'OK') : (it.detail ?? 'FAIL')}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
