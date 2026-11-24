import { createHash } from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { PulsDb } from '@puls/platform-core';
import { writeIdempotency } from '@puls/db/schema';
import { logger, serializeError } from '../logger.js';
import { Sentry } from '../sentry.js';
import type { ToolTextContent } from './usage.js';

/**
 * Idempotence write nástrojů (auto-dedup, fingerprint + časové okno).
 *
 * Motivace: když MCP proxy nahlásí „connection lost" PO tom, co se zápis reálně
 * provedl, LLM klient logicky retryuje stejnou operaci → tichý dvojí zápis (u
 * cen/skladu reálná škoda). Řešení: server si pamatuje výsledek podle
 * fingerprintu VSTUPU tool callu a v okně vrací uložený výsledek místo dalšího
 * zápisu. Fingerprint je schválně nad VSTUPNÍMI args (ne resolved hodnotami),
 * aby retry relativní operace (`adjustPercent`) měl stejný klíč jako originál.
 *
 * Okno (ne trvalá dedup): záměrný rychlý repeat stejné operace by se v okně
 * spolkl — to je vědomý trade-off (priorita: ochrana před tichým dvojím
 * zápisem). Po expiraci okna se stejný klíč zacachuje nově (UPSERT).
 */
export const IDEMPOTENCY_WINDOW_MS = 5 * 60_000;

/** Pole, která se z args VYNECHAJÍ z fingerprintu (nemění logickou identitu zápisu). */
const VOLATILE_ARG_KEYS = new Set(['confirm', 'idempotency_key']);

/** Deterministický JSON s rekurzivně seřazenými klíči (stabilní fingerprint). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** SHA-256 fingerprint nad (shopId, tool, kanonické args bez volatilních polí). */
export function writeFingerprint(
  shopId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  const stable: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!VOLATILE_ARG_KEYS.has(k)) stable[k] = v;
  }
  const canonical = stableStringify({ shopId, tool, args: stable });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Vrátí uložený payload úspěšného zápisu, pokud existuje stejný fingerprint v
 * okně — jinak `null`. Chyba dedup nikdy neshodí zápis (vrací `null` → zapíše se
 * normálně, max hrozí to, co bez idempotence dnes).
 */
export async function findWriteReplay(
  db: PulsDb,
  shopId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const key = writeFingerprint(shopId, tool, args);
  const cutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  try {
    const [row] = await db
      .select({ result: writeIdempotency.result })
      .from(writeIdempotency)
      .where(
        and(
          eq(writeIdempotency.shopId, shopId),
          eq(writeIdempotency.idempotencyKey, key),
          gt(writeIdempotency.createdAt, cutoff)
        )
      )
      .orderBy(desc(writeIdempotency.createdAt))
      .limit(1);
    return (row?.result as Record<string, unknown> | undefined) ?? null;
  } catch (err) {
    logger.error(
      { err: serializeError(err), shopId, tool },
      'write idempotency lookup failed'
    );
    Sentry.captureException(err, {
      tags: { component: 'write_idempotency_lookup' },
      extra: { shopId, tool },
    });
    return null;
  }
}

/**
 * Uloží (UPSERT) payload úspěšného zápisu pod fingerprint vstupu. Best-effort —
 * selhání cache nikdy neshodí už provedený zápis.
 */
export async function saveWriteResult(
  db: PulsDb,
  shopId: string,
  tool: string,
  args: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<void> {
  const key = writeFingerprint(shopId, tool, args);
  try {
    await db
      .insert(writeIdempotency)
      .values({ shopId, idempotencyKey: key, tool, result: payload })
      .onConflictDoUpdate({
        target: [writeIdempotency.shopId, writeIdempotency.idempotencyKey],
        set: { result: payload, createdAt: new Date() },
      });
  } catch (err) {
    logger.error(
      { err: serializeError(err), shopId, tool },
      'write idempotency save failed'
    );
    Sentry.captureException(err, {
      tags: { component: 'write_idempotency_save' },
      extra: { shopId, tool },
    });
  }
}

/** Vytáhne JSON payload z úspěšného ToolTextContent (pro uložení do cache). */
export function extractToolPayload(
  result: ToolTextContent
): Record<string, unknown> | null {
  const first = result.content?.[0];
  if (!first || first.type !== 'text') return null;
  try {
    const parsed = JSON.parse(first.text) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
