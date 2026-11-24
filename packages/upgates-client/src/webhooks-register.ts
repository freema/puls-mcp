import type { AxiosInstance } from 'axios';
import { upgatesRequest } from './http.js';

const WEBHOOKS_PATH = '/api/v2/webhooks';

/** Kategorie dat, na jejichž změny chceme webhook. Mapuje na connector capabilities. */
export type WebhookCategory = 'orders' | 'products' | 'customers' | 'categories';

export interface RegisterWebhooksInput {
  callbackUrl: string;
  /** Per-shop secret posílaný zpět Upgatesem v hlavičce `X-Upgates-Webhook-Secret`. */
  secret: string;
  categories: WebhookCategory[];
}

interface ExistingWebhook {
  event?: string;
  url?: string;
}

/** GET pre-check existujících webhooků (idempotence — reinstall neduplikuje). */
async function listExisting(client: AxiosInstance): Promise<ExistingWebhook[]> {
  try {
    const res = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: WEBHOOKS_PATH,
    });
    if (res.status >= 400 || res.data == null) return [];
    const body = res.data as { webhooks?: ExistingWebhook[] } | undefined;
    return Array.isArray(body?.webhooks) ? body.webhooks : [];
  } catch {
    return [];
  }
}

/**
 * Idempotentní registrace datových webhooků: pro každou kategorii, která ještě
 * nemá náš callback, POSTne registraci. Selhání jednotlivé registrace neshodí
 * install — jen se zaloguje (webhook scope může chybět dle oprávnění `apiKey`,
 * `[O]` ověřit na demo eshopu).
 */
export async function registerWebhooks(
  client: AxiosInstance,
  input: RegisterWebhooksInput,
  log: (msg: string, meta?: Record<string, unknown>) => void = () => {}
): Promise<{ registered: WebhookCategory[] }> {
  const existing = await listExisting(client);
  const existingEvents = new Set(
    existing
      .filter((w) => w.url === input.callbackUrl)
      .map((w) => w.event)
      .filter((e): e is string => typeof e === 'string')
  );

  const registered: WebhookCategory[] = [];
  for (const category of input.categories) {
    if (existingEvents.has(category)) continue;
    try {
      const res = await upgatesRequest(client, {
        method: 'POST',
        url: WEBHOOKS_PATH,
        data: {
          event: category,
          url: input.callbackUrl,
          secret: input.secret,
        },
      });
      if (res.status < 400) {
        registered.push(category);
      } else {
        log('upgates webhook register failed', {
          category,
          status: res.status,
        });
      }
    } catch (err) {
      log('upgates webhook register error', {
        category,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { registered };
}

/**
 * Odregistrace všech našich webhooků (uninstall). Best-effort — selhání se
 * loguje, ale uninstall na něm nestojí (credentials se stejně zneplatní).
 */
export async function unregisterWebhooks(
  client: AxiosInstance,
  callbackUrl: string,
  log: (msg: string, meta?: Record<string, unknown>) => void = () => {}
): Promise<void> {
  const existing = await listExisting(client);
  const ours = existing.filter((w) => w.url === callbackUrl && w.event);
  for (const w of ours) {
    try {
      await upgatesRequest(client, {
        method: 'DELETE',
        url: `${WEBHOOKS_PATH}/${encodeURIComponent(w.event!)}`,
      });
    } catch (err) {
      log('upgates webhook unregister error', {
        event: w.event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
