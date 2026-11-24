import { createHash } from 'node:crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { oauthAccessTokens } from '@puls/db/schema';
import type { PulsDb } from '@puls/platform-core';

export type AuthedToken = {
  type: 'oauth';
  userId: string;
  shopId: string;
  scope: string | null;
  disabledTools: string | null;
};

export type DevKey = {
  type: 'devkey';
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim() || null;
}

/**
 * Validate a Bearer token without requiring a specific shop. Used by the
 * generic /mcp endpoint that resolves the shop from the token itself.
 */
export async function validateBearer(
  db: PulsDb,
  bearer: string
): Promise<AuthedToken | null> {
  const tokenHash = hashToken(bearer);
  const now = new Date();

  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, tokenHash),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) return null;

  await db
    .update(oauthAccessTokens)
    .set({ lastUsedAt: now })
    .where(eq(oauthAccessTokens.id, row.id));

  return {
    type: 'oauth',
    userId: row.userId,
    shopId: row.shopId,
    scope: row.scope,
    disabledTools: row.disabledTools,
  };
}

/** Legacy: validate Bearer AND require it to be bound to a specific shop. */
export async function validateBearerForShop(
  db: PulsDb,
  bearer: string,
  shopId: string
): Promise<AuthedToken | null> {
  const authed = await validateBearer(db, bearer);
  if (!authed) return null;
  if (authed.shopId !== shopId) return null;
  return authed;
}

function publicOrigin(req: Request): string {
  const fromEnv = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ||
    (req.protocol ?? 'http');
  const host = req.headers.host ?? 'localhost:3001';
  return `${proto}://${host}`;
}

export function send401WithChallenge(
  req: Request,
  res: Response,
  error?: string,
  errorDescription?: string
): void {
  const resourceMetadata = `${publicOrigin(req)}/.well-known/oauth-protected-resource`;
  let wwwAuth = `Bearer resource_metadata="${resourceMetadata}"`;
  if (error) wwwAuth += `, error="${error}"`;
  if (errorDescription) wwwAuth += `, error_description="${errorDescription}"`;
  res.set('WWW-Authenticate', wwwAuth);
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: error ?? 'Unauthorized' },
    id: null,
  });
}

/**
 * Parse the `disabled_tools` CSV stored in the access token.
 *
 * Important: `null` means the token was issued **before** any opt-in
 * categories existed (legacy). For those tokens we must force-disable
 * `write` — the user never consented to mutating tools.
 *
 * An empty string `""` is the modern "nothing disabled" — it indicates the
 * consent UI was used and the user explicitly enabled every category.
 */
export function parseDisabledTools(csv: string | null | undefined): Set<string> {
  if (csv == null) {
    // Legacy token — strict opt-in for any mutating category.
    return new Set(['write']);
  }
  return new Set(
    csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}
