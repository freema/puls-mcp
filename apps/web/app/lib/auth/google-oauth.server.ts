export function buildGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', args.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeGoogleAuthCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${t}`);
  }

  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) {
    throw new Error('Google token response missing access_token');
  }
  return { access_token: j.access_token };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`);
  }

  const j = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
  };

  if (!j.sub || !j.email) {
    throw new Error('Google userinfo missing sub/email');
  }

  return {
    sub: j.sub,
    email: j.email,
    email_verified: Boolean(j.email_verified),
  };
}
