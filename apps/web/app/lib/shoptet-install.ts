import { PLATFORM } from '@puls/db/schema';
import type { Env } from './config';
import type { DB } from './db';
import { persistInstall } from './install-core';
import { getConnector } from './connector.server';

export type InstallResult = {
  shopId: string;
  durationMs: number;
  /** 'install' = první trial, 'reinstall_no_trial' = re-instalace, trial nelze získat znovu. */
  tierAssignment?: { tierId: string; reason: string };
};

/**
 * Shoptet install handler. Vlastní OAuth handshake + identitu shopu řeší
 * `shoptetConnector.install` (přes connector registry); tady už jen mapujeme
 * normalizovaný výstup na upsert do `shops` + tier přiřazení.
 */
export async function handleInstall(
  db: DB,
  env: Env,
  code: string | null
): Promise<InstallResult> {
  const started = performance.now();
  if (!code?.trim()) {
    throw new Error('Missing ?code=');
  }

  if (
    !env.SHOPTET_API_BASE_URL ||
    !env.SHOPTET_CLIENT_ID ||
    !env.SHOPTET_CLIENT_SECRET ||
    !env.SHOPTET_REDIRECT_URI
  ) {
    throw new Error(
      'Shoptet install is not configured (SHOPTET_API_BASE_URL / SHOPTET_CLIENT_ID / SHOPTET_CLIENT_SECRET / SHOPTET_REDIRECT_URI)'
    );
  }

  const base = env.SHOPTET_API_BASE_URL.replace(/\/$/, '');
  const connector = getConnector(PLATFORM.SHOPTET);
  const normalized = await connector.install({
    code: code.trim(),
    oauth: {
      tokenUrl: `${base}/oauth/token`,
      clientId: env.SHOPTET_CLIENT_ID,
      clientSecret: env.SHOPTET_CLIENT_SECRET,
      redirectUri: env.SHOPTET_REDIRECT_URI,
    },
    apiBaseUrl: base,
  });

  const persisted = await persistInstall(db, normalized);

  return {
    shopId: persisted.shopId,
    durationMs: performance.now() - started,
    tierAssignment: persisted.tierAssignment,
  };
}
