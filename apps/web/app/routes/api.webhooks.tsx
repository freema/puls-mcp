import { and, eq } from 'drizzle-orm';
import { PLATFORM, shops, webhookNotifications } from '@puls/db/schema';
import type { Route } from './+types/api.webhooks';
import { getDb } from '~/lib/db';
import { getConnector } from '~/lib/connector.server';

/**
 * Per-platform webhook signature header. Shoptet posílá `Shoptet-Webhook-Signature`
 * (HMAC-SHA1); neutrální `X-Webhook-Signature` zůstává jako fallback.
 */
const SIGNATURE_HEADERS = ['Shoptet-Webhook-Signature', 'X-Webhook-Signature'];

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const signature = SIGNATURE_HEADERS.map((h) => request.headers.get(h)).find(
    (v) => v?.trim()
  );
  if (!signature?.trim()) {
    return Response.json({ error: 'missing signature' }, { status: 401 });
  }

  const raw = Buffer.from(await request.arrayBuffer());

  const db = getDb();

  // Tahle routa přijímá webhooky ve tvaru `{ eshopId, event, eventInstance }`
  // (Shoptet). Upgates má vlastní routu `api/webhooks/upgates`. Identitu eshopu
  // vytáhneme z payloadu, connector pro parse/verify pak bereme ze `shop.platform`.
  let externalId: string;
  try {
    const body = JSON.parse(raw.toString('utf8')) as { eshopId?: unknown };
    if (body.eshopId == null) {
      return Response.json({ error: 'invalid payload' }, { status: 400 });
    }
    externalId = String(body.eshopId);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const [shop] = await db
    .select({
      id: shops.id,
      platform: shops.platform,
      webhookSignatureKey: shops.webhookSignatureKey,
    })
    .from(shops)
    .where(
      and(
        eq(shops.platform, PLATFORM.SHOPTET),
        eq(shops.platformAccountId, externalId)
      )
    )
    .limit(1);

  if (!shop?.webhookSignatureKey) {
    return Response.json({ error: 'unknown shop' }, { status: 401 });
  }

  // Neutrální parse + verify přes connector dle platformy shopu —
  // vrací NormalizedWebhook s `externalId` = String(eshopId).
  const connector = getConnector(shop.platform);
  const parsed = connector.webhook.parse(raw.toString('utf8'));
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.error === 'invalid_json' ? 'invalid json' : 'invalid payload',
      },
      { status: 400 }
    );
  }

  const { payload, event, eventInstance } = parsed.value;

  const ok = connector.webhook.verify(raw, shop.webhookSignatureKey, signature);
  if (!ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  await db
    .insert(webhookNotifications)
    .values({
      shopId: shop.id,
      platform: shop.platform,
      event,
      eventInstance,
      payload,
      processed: false,
    })
    .onConflictDoNothing({
      target: [
        webhookNotifications.platform,
        webhookNotifications.event,
        webhookNotifications.eventInstance,
      ],
    });

  return Response.json({ ok: true }, { status: 200 });
}
