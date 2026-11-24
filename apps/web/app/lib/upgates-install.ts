import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PLATFORM, shops } from '@puls/db/schema';
import {
  buildSignatureData,
  buildUpgatesNormalizedShop,
  createUpgatesApiClient,
  createUpgatesClient,
  fetchOwner,
  getUpgatesPublicKey,
  isSignatureTimeFresh,
  registerWebhooks,
  unregisterWebhooks,
  verifyUpgatesSignature,
  type WebhookCategory,
} from '@puls/upgates-client';
import type { Env } from './config';
import type { DB } from './db';
import { persistInstall } from './install-core';
import { logger, serializeError } from './logger';

/** Datové kategorie, na které doplněk registruje webhooky (read capabilities). */
const WEBHOOK_CATEGORIES: WebhookCategory[] = [
  'orders',
  'products',
  'customers',
  'categories',
];

/** Aktivační callbacky vždy vrací HTTP 200 + `{error, message}` (Upgates kontrakt). */
export type UpgatesCallbackResult = { error: boolean; message: string };

const installSchema = z.object({
  token: z.string().min(1),
  apiUser: z.string().min(1),
  apiKey: z.string().min(1),
  apiUrl: z.string().url(),
  current_admin_language: z.string().optional(),
  time: z.union([z.string(), z.number()]),
  signature_v2: z.string().min(1),
});

const lifecycleSchema = z.object({
  token: z.string().min(1),
  version: z.union([z.string(), z.number()]).optional(),
  current_admin_language: z.string().optional(),
  time: z.union([z.string(), z.number()]),
  signature_v2: z.string().min(1),
});

/** Upgates posílá cs/sk/en; náš embed i18n umí cs/sk/hu/en (fallback cs). */
const EMBED_LANGS = new Set(['cs', 'sk', 'hu', 'en']);
function mapAdminLanguage(lang: string | undefined): string {
  const normalized = lang?.trim().toLowerCase() ?? '';
  return EMBED_LANGS.has(normalized) ? normalized : 'cs';
}

/** Ověří `time` (TTL) + `signature_v2` nad daty složenými v daném pořadí. */
async function verifySignedCallback(
  signatureParts: Array<string | number>,
  time: string | number,
  signatureV2: string
): Promise<boolean> {
  if (!isSignatureTimeFresh(time, Date.now())) return false;
  const pubKey = await getUpgatesPublicKey();
  const data = buildSignatureData(signatureParts);
  return verifyUpgatesSignature(data, signatureV2, pubKey);
}

function callbackUrl(env: Env): string {
  const origin = (env.WEB_PUBLIC_ORIGIN ?? 'https://pulsmcp.com').replace(
    /\/$/,
    ''
  );
  return `${origin}/api/webhooks/upgates`;
}

/** Načte aktivní Upgates shop podle tokenu (= platform_account_id). */
async function loadUpgatesShop(db: DB, token: string) {
  const [shop] = await db
    .select()
    .from(shops)
    .where(
      and(eq(shops.platform, PLATFORM.UPGATES), eq(shops.platformAccountId, token))
    )
    .limit(1);
  return shop ?? null;
}

/**
 * Installation endpoint logika: ověří podpis, spáruje majitele přes `/owner`,
 * uloží (šifrované) credentials přes sdílený `persistInstall` a zaregistruje
 * datové webhooky. Idempotentní na opakovanou aktivaci (žádný druhý trial,
 * žádné duplicitní webhooky).
 */
export async function handleUpgatesInstall(
  db: DB,
  env: Env,
  raw: unknown
): Promise<UpgatesCallbackResult> {
  const parsed = installSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: true, message: 'Neplatný payload aktivace' };
  }
  const p = parsed.data;

  const signatureToken = env.UPGATES_SIGNATURE_TOKEN;
  const ok = await verifySignedCallback(
    [p.token, p.apiUser, p.apiKey, p.apiUrl, p.time, signatureToken],
    p.time,
    p.signature_v2
  );
  if (!ok) {
    return { error: true, message: 'Neplatný podpis aktivace' };
  }

  // Klient z plaintext credentials (shop ještě nepersistován) → /owner párování.
  const client = createUpgatesClient({
    apiBaseUrl: p.apiUrl,
    apiUser: p.apiUser,
    apiKey: p.apiKey,
  });
  const owner = await fetchOwner(client);

  const webhookSecret = `upg_wh_${randomBytes(24).toString('hex')}`;
  const normalized = buildUpgatesNormalizedShop({
    token: p.token,
    apiUser: p.apiUser,
    apiKey: p.apiKey,
    apiUrl: p.apiUrl,
    name: owner.name,
    adminEmail: owner.email,
    webhookSecret,
  });

  const persisted = await persistInstall(db, normalized);

  // Registruj webhooky s EFEKTIVNĚ uloženým secretem (re-aktivace → původní klíč).
  const effectiveSecret = persisted.webhookSignatureKey ?? webhookSecret;
  try {
    await registerWebhooks(
      client,
      {
        callbackUrl: callbackUrl(env),
        secret: effectiveSecret,
        categories: WEBHOOK_CATEGORIES,
      },
      (msg, meta) => logger.warn(meta ?? {}, msg)
    );
  } catch (err) {
    // Registrace webhooků není blokující pro aktivaci — zaloguj a pokračuj.
    logger.warn({ err: serializeError(err) }, 'upgates webhook register failed');
  }

  logger.info(
    { shopId: persisted.shopId, isNew: persisted.isNew, token: p.token },
    'upgates install ok'
  );
  return { error: false, message: 'Aktivace proběhla úspěšně' };
}

const openingSchema = z.object({
  token: z.string().min(1),
  current_admin_language: z.string().optional(),
  version: z.union([z.string(), z.number()]).optional(),
  time: z.union([z.string(), z.number()]),
  signature_v2: z.string().min(1),
});

export type UpgatesOpeningResult =
  | { error: false; url: string; type: 'iframe' }
  | { error: true; message: string };

/**
 * Opening endpoint logika: ověří podpis a vrátí URL aktivačního iframu (HTTPS).
 * `origin` je veřejný origin requestu — iframe žije na našem webu, ne na Upgates.
 */
export async function handleUpgatesOpening(
  env: Env,
  raw: unknown,
  origin: string
): Promise<UpgatesOpeningResult> {
  const parsed = openingSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: true, message: 'Neplatný payload' };
  }
  const p = parsed.data;

  const ok = await verifySignedCallback(
    [p.token, p.time, env.UPGATES_SIGNATURE_TOKEN],
    p.time,
    p.signature_v2
  );
  if (!ok) {
    return { error: true, message: 'Neplatný podpis' };
  }

  const lang = mapAdminLanguage(p.current_admin_language);
  const base = origin.replace(/\/$/, '');
  const url = `${base}/embed/upgates/${encodeURIComponent(p.token)}?lang=${lang}`;
  return { error: false, url, type: 'iframe' };
}

/**
 * Uninstall: ověří podpis, označí shop UNINSTALLED, zneplatní credentials a
 * odregistruje webhooky. `tier_assignments` zůstává (anti-freeride přežívá
 * uninstall — re-aktivace nedá druhý trial).
 */
export async function handleUpgatesUninstall(
  db: DB,
  env: Env,
  raw: unknown
): Promise<UpgatesCallbackResult> {
  const parsed = lifecycleSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: true, message: 'Neplatný payload' };
  }
  const p = parsed.data;

  const ok = await verifySignedCallback(
    [p.token, p.time, env.UPGATES_SIGNATURE_TOKEN],
    p.time,
    p.signature_v2
  );
  if (!ok) {
    return { error: true, message: 'Neplatný podpis' };
  }

  const shop = await loadUpgatesShop(db, p.token);
  if (!shop) {
    // Nic k úklidu — idempotentní.
    return { error: false, message: 'Shop neexistuje' };
  }

  // Odregistruj webhooky, dokud máme platné credentials (best-effort).
  if (shop.platformApiLogin && shop.platformApiKey) {
    try {
      const client = createUpgatesApiClient(shop);
      await unregisterWebhooks(client, callbackUrl(env), (msg, meta) =>
        logger.warn(meta ?? {}, msg)
      );
    } catch (err) {
      logger.warn(
        { err: serializeError(err) },
        'upgates webhook unregister failed'
      );
    }
  }

  await db
    .update(shops)
    .set({
      status: 'UNINSTALLED',
      uninstalledAt: new Date(),
      // Zneplatni credentials — žádný další API přístup po deaktivaci.
      platformApiKey: null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  logger.info({ shopId: shop.id, token: p.token }, 'upgates uninstall ok');
  return { error: false, message: 'Doplněk deaktivován' };
}

/**
 * Versioning: ověří podpis a idempotentně re-registruje webhooky dle nové verze
 * doplňku. Vrací konfiguraci verze (zatím jen potvrzení).
 */
export async function handleUpgatesVersioning(
  db: DB,
  env: Env,
  raw: unknown
): Promise<UpgatesCallbackResult & { version?: string }> {
  const parsed = lifecycleSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: true, message: 'Neplatný payload' };
  }
  const p = parsed.data;

  const ok = await verifySignedCallback(
    [p.token, p.time, env.UPGATES_SIGNATURE_TOKEN],
    p.time,
    p.signature_v2
  );
  if (!ok) {
    return { error: true, message: 'Neplatný podpis' };
  }

  const shop = await loadUpgatesShop(db, p.token);
  if (!shop) {
    return { error: true, message: 'Shop neexistuje' };
  }

  if (shop.platformApiLogin && shop.platformApiKey && shop.webhookSignatureKey) {
    try {
      const client = createUpgatesApiClient(shop);
      await registerWebhooks(
        client,
        {
          callbackUrl: callbackUrl(env),
          secret: shop.webhookSignatureKey,
          categories: WEBHOOK_CATEGORIES,
        },
        (msg, meta) => logger.warn(meta ?? {}, msg)
      );
    } catch (err) {
      logger.warn(
        { err: serializeError(err) },
        'upgates versioning webhook re-register failed'
      );
    }
  }

  logger.info(
    { shopId: shop.id, token: p.token, version: String(p.version ?? '') },
    'upgates versioning ok'
  );
  return {
    error: false,
    message: 'Verze zpracována',
    version: p.version != null ? String(p.version) : undefined,
  };
}
