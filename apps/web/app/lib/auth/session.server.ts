import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { redirect } from 'react-router';
import { sessions, users } from '@puls/db/schema';
import type { DB } from '~/lib/db';
import { getConfig } from '~/lib/config';
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './constants';

export type SessionUser = {
  id: string;
  email: string;
};

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k || rest.length === 0) continue;
    out[k] = decodeURIComponent(rest.join('=').trim());
  }
  return out;
}

export function readSessionToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('Cookie'));
  return cookies[SESSION_COOKIE] ?? null;
}

export function sessionCookieHeader(
  token: string,
  opts: { maxAgeSec: number; clear?: boolean }
): string {
  const env = getConfig();
  const secure = env.NODE_ENV === 'production';
  // SameSite=None requires Secure; browsers ignore it otherwise. In dev
  // (http://localhost) we keep Lax so the cookie still works for the
  // first-party flow. In prod we need None so /settings/:shopId can be
  // embedded as a third-party iframe under the e-shop platform admin domain.
  const sameSite = secure ? 'SameSite=None' : 'SameSite=Lax';
  const parts = [
    `${SESSION_COOKIE}=${opts.clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    sameSite,
    secure ? 'Secure' : '',
    opts.clear ? 'Max-Age=0' : `Max-Age=${opts.maxAgeSec}`,
  ].filter(Boolean);
  return parts.join('; ');
}

export async function getSessionUser(
  db: DB,
  request: Request
): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const now = new Date();
  const rows = await db
    .select({
      userId: sessions.userId,
      sessionId: sessions.id,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const rollingUntil = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
  await db
    .update(sessions)
    .set({ expiresAt: rollingUntil })
    .where(eq(sessions.id, row.sessionId));

  return { id: row.userId, email: row.email };
}

export async function requireSessionUser(
  db: DB,
  request: Request
): Promise<SessionUser> {
  const user = await getSessionUser(db, request);
  if (!user) throw redirect('/login');
  return user;
}

export async function createUserSession(
  db: DB,
  userId: string
): Promise<{ token: string; setCookie: string }> {
  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
  await db.insert(sessions).values({
    userId,
    token,
    expiresAt,
  });
  return {
    token,
    setCookie: sessionCookieHeader(token, { maxAgeSec: SESSION_MAX_AGE_SEC }),
  };
}

export async function destroySession(
  db: DB,
  request: Request
): Promise<string> {
  const token = readSessionToken(request);
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  return sessionCookieHeader('', { maxAgeSec: 0, clear: true });
}
