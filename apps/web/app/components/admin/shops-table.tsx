import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';

export type ShopRow = {
  id: string;
  platform: string;
  platformAccountId: string;
  domain: string;
  name: string | null;
  status: string;
  installedAt: string;
};

function statusDot(status: string) {
  const s = status.toLowerCase();
  if (s.includes('active')) return 'dot-ok';
  if (s.includes('paused')) return 'dot-warn';
  return 'dot-err';
}

export function ShopsTable({ rows }: { rows: ShopRow[] }) {
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="row between"
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <h3 className="heading-3">Shops</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {rows.length} total
          </span>
        </div>
        <div className="row gap-8">
          <button type="button" className="btn btn-soft btn-sm">
            All <ChevronDown size={12} />
          </button>
          <button type="button" className="btn btn-soft btn-sm">
            Export
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Platforma / ID</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="col gap-4">
                    <div className="row gap-8">
                      <span className={`dot ${statusDot(r.status)}`} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>
                        {r.name ?? r.domain}
                      </span>
                    </div>
                    <span
                      className="mono faint"
                      style={{ fontSize: 11 }}
                    >
                      {r.domain}
                    </span>
                  </div>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  <span className="faint">{r.platform}</span> · {r.platformAccountId}
                </td>
                <td>
                  <span
                    className={`pill ${
                      r.status.toLowerCase() === 'active'
                        ? 'pill-ok'
                        : r.status.toLowerCase() === 'paused'
                          ? 'pill-warn'
                          : 'pill-err'
                    }`}
                    style={{ fontSize: 10 }}
                  >
                    {r.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link
                    to={`/admin/shops/${r.id}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
