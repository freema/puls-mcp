import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Interactive request budget — cross-cutting kontext pro „kolik smí jeden
 * interaktivní MCP tool call celkem PROČEKAT na rate-limit backoffu, než to
 * fail-fast vzdá".
 *
 * Proč: connector HTTP klienty (Upgates) mají proaktivní rate-limit backoff
 * (sleep, když pool tokenů klesne pod práh). Pro background sync worker je
 * trpělivé čekání správné. Ale interaktivní MCP tool call drží otevřené HTTP
 * spojení na Anthropic proxy — když nastřádá několik backoffů (bulk = N
 * requestů × backoff), překročí idle-timeout proxy a uživatel dostane
 * „MCP server connection lost". Proto interaktivní cesta dostane STROP na
 * kumulativní čekání a po jeho vyčerpání selže rychle s jasnou hláškou.
 *
 * Background cesta (sync worker) tento kontext NEnastavuje → `getStore()` je
 * `undefined` → connector se chová jako dřív (trpělivý plný backoff).
 */
type InteractiveBudget = { budgetMs: number; waitedMs: number };

const storage = new AsyncLocalStorage<InteractiveBudget>();

/** Default strop kumulativního rate-limit čekání na jeden interaktivní call. */
export const DEFAULT_INTERACTIVE_WAIT_BUDGET_MS = 10_000;

/**
 * Spustí `fn` v kontextu interaktivního rozpočtu čekání. Connector backoff uvnitř
 * pak smí dohromady prospat max `budgetMs`; po vyčerpání fail-fast.
 */
export function runWithInteractiveBudget<T>(
  fn: () => Promise<T>,
  budgetMs: number = DEFAULT_INTERACTIVE_WAIT_BUDGET_MS
): Promise<T> {
  return storage.run({ budgetMs, waitedMs: 0 }, fn);
}

/**
 * Kolik ms čekání ještě zbývá v aktuálním interaktivním rozpočtu.
 * `null` = nejsme v interaktivním kontextu (background sync) → bez stropu.
 */
export function getInteractiveWaitRemaining(): number | null {
  const ctx = storage.getStore();
  if (!ctx) return null;
  return Math.max(0, ctx.budgetMs - ctx.waitedMs);
}

/** Připíše `ms` k vyčerpanému čekání aktuálního rozpočtu (no-op mimo kontext). */
export function chargeInteractiveWait(ms: number): void {
  const ctx = storage.getStore();
  if (ctx) ctx.waitedMs += Math.max(0, ms);
}

/**
 * Generický predikát: je to rate-limit chyba connectoru? Duck-typed na HTTP 429
 * (connector error nese `status`), aby tool vrstva nemusela importovat konkrétní
 * connector. Rate-limit je „zastav všechno a zkus později" signál — nepolykat ho
 * v safeGet a nepokračovat v bulku po jeho výskytu.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (err as { status?: unknown }).status === 429;
}
