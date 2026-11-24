import { randomBytes } from 'node:crypto';
import { redirect } from 'react-router';
import type { Route } from './+types/auth.google';
import { GOOGLE_OAUTH_STATE_COOKIE } from '~/lib/auth/constants';
import { buildGoogleAuthUrl } from '~/lib/auth/google-oauth.server';
import { getConfig } from '~/lib/config';

export async function loader({ request }: Route.LoaderArgs) {
  const cfg = getConfig();
  const id = cfg.AUTH_GOOGLE_ID?.trim();
  const secret = cfg.AUTH_GOOGLE_SECRET?.trim();
  if (!id || !secret) {
    throw redirect('/login?error=google');
  }

  const state = randomBytes(24).toString('hex');
  const origin = new URL(request.url).origin;
  const redirectUri =
    cfg.AUTH_GOOGLE_REDIRECT_URI?.trim() || `${origin}/auth/google/callback`;

  const secure = cfg.NODE_ENV === 'production';
  const cookie = [
    `${GOOGLE_OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=600',
  ]
    .filter(Boolean)
    .join('; ');

  const url = buildGoogleAuthUrl({
    clientId: id,
    redirectUri,
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': cookie,
    },
  });
}

export default function AuthGoogleStart() {
  return null;
}
