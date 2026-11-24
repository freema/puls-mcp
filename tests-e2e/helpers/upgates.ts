import { readFileSync } from 'node:fs';
import { sign as cryptoSign } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * E2E helper pro Upgates aktivační flow: sestaví a PODEPÍŠE payloady testovacím
 * privátním klíčem (fixture). Odpovídající veřejný klíč je nastavený v app přes
 * `UPGATES_SIGNATURE_PUBKEY` (docker-compose). Pořadí polí v podepsaných datech
 * MUSÍ přesně odpovídat tomu, jak je skládají handlery v `upgates-install.ts`.
 */
const PRIVATE_KEY = readFileSync(
  new URL('../fixtures/upgates-test-private.pem', import.meta.url),
  'utf8'
);

const SIGNATURE_TOKEN =
  process.env.UPGATES_SIGNATURE_TOKEN ?? 'puls-upgates-signature-token';

const MOCK_API_URL = 'http://mock-upgates:4011';

function signData(parts: Array<string | number>): string {
  const data = parts.map((p) => String(p)).join(';');
  return cryptoSign('RSA-SHA256', Buffer.from(data, 'utf8'), PRIVATE_KEY).toString(
    'base64'
  );
}

export type InstallPayload = {
  token: string;
  apiUser: string;
  apiKey: string;
  apiUrl: string;
  current_admin_language: string;
  time: number;
  signature_v2: string;
};

export function buildInstallPayload(args: {
  token: string;
  apiUser?: string;
  apiKey?: string;
  apiUrl?: string;
  lang?: string;
  time?: number;
}): InstallPayload {
  const apiUser = args.apiUser ?? 'mock-api-user';
  const apiKey = args.apiKey ?? 'mock-api-key';
  const apiUrl = args.apiUrl ?? MOCK_API_URL;
  const lang = args.lang ?? 'cs';
  const time = args.time ?? Date.now();
  const signature_v2 = signData([
    args.token,
    apiUser,
    apiKey,
    apiUrl,
    time,
    SIGNATURE_TOKEN,
  ]);
  return {
    token: args.token,
    apiUser,
    apiKey,
    apiUrl,
    current_admin_language: lang,
    time,
    signature_v2,
  };
}

export type LifecyclePayload = {
  token: string;
  current_admin_language?: string;
  version?: string;
  time: number;
  signature_v2: string;
};

/** Opening/uninstall/versioning podepisují `[token, time, signature_token]`. */
export function buildLifecyclePayload(args: {
  token: string;
  lang?: string;
  version?: string;
  time?: number;
}): LifecyclePayload {
  const time = args.time ?? Date.now();
  const signature_v2 = signData([args.token, time, SIGNATURE_TOKEN]);
  return {
    token: args.token,
    ...(args.lang ? { current_admin_language: args.lang } : {}),
    ...(args.version ? { version: args.version } : {}),
    time,
    signature_v2,
  };
}

/** Unikátní token eshopu pro test (= platform_account_id). */
export function uniqueUpgatesToken(prefix = 'upg'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function postInstall(
  request: APIRequestContext,
  payload: unknown
): Promise<APIResponse> {
  return request.post('/api/upgates/install', {
    data: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function postOpening(
  request: APIRequestContext,
  payload: unknown
): Promise<APIResponse> {
  return request.post('/api/upgates/opening', {
    data: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function postUninstall(
  request: APIRequestContext,
  payload: unknown
): Promise<APIResponse> {
  return request.post('/api/upgates/uninstall', {
    data: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function postVersioning(
  request: APIRequestContext,
  payload: unknown
): Promise<APIResponse> {
  return request.post('/api/upgates/versioning', {
    data: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });
}
