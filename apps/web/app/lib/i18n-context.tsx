import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from '~/lib/locale';

export type TranslationBundle = Record<string, unknown>;

function lookup(obj: unknown, dotPath: string): string | undefined {
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
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

type I18nCtx = {
  locale: Locale;
  /** Missing keys return `dotPath` (visible in UI for debugging). `{var}` placeholders via `vars`. */
  t: (
    namespace: string,
    dotPath: string,
    vars?: Record<string, string | number>
  ) => string;
};

const I18nContext = createContext<I18nCtx | null>(null);

export function I18nProvider({
  children,
  locale,
  bundles,
}: {
  children: ReactNode;
  locale: Locale;
  bundles: Record<string, TranslationBundle>;
}) {
  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      t(ns, path, vars) {
        const table = bundles[ns];
        const raw = lookup(table, path) ?? path;
        return applyVars(raw, vars);
      },
    }),
    [locale, bundles]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

export function useTranslations(namespace: string) {
  const { t } = useI18n();
  return (dotPath: string, vars?: Record<string, string | number>) =>
    t(namespace, dotPath, vars);
}

export function useLocale(): Locale {
  return useI18n().locale;
}
