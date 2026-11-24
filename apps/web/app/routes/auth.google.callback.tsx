import { redirect } from 'react-router';
import type { Route } from './+types/auth.google.callback';
import { GOOGLE_OAUTH_STATE_COOKIE } from '~/lib/auth/constants';
import { ensureUserFromGoogle } from '~/lib/auth/ensure-user.server';
import {
  exchangeGoogleAuthCode,
  fetchGoogleUserInfo,
} from '~/lib/auth/google-oauth.server';
import { createUserSession } from '~/lib/auth/session.server';
import { getDb } from '~/lib/db';
import { getConfig } from '~/lib/config';

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name && rest.length > 0) {
      return decodeURIComponent(rest.join('=').trim());
    }
  }
  return null;
}

function clearStateCookie(secure: boolean): string {
  return [
    `${GOOGLE_OAUTH_STATE_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

export async function loader({ request }: Route.LoaderArgs) {
  const cfg = getConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request, GOOGLE_OAUTH_STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    throw redirect('/login?error=oauth');
  }

  const id = cfg.AUTH_GOOGLE_ID?.trim();
  const secret = cfg.AUTH_GOOGLE_SECRET?.trim();
  if (!id || !secret) {
    throw redirect('/login?error=google');
  }

  const origin = new URL(request.url).origin;
  const redirectUri =
    cfg.AUTH_GOOGLE_REDIRECT_URI?.trim() || `${origin}/auth/google/callback`;

  let accessToken: string;
  try {
    const tokens = await exchangeGoogleAuthCode({
      code,
      clientId: id,
      clientSecret: secret,
      redirectUri,
    });
    accessToken = tokens.access_token;
  } catch {
    throw redirect('/login?error=oauth');
  }

  let profile: Awaited<ReturnType<typeof fetchGoogleUserInfo>>;
  try {
    profile = await fetchGoogleUserInfo(accessToken);
  } catch {
    throw redirect('/login?error=oauth');
  }

  if (!profile.email_verified) {
    throw redirect('/login?error=email_unverified');
  }

  const db = getDb();
  const userId = await ensureUserFromGoogle(db, {
    email: profile.email,
    googleSub: profile.sub,
  });

  const { setCookie } = await createUserSession(db, userId);

  const headers = new Headers();
  headers.append('Location', '/dashboard');
  headers.append('Set-Cookie', setCookie);
  headers.append('Set-Cookie', clearStateCookie(cfg.NODE_ENV === 'production'));

  return new Response(null, { status: 302, headers });
}

export default function AuthGoogleCallback() {
  return null;
}
