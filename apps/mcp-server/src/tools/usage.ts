import type { PulsDb } from '@puls/platform-core';
import { runWithInteractiveBudget } from '@puls/platform-core';
import { mcpToolCalls } from '@puls/db/schema';
import {
  findWriteReplay,
  saveWriteResult,
  extractToolPayload,
} from './idempotency.js';
import { getDb } from '../db.js';
import { recordShopToolCall } from '../redis-stats.js';
import { logger, serializeError } from '../logger.js';
import { Sentry } from '../sentry.js';

export type ToolTextContent = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function jsonText(value: unknown): { type: 'text'; text: string } {
  return { type: 'text', text: JSON.stringify(value) };
}

export function toolError(message: string): ToolTextContent {
  return {
    content: [jsonText({ error: message })],
    isError: true,
  };
}

export function toolOk(value: unknown): ToolTextContent {
  return {
    content: [jsonText(value)],
  };
}

async function persistToolCall(
  db: PulsDb,
  shopId: string,
  toolName: string,
  status: 'ok' | 'error',
  durationMs: number,
  args: Record<string, unknown>,
  errorMessage: string | null
): Promise<void> {
  try {
    await db.insert(mcpToolCalls).values({
      shopId,
      tool: toolName,
      status,
      durationMs,
      args,
      errorMessage,
    });
  } catch (err) {
    // Telemetry must never break a tool call.
    logger.error(
      { err: serializeError(err), shopId, tool: toolName },
      'mcp_tool_calls insert failed'
    );
    Sentry.captureException(err, {
      tags: { component: 'mcp_tool_calls_insert' },
      extra: { shopId, tool: toolName },
    });
  }
}

export async function withRequestLogging<T extends ToolTextContent>(
  shopId: string,
  toolName: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
  opts?: { dedup?: { db: PulsDb; args: Record<string, unknown> } }
): Promise<T> {
  const db = getDb();

  // Idempotence (jen write nástroje, opt-in přes opts.dedup): pokud stejný
  // fingerprint vstupu už proběhl v okně, vrať uložený výsledek místo dalšího
  // zápisu (ochrana před tichým dvojím zápisem po „connection lost" + retry).
  if (opts?.dedup) {
    const replay = await findWriteReplay(
      opts.dedup.db,
      shopId,
      toolName,
      opts.dedup.args
    );
    if (replay) {
      const res = toolOk({ ...replay, idempotent_replay: true }) as T;
      await Promise.all([
        recordShopToolCall(shopId, toolName, 'ok', {
          ...meta,
          idempotent_replay: true,
        }),
        persistToolCall(
          db,
          shopId,
          toolName,
          'ok',
          0,
          { ...meta, idempotent_replay: true },
          null
        ),
      ]);
      return res;
    }
  }

  const startedAt = Date.now();
  let result: T;
  try {
    // Interaktivní cesta: connector rate-limit backoff smí dohromady prospat
    // jen omezený čas, pak fail-fast (jinak bulk = N×30s backoff přeteče
    // idle-timeout MCP proxy → „connection lost"). Background sync rozpočet
    // nenastavuje, takže si tam trpělivé čekání zůstává.
    result = await runWithInteractiveBudget(fn);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const detail = err instanceof Error ? err.message : 'unknown error';
    await Promise.all([
      recordShopToolCall(shopId, toolName, 'error', { ...meta, detail }),
      persistToolCall(db, shopId, toolName, 'error', durationMs, meta, detail),
    ]);
    throw err;
  }
  const durationMs = Date.now() - startedAt;
  const status: 'ok' | 'error' = result.isError ? 'error' : 'ok';
  const errorMessage =
    status === 'error'
      ? extractErrorMessage(result)
      : null;
  await Promise.all([
    recordShopToolCall(shopId, toolName, status, meta),
    persistToolCall(db, shopId, toolName, status, durationMs, meta, errorMessage),
  ]);

  // Úspěšný zápis zacachuj pod fingerprint vstupu (best-effort) — retry stejné
  // operace v okně pak vrátí tento výsledek místo dalšího zápisu.
  if (opts?.dedup && status === 'ok') {
    const payload = extractToolPayload(result);
    if (payload) {
      await saveWriteResult(
        opts.dedup.db,
        shopId,
        toolName,
        opts.dedup.args,
        payload
      );
    }
  }

  return result;
}

/**
 * Wrapper pro WRITE nástroje: `withRequestLogging` + zapnutá idempotence
 * (auto-dedup podle fingerprintu vstupních `args`). Write nástroj místo
 * `withRequestLogging(shop.id, 'tool', meta, fn)` volá
 * `withWrite(shop.id, 'tool', args, meta, fn)`.
 */
export function withWrite<T extends ToolTextContent>(
  shopId: string,
  toolName: string,
  args: Record<string, unknown>,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  return withRequestLogging(shopId, toolName, meta, fn, {
    dedup: { db: getDb(), args },
  });
}

function extractErrorMessage(result: ToolTextContent): string | null {
  const first = result.content?.[0];
  if (!first || first.type !== 'text') return null;
  try {
    const parsed = JSON.parse(first.text) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // not JSON
  }
  return null;
}
