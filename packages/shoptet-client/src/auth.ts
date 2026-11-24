import axios from 'axios';
import type { EshopInfoResponse, TokenResponse } from './types.js';

export type ExchangeInstallCodeParams = {
  code: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export async function exchangeInstallCode(
  params: ExchangeInstallCodeParams
): Promise<{ oauthAccessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    scope: 'basic_eshop',
  });

  const response = await axios.post<TokenResponse>(
    params.tokenUrl,
    body.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    }
  );

  const data = response.data;
  if (response.status >= 400 || !data.access_token) {
    throw new Error(`OAuth token exchange failed (HTTP ${response.status})`);
  }

  return {
    oauthAccessToken: data.access_token,
    expiresIn: data.expires_in ?? 43200,
  };
}

export async function fetchBasicEshop(
  apiBaseUrl: string,
  oauthAccessToken: string
): Promise<EshopInfoResponse['data']> {
  const url = new URL('/resource', apiBaseUrl.replace(/\/$/, ''));
  url.searchParams.set('method', 'getBasicEshop');

  const response = await axios.get<EshopInfoResponse>(url.toString(), {
    headers: { Authorization: `Bearer ${oauthAccessToken}` },
    validateStatus: () => true,
  });

  const data = response.data;
  if (
    response.status >= 400 ||
    !data?.data?.project?.id ||
    !data?.data?.project?.url
  ) {
    throw new Error(`getBasicEshop failed (HTTP ${response.status})`);
  }

  return data.data;
}

export async function fetchApiAccessToken(
  apiBaseUrl: string,
  oauthAccessToken: string
): Promise<TokenResponse> {
  const base = apiBaseUrl.replace(/\/$/, '');
  const url = `${base}/action/ApiOAuthServer/getAccessToken`;
  const response = await axios.get<TokenResponse>(url, {
    headers: { Authorization: `Bearer ${oauthAccessToken}` },
    validateStatus: () => true,
  });

  const data = response.data;
  if (response.status >= 400 || !data?.access_token) {
    throw new Error(`getAccessToken failed (HTTP ${response.status})`);
  }
  return data;
}
