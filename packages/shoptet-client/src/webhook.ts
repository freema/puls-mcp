import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { NormalizedWebhook } from '@puls/platform-core';

export function verifyWebhookSignature(
  rawBody: Buffer,
  key: string,
  signature: string
): boolean {
  const expectedHex = createHmac('sha1', key).update(rawBody).digest('hex');
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const requiredWebhookFields = z.object({
  eshopId: z.union([z.number(), z.string()]).transform((v) => String(v)),
  event: z.string().min(1),
  eventCreated: z.string(),
  eventInstance: z.string().min(1),
});

/**
 * Validuje povinná Shoptet webhook pole a vrátí neutrální `NormalizedWebhook`
 * (kanonický `externalId` = String(eshopId)). Payload se vrací nezkrácený —
 * Zod jen validuje, vendor pole zůstávají kvůli persistenci.
 *
 * Behavior-preserving přesun z `apps/web/app/lib/webhook-payload.ts` za connector
 * (`shoptetConnector.webhook.parse`).
 */
export function parseShoptetWebhook(rawUtf8: string): NormalizedWebhook {
  let doc: unknown;
  try {
    doc = JSON.parse(rawUtf8);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (
    doc === null ||
    typeof doc !== 'object' ||
    Array.isArray(doc) ||
    Object.getPrototypeOf(doc) !== Object.prototype
  ) {
    return { ok: false, error: 'invalid_shape' };
  }
  const normalized = doc as Record<string, unknown>;
  const check = requiredWebhookFields.safeParse(normalized);
  if (!check.success) {
    return { ok: false, error: 'invalid_shape', issues: check.error.flatten() };
  }

  const { eshopId, event, eventInstance } = check.data;

  return {
    ok: true,
    value: {
      externalId: eshopId,
      event,
      eventInstance,
      payload: normalized,
    },
  };
}
