import { Outlet } from 'react-router';
import type { Route } from './+types/dashboard';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  return { email: user.email };
}

export default function DashboardLayout() {
  return (
    <div
      className="dashboard-shell"
      style={{
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--ink)',
      }}
    >
      <Outlet />
    </div>
  );
}
