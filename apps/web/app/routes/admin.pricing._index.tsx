import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.pricing._index';
import { getDb } from '~/lib/db';
import { requireAdmin } from '~/lib/auth/admin.server';
import { getAllTiers, getTierShopCounts } from '~/lib/pricing.server';
import { formatPriceCZK } from '~/lib/pricing';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  await requireAdmin(db, request);
  const [tiers, counts] = await Promise.all([
    getAllTiers(db),
    getTierShopCounts(db),
  ]);
  return { tiers, counts };
}

export default function AdminPricingIndex() {
  const { tiers, counts } = useLoaderData<typeof loader>();

  return (
    <div className="col gap-16" style={{ maxWidth: 1100 }}>
      <header className="col gap-4">
        <h1 className="heading-2" style={{ margin: 0, fontSize: 22 }}>
          Pricing tiery
        </h1>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Tiery se editují, ne mažou. Skryj tier z marketing tabulky vypnutím
          „Public“. Trial je vázán na <code>eshopId</code> a nelze opakovat.
        </span>
      </header>

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <table className="table" style={{ margin: 0, fontSize: 12.5, width: '100%' }}>
          <thead>
            <tr>
              <th>Název</th>
              <th>ID</th>
              <th style={{ width: 110 }}>Měsíčně</th>
              <th style={{ width: 110 }}>Calls/den</th>
              <th style={{ width: 90 }}>Memory</th>
              <th style={{ width: 80 }}>Log dní</th>
              <th style={{ width: 80 }}>Shopů</th>
              <th style={{ width: 80 }}>Public</th>
              <th style={{ width: 70 }}>Trial</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                  {t.isHighlighted && (
                    <span className="pill pill-accent" style={{ marginLeft: 6, fontSize: 9 }}>
                      ★
                    </span>
                  )}
                </td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {t.id}
                </td>
                <td className="mono">
                  {t.priceMonthly === 0 ? '—' : `${formatPriceCZK(t.priceMonthly)} Kč`}
                </td>
                <td className="mono">{formatPriceCZK(t.callsPerDay)}</td>
                <td className="mono">
                  {t.maxMemoryItems === -1 ? '∞' : t.maxMemoryItems}
                </td>
                <td className="mono">{t.activityRetentionDays}</td>
                <td className="mono">{counts[t.id] ?? 0}</td>
                <td>
                  <span
                    className={`pill ${t.isPublic ? 'pill-ok' : 'pill-err'}`}
                    style={{ fontSize: 10 }}
                  >
                    {t.isPublic ? 'public' : 'hidden'}
                  </span>
                </td>
                <td>
                  {t.isTrial && (
                    <span className="pill pill-accent" style={{ fontSize: 10 }}>
                      {t.trialDays}d
                    </span>
                  )}
                </td>
                <td>
                  <Link
                    to={`/admin/pricing/${t.id}`}
                    className="btn btn-soft btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    Upravit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
