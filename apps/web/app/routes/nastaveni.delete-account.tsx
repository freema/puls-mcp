import { eq } from 'drizzle-orm';
import { redirect } from 'react-router';
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  sessions,
  users,
} from '@puls/db/schema';
import type { Route } from './+types/nastaveni.delete-account';
import { getDb } from '~/lib/db';
import {
  destroySession,
  requireSessionUser,
} from '~/lib/auth/session.server';

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const user = await requireSessionUser(db, request);

  const clearCookie = await destroySession(db, request);

  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db
    .delete(oauthAccessTokens)
    .where(eq(oauthAccessTokens.userId, user.id));
  await db
    .delete(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/?account_deleted=1',
      'Set-Cookie': clearCookie,
    },
  });
}

export async function loader() {
  throw redirect('/nastaveni');
}

export default function DeleteAccountRoute() {
  return null;
}
