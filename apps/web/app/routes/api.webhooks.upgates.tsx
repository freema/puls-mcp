import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { PLATFORM, shops, webhookNotifications } from '@puls/db/schema';
import type { Route } from './+types/api.webhooks.upgates';
import { getDb } from '~/lib/db';
import { getConnector } from '~/lib/connector.server';
import { parseUpgatesWebhookPayload } from '~/lib/upgates-webhook-payload';

/** Per-shop secret prezentovaný v hlavičce (default dle task 02 sekce 5.2). */
const SECRET_HEADER = 'X-Upgates-Webhook-Secret';

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const presentedSecret = request.headers.get(SECRET_HEADER);
  if (!presentedSecret?.trim()) {
    return Response.json({ error: 'missing secret' }, { status: 401 });
  }

  const raw = Buffer.from(await request.arrayBuffer());
  const parsed = parseUpgatesWebhookPayload(raw.toString('utf8'));
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.error === 'invalid_json' ? 'invalid json' : 'invalid payload',
      },
      { status: 400 }
    );
  }

  const { eshop, event, ids, payload } = parsed.value;
  const db = getDb();

  const [shop] = await db
    .select({
      id: shops.id,
      webhookSignatureKey: shops.webhookSignatureKey,
    })
    .from(shops)
    .where(
      and(
        eq(shops.platform, PLATFORM.UPGATES),
        eq(shops.platformAccountId, eshop)
      )
    )
    .limit(1);

  if (!shop?.webhookSignatureKey) {
    return Response.json({ error: 'unknown shop' }, { status: 401 });
  }

  const connector = getConnector(PLATFORM.UPGATES);
  const ok = connector.webhook.verify(
    raw,
    shop.webhookSignatureKey,
    presentedSecret
  );
  if (!ok) {
    return Response.json({ error: 'invalid secret' }, { status: 401 });
  }

  // Upgates payload nemá `eventInstance` jako Shoptet → idempotency klíč
  // odvodíme deterministicky z (shop + event + seznam ID). Shop MUSÍ být v klíči:
  // Upgates ID jsou per-eshop (objednávka 101 shopu A ≠ 101 shopu B), takže bez
  // něj by druhý shop se stejným event+ids kolidoval na unique (platform,event,
  // event_instance) a jeho webhook by se tiše zahodil (cross-shop ztráta dat).
  const eventInstance = createHash('sha1')
    .update(`${shop.id}:${event}:${ids.join(',')}`)
    .digest('hex');

  await db
    .insert(webhookNotifications)
    .values({
      shopId: shop.id,
      platform: PLATFORM.UPGATES,
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
