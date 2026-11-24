import { Outlet, redirect } from 'react-router';
import type { Route } from './+types/admin';
import { getDb } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';
import { AdminSidebar } from '~/components/admin/admin-sidebar';
import { AdminTopBar } from '~/components/admin/admin-top-bar';
import { useLoaderData } from 'react-router';

export const meta: Route.MetaFunction = () => [
  { title: 'Admin — Puls' },
  { name: 'robots', content: 'noindex, nofollow' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) throw redirect('/dashboard');
  return { email: user.email };
}

export default function AdminLayout() {
  const { email } = useLoaderData<typeof loader>();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 232px) minmax(0, 1fr)',
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--ink)',
      }}
      className="admin-shell"
    >
      <AdminSidebar />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <AdminTopBar email={email} />
        <main style={{ padding: '28px 36px 40px', overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
