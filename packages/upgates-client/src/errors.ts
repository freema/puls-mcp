import type { AxiosResponse } from 'axios';

/**
 * Upgates API error. Envelope 400 → `{ "errors": [ { "message": "..." } ] }`.
 * 401 = neplatná autorizace, 403 = blokace IP (5 chyb/h), 404 = not found.
 */
export class UpgatesApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'UpgatesApiError';
  }
}

/**
 * Rate-limit fail-fast: interaktivní tool call vyčerpal svůj strop čekání na
 * proaktivní backoff (Upgates hodinový pool tokenů je skoro/úplně prázdný).
 * Vyhazuje se MÍSTO dlouhého blokujícího sleepu, aby spojení na MCP proxy
 * nepřeteklo idle-timeout. Status 429 = klient ví, že jde o rate limit.
 */
export class UpgatesRateLimitError extends UpgatesApiError {
  constructor(
    message = 'Upgates API má skoro vyčerpaný hodinový limit požadavků — zkus to prosím za pár minut.'
  ) {
    super(message, 429);
    this.name = 'UpgatesRateLimitError';
  }
}

/**
 * Vytáhne lidsky čitelnou zprávu z Upgates error envelope
 * `{ "errors": [ { "message": "..." } ] }`. Fallback na HTTP status.
 */
export function extractUpgatesError(res: AxiosResponse<unknown>): string {
  const body = res.data as { errors?: Array<{ message?: string }> } | undefined;
  const first = body?.errors?.[0]?.message;
  if (typeof first === 'string' && first.length > 0) return first;
  return `HTTP ${res.status}`;
}
