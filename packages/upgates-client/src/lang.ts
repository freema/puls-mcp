/**
 * Upgates textová pole jsou pole jazykových verzí. Vybere verzi dle `adminLang`,
 * fallback `cs`, pak první dostupná (platformy s jediným jazykem tuto vrstvu
 * nepotřebují).
 */
export interface LangValue {
  language?: string;
}

export function pickLanguage<T extends LangValue>(
  versions: T[] | undefined,
  adminLang: string | null | undefined,
  fallback = 'cs'
): T | undefined {
  if (!versions || versions.length === 0) return undefined;
  const byLang = (lang: string | null | undefined): T | undefined =>
    lang ? versions.find((v) => v.language === lang) : undefined;
  return byLang(adminLang) ?? byLang(fallback) ?? versions[0];
}
