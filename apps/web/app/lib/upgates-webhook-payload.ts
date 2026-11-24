/**
 * Upgates datový webhook: POST se SEZNAMEM ID entit + jméno eshopu (NE plná
 * data jako Shoptet). Zrcadlí Shoptet `parseShoptetWebhook`, ale tvar je Upgates:
 * `{ eshop, <event>: [ids] }`. Vrací ok/error union pro graceful 400/401.
 */
export type ParsedUpgatesWebhook = {
  /** Identifikátor eshopu (= shops.platform_account_id). */
  eshop: string;
  /** Event kategorie odvozená z klíče se seznamem ID (orders/products/…). */
  event: string;
  ids: string[];
  /** Původní JSON document se všemi poli (pro persistenci/audit). */
  payload: Record<string, unknown>;
};

export function parseUpgatesWebhookPayload(
  rawUtf8: string
):
  | { ok: false; error: 'invalid_json' | 'invalid_shape' }
  | { ok: true; value: ParsedUpgatesWebhook } {
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
  const obj = doc as Record<string, unknown>;
  const eshop = typeof obj.eshop === 'string' ? obj.eshop.trim() : '';
  if (!eshop) return { ok: false, error: 'invalid_shape' };

  let event = '';
  let ids: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'eshop') continue;
    if (Array.isArray(value)) {
      event = key;
      ids = value.map((x) => String(x));
      break;
    }
  }
  if (!event) return { ok: false, error: 'invalid_shape' };

  return { ok: true, value: { eshop, event, ids, payload: obj } };
}
