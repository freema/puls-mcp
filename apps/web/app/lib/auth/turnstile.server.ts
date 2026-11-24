import { getConfig } from '~/lib/config';
import { logger } from '~/lib/logger';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Je Turnstile nakonfigurovaný (máme secret key)? Když ne, captcha se přeskakuje. */
export function turnstileConfigured(): boolean {
  return Boolean(getConfig().TURNSTILE_SECRET_KEY?.trim());
}

/** Veřejný site key pro frontend widget (nebo null, když není nastavený). */
export function turnstileSiteKey(): string | null {
  return getConfig().TURNSTILE_SITE_KEY?.trim() || null;
}

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
  hostname?: string;
}

/**
 * Ověř Turnstile token na serveru (Cloudflare siteverify).
 *
 * - Když TURNSTILE_SECRET_KEY není nastavený → přeskočí (vrací ok), aby dev/E2E
 *   nepadaly. V produkci to hlasitě zaloguje warning.
 * - Když je nakonfigurovaný a token chybí / je neplatný / siteverify selže
 *   (síť) → fail-CLOSED (ok:false), captcha je primární obrana proti botům.
 */
export async function verifyTurnstile(
  token: string | null,
  remoteIp?: string
): Promise<{ ok: boolean }> {
  const secret = getConfig().TURNSTILE_SECRET_KEY?.trim();

  if (!secret) {
    if (getConfig().NODE_ENV === 'production') {
      logger.warn(
        '[turnstile] TURNSTILE_SECRET_KEY není nastavený — CAPTCHA se v PRODUKCI přeskakuje!'
      );
    }
    return { ok: true };
  }

  if (!token) return { ok: false };

  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    if (remoteIp) body.set('remoteip', remoteIp);

    const resp = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });

    const data = (await resp.json()) as SiteverifyResponse;
    if (!data.success) {
      logger.warn(
        { errors: data['error-codes'] },
        '[turnstile] ověření tokenu selhalo'
      );
    }
    return { ok: Boolean(data.success) };
  } catch (err) {
    logger.error({ err }, '[turnstile] siteverify request error');
    return { ok: false }; // fail-closed
  }
}
