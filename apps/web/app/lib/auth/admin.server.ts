import { redirect } from 'react-router';
import type { DB } from '~/lib/db';
import { requireSessionUser } from '~/lib/auth/session.server';
import { isAdminEmail } from '~/lib/auth/shops-for-user.server';

export async function requireAdmin(db: DB, request: Request) {
  const user = await requireSessionUser(db, request);
  if (!isAdminEmail(user.email)) throw redirect('/dashboard');
  return user;
}
