import { timingSafeEqual } from 'node:crypto';
import type { NormalizedWebhook } from '@puls/platform-core';

/**
 * Datový webhook Upgates: hlavní webhook dokumentace NEUVÁDÍ podpis (na rozdíl
 * od aktivačních callbacků se `signature_v2`). Bezpečný default = per-shop
 * secret (uložený při registraci webhooku), porovnaný v konstantním čase.
 * TODO `[O]`: ověřit reálný mechanismus u Upgates.
 *
 * Signatura kopíruje `PlatformConnector.webhook.verify(rawBody, key, signature)`;
 * `rawBody` se zatím nepoužívá (drží se kvůli rozhraní + případnému přechodu na
 * HMAC, až bude ověřeno).
 */
export function verifyUpgatesWebhook(
  _rawBody: Buffer,
  key: string,
  signature: string
): boolean {
  if (!key || !signature) return false;
  const a = Buffer.from(key, 'utf8');
  const b = Buffer.from(signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Normalizovaný tvar Upgates datového webhooku (seznam ID, ne plná data). */
export interface ParsedUpgatesWebhook {
  /** Jméno/identifikátor eshopu z payloadu → lookup shopu přes (platform, external_id). */
  externalId: string;
  /** Event kategorie (orders/products/customers…) odvozená z klíče se seznamem ID. */
  event: string;
  /** Seznam ID dotčených entit — follow-up fetch dělá sync worker (task 04). */
  ids: string[];
  /** Syrový payload pro audit. */
  payload: unknown;
}

/**
 * Zparsuje Upgates datový webhook: POST se SEZNAMEM ID entit + jméno eshopu.
 * Upgates NEMÁ `eventInstance` — idempotency klíč si volí volající
 * (např. `hash(event + ids.join(','))`). Defenzivní: bere první klíč, který nese
 * pole hodnot, jako event + jeho ID.
 */
export function parseUpgatesWebhook(raw: unknown): ParsedUpgatesWebhook {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid Upgates webhook payload');
  }
  const body = raw as Record<string, unknown>;
  const externalId = typeof body.eshop === 'string' ? body.eshop : '';
  let event = '';
  let ids: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === 'eshop') continue;
    if (Array.isArray(value)) {
      event = key;
      ids = value.map((x) => String(x));
      break;
    }
  }
  return { externalId, event, ids, payload: raw };
}

/**
 * Connector-úrovňový parse na neutrální `NormalizedWebhook` (interface
 * `PlatformConnector.webhook.parse`). Upgates NEMÁ `eventInstance` —
 * neutrální `eventInstance` odvodíme z `event:ids` (shop-agnostic). Webhook route
 * (`api.webhooks.upgates.tsx`) drží vlastní shop-scoped idempotency klíč, protože
 * Upgates ID jsou per-eshop.
 */
export function parseUpgatesNormalized(rawUtf8: string): NormalizedWebhook {
  let doc: unknown;
  try {
    doc = JSON.parse(rawUtf8);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, error: 'invalid_shape' };
  }
  const { externalId, event, ids } = parseUpgatesWebhook(doc);
  if (!externalId || !event) {
    return { ok: false, error: 'invalid_shape' };
  }
  return {
    ok: true,
    value: {
      externalId,
      event,
      eventInstance: `${event}:${ids.join(',')}`,
      payload: doc as Record<string, unknown>,
    },
  };
}
