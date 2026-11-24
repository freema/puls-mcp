import { redirect } from 'react-router';
import type { Route } from './+types/auth.logout';
import { getDb } from '~/lib/db';
import { destroySession } from '~/lib/auth/session.server';

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const clearCookie = await destroySession(db, request);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': clearCookie,
    },
  });
}

export async function loader() {
  throw redirect('/');
}

export default function AuthLogout() {
  return null;
}
