import { eq } from 'drizzle-orm';
import { users } from '@puls/db/schema';
import type { Route } from './+types/api.locale';
import { getDb } from '~/lib/db';
import { getSessionUser } from '~/lib/auth/session.server';
import { isValidLocale } from '~/lib/locale';
import { localeCookieHeader } from '~/lib/locale.server';

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const next = (body as { locale?: unknown } | null)?.locale;
  if (typeof next !== 'string' || !isValidLocale(next)) {
    return new Response('Invalid locale', { status: 400 });
  }

  const db = getDb();
  const user = await getSessionUser(db, request);
  if (user) {
    await db
      .update(users)
      .set({ preferredLocale: next })
      .where(eq(users.id, user.id));
  }

  return new Response(JSON.stringify({ ok: true, locale: next }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': localeCookieHeader(next),
    },
  });
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 });
}
