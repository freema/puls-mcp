import type { Locale } from '~/lib/locale';
import { DEFAULT_LOCALE, isValidLocale } from '~/lib/locale';
import { deepMergeRecords, readLocaleJson } from '~/lib/locale-json.server';

const nsCache =
  process.env.NODE_ENV === 'production'
    ? new Map<string, Record<string, unknown>>()
    : null;

/**
 * Loads a namespace bundle for the given locale, falling back to CZ for any
 * missing keys. Cached in production.
 */
export function getTranslations(
  locale: Locale,
  namespace: string
): Record<string, unknown> {
  const loc = isValidLocale(locale) ? locale : DEFAULT_LOCALE;
  const key = `${loc}:${namespace}`;
  if (nsCache?.has(key)) return nsCache.get(key)!;

  const filename = `${namespace}.json`;
  const base = readLocaleJson(`${DEFAULT_LOCALE}/${filename}`) ?? {};
  let merged: Record<string, unknown>;
  if (loc === DEFAULT_LOCALE) {
    merged = base;
  } else {
    const overlay = readLocaleJson(`${loc}/${filename}`) ?? {};
    merged = deepMergeRecords(base, overlay);
  }

  nsCache?.set(key, merged);
  return merged;
}

export function getTranslationBundles(
  locale: Locale,
  namespaces: readonly string[]
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const ns of namespaces) {
    out[ns] = getTranslations(locale, ns);
  }
  return out;
}

export function clearTranslationsCache() {
  nsCache?.clear();
}

export function getTranslationString(
  locale: Locale,
  namespace: string,
  dotPath: string
): string | undefined {
  const obj = getTranslations(locale, namespace);
  const keys = dotPath.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

export function getTranslationStringWithVars(
  locale: Locale,
  namespace: string,
  dotPath: string,
  vars?: Record<string, string | number>
): string | undefined {
  const raw = getTranslationString(locale, namespace, dotPath);
  if (raw == null) return undefined;
  return applyVars(raw, vars);
}
