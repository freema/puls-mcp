# Shoptet webhooks

Náš endpoint přijímá webhook notifikace od Shoptetu (např. `order:create`), validuje HMAC podpis, a zapisuje do idempotency tabulky.

Code: [`apps/web/app/routes/api.webhooks.tsx`](../../apps/web/app/routes/api.webhooks.tsx), HMAC verify [`packages/shoptet-client/src/webhook.ts`](../../packages/shoptet-client/src/webhook.ts), parser [`packages/shoptet-client/src/webhook.ts`](../../packages/shoptet-client/src/webhook.ts).

## Endpoint

`POST /api/webhooks`

Headers:
- `Content-Type: application/json`
- `Shoptet-Webhook-Signature: <hex_hmac_sha1>` — HMAC-SHA1 z **raw body** s klíčem `shops.webhook_signature_key`.

## Sekvence

```
Shoptet                                Puls (apps/web)
  │ POST /api/webhooks                 │
  │ Headers: Shoptet-Webhook-Signature │
  │ Body: { eshopId, event, eventCreated, eventInstance, ... }
  │ ─────────────────────────────────► │
  │                                    │ 1. signature header present? else 401
  │                                    │ 2. parseShoptetWebhook(rawUtf8)
  │                                    │    - JSON parse, must be plain object
  │                                    │    - Zod check: eshopId, event,
  │                                    │      eventCreated, eventInstance
  │                                    │ 3. SELECT shops WHERE eshop_id = <eshopId>
  │                                    │    if missing → 401 "unknown shop"
  │                                    │ 4. verifyWebhookSignature(rawBuffer,
  │                                    │      webhook_signature_key, headerSig)
  │                                    │    HMAC-SHA1, timing-safe compare
  │                                    │    if mismatch → 401 "invalid signature"
  │                                    │ 5. INSERT webhook_notifications
  │                                    │    UNIQUE (event, event_instance)
  │                                    │    ON CONFLICT DO NOTHING (idempotency)
  │ ◄── 200 { ok: true }               │
```

**Limit: 4 sekundy** total — Shoptet retry (3× s 15min intervalem) pokud nedostane 200.

## Validace

### Shoptet-Webhook-Signature
- Hex string HMAC-SHA1 z raw body s klíčem `shops.webhook_signature_key` (32B random hex per shop, vygenerovaný při installu).
- Pokud chybí nebo je prázdný → **401** `{ "error": "missing signature" }`.

### Body parse
[`parseShoptetWebhook`](../../packages/shoptet-client/src/webhook.ts):
1. JSON parse → pokud fail → **400** `{ "error": "invalid json" }`.
2. Musí být plain object (ne array, ne null, ne instance) → jinak **400** `{ "error": "invalid payload" }`.
3. Zod check pro `{ eshopId: number|string, event: string, eventCreated: string, eventInstance: string }` — `eshopId` se autoconvertne na číslo. Pokud fail → **400** `{ "error": "invalid payload" }`.

### Shop lookup
- `SELECT shop FROM shops WHERE eshop_id = <eshopId>` — pokud row neexistuje (např. webhook pro shop, který není v naší DB), **401** `{ "error": "unknown shop" }`.
- Pokud `shop.webhookSignatureKey` chybí (nemělo by se stát po novém schemam, ale defenzivně) → také 401.

### HMAC verify
[`verifyWebhookSignature`](../../packages/shoptet-client/src/webhook.ts):
```ts
expectedHex = createHmac('sha1', shop.webhookSignatureKey).update(rawBody).digest('hex')
return timingSafeEqual(expectedHex, headerSignature)  // timing-safe to prevent side-channel
```
Pokud mismatch → **401** `{ "error": "invalid signature" }`.

## Idempotency

```sql
INSERT INTO webhook_notifications (shop_id, event, event_instance, payload, processed)
VALUES (...)
ON CONFLICT (event, event_instance) DO NOTHING;
```

`UNIQUE (event, event_instance)` znamená, že duplicitní notifikace (stejný `event` + `eventInstance`, např. retry) se zahodí silently. Vrátíme **200 OK** v obou případech (Shoptet by jinak retryoval).

## Vždy 200 OK

Po úspěšné HMAC validaci a (no-op nebo new) INSERT vrátíme `{ "ok": true }` HTTP 200. **Async processing** (např. trigger background job) by se dělal po response — dnes je tam jen INSERT, žádné post-processing. Když to bude potřeba, přidat BullMQ enqueue.

## Co dělat s webhookem dál

Dnes: **nic** kromě záznamu. Webhook payloady se ukládají, ale `processed = false` zůstává — žádný worker je nezpracovává.

Plán: až bude **delta sync** plně implementovaný:
- `order:create`, `order:update` → invalidate Redis cache pro daný shop
- `addon:uninstall` → `UPDATE shops SET status='UNINSTALLED', uninstalled_at=now()`
- `customer:*`, `product:*` → další triggery

## Admin UI

`/admin/webhooks` ([`admin.webhooks._index.tsx`](../../apps/web/app/routes/admin.webhooks._index.tsx)) ukazuje posledních 250 webhook rows s filtry:
- `?shop=<id>` — per shop
- `?event=<name>` — per event type
- `?state=ok|pending|error` — `processed` + `error` flag

Slouží k debugu (kontrola, že jsme dostali konkrétní notifikaci) a auditu.

## Test

[`tests-e2e/tests/webhook.spec.ts`](../../tests-e2e/tests/webhook.spec.ts) — pošle webhook s validním HMAC a kontroluje, že vznikl `webhook_notifications` row. Helper [`tests-e2e/helpers/hmac.ts`](../../tests-e2e/helpers/hmac.ts) podepisuje payload pro test.

## Common gotchas

- **Raw body must be untouched** — express middleware `express.raw({ type: 'application/json' })` musí být **před** json parserem. V React Router (Remix-like) to řeší `await request.arrayBuffer()` v actionu (před `json()`).
- **Trim signature** — header může mít trailing whitespace; `signature.trim()` před HMAC check.
- **Response timing** — INSERT je rychlý (~5-10ms), HMAC compute pár ms, total < 50ms na slušném HW. 4s limit je pohodlný.
