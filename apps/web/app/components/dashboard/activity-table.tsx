type Row = { ts: number; tool: string; status: string; detail?: string };

function relativeTime(ts: number) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'teď';
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

function pillForStatus(status: string) {
  const s = status.toLowerCase();
  if (s.includes('ok') || s.includes('200'))
    return <span className="pill pill-ok" style={{ fontSize: 10 }}>200</span>;
  if (s.includes('429') || s.includes('rate'))
    return <span className="pill pill-warn" style={{ fontSize: 10 }}>429</span>;
  if (s.includes('err') || s.includes('404') || s.includes('500'))
    return <span className="pill pill-err" style={{ fontSize: 10 }}>{status}</span>;
  return <span className="pill" style={{ fontSize: 10 }}>{status}</span>;
}

export function ActivityTable({
  rows,
  compact = false,
}: {
  rows: Row[];
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Čas</th>
              <th>Tool</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="muted"
                  data-testid="activity-empty"
                  style={{ padding: '24px 22px' }}
                >
                  Zatím žádná volání — zkuste nástroj z Claude.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.ts}-${r.tool}`}>
                  <td
                    className="mono muted"
                    style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    {relativeTime(r.ts)}
                  </td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {r.tool}
                  </td>
                  <td>{pillForStatus(r.status)}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {r.detail ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

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
            Activity log
          </h3>
          <span
            className="muted"
            style={{ fontSize: 12, lineHeight: 1.4, margin: 0 }}
          >
            {rows.length || 0} záznamů · auto-refresh 30 s
          </span>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Čas</th>
              <th>Tool</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="muted"
                  data-testid="activity-empty"
                  style={{ padding: '24px 22px' }}
                >
                  Zatím žádná volání — zkuste nástroj z Claude.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.ts}-${r.tool}`}>
                  <td
                    className="mono muted"
                    style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    {relativeTime(r.ts)}
                  </td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {r.tool}
                  </td>
                  <td>{pillForStatus(r.status)}</td>
                  <td
                    className="mono muted"
                    style={{ fontSize: 12 }}
                  >
                    {r.detail ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
