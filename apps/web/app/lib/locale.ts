export const SUPPORTED_LOCALES = ['cs', 'sk', 'hu', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'cs';

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

export function isValidLocale(lang: string | undefined | null): lang is Locale {
  return !!lang && LOCALE_SET.has(lang);
}

/** CZ stays unprefixed; sk/hu/en get `/sk/...` etc. */
export function getLocalePath(locale: Locale, path: string): string {
  const normalized =
    path === '' || path === '/'
      ? '/'
      : path.startsWith('/')
        ? path
        : `/${path}`;
  if (locale === DEFAULT_LOCALE) return normalized;
  if (normalized === '/') return `/${locale}`;
  return `/${locale}${normalized}`;
}

/** BCP 47 tags for og:locale */
export function ogLocaleContent(locale: Locale): string {
  switch (locale) {
    case 'sk':
      return 'sk_SK';
    case 'hu':
      return 'hu_HU';
    case 'en':
      return 'en_US';
    default:
      return 'cs_CZ';
  }
}

export function ogLocaleAlternates(locale: Locale): string[] {
  return SUPPORTED_LOCALES.filter((l) => l !== locale).map(ogLocaleContent);
}

/** Stable Intl tag */
export function bcp47Tag(locale: Locale): string {
  switch (locale) {
    case 'sk':
      return 'sk-SK';
    case 'hu':
      return 'hu-HU';
    case 'en':
      return 'en-US';
    default:
      return 'cs-CZ';
  }
}

/**
 * URL segments that NEVER get a locale prefix. Must match server-side
 * resolveLocale gating exactly.
 */
export const UNPREFIXED_GLOBAL_SEGMENTS = new Set([
  'api',
  'auth',
  'oauth',
  '.well-known',
  'healthz',
  'robots.txt',
  'assets',
  'maintenance',
  'favicon.ico',
  'favicon-16.png',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'manifest.json',
  // Logged-in app uses cookie/user-pref locale, not URL prefix.
  'dashboard',
  'admin',
  'settings',
]);

export function isGlobalUnprefixedRoute(pathname: string): boolean {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const first = normalized.split('/').filter(Boolean)[0];
  return !!first && UNPREFIXED_GLOBAL_SEGMENTS.has(first);
}

/** Strip leading locale segment(s). Client-safe. */
export function stripLocalePrefix(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const parts = normalized.split('/').filter(Boolean);
  while (parts.length > 0 && isValidLocale(parts[0])) {
    parts.shift();
  }
  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

/** After locale switch: global routes stay flat; localized routes get prefix. */
export function targetPathAfterLocaleSwitch(
  next: Locale,
  pathname: string
): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const bare = stripLocalePrefix(normalized);
  if (isGlobalUnprefixedRoute(bare)) {
    return bare;
  }
  return getLocalePath(next, bare);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  cs: 'Čeština',
  sk: 'Slovenčina',
  hu: 'Magyar',
  en: 'English',
};

export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  cs: 'CZ',
  sk: 'SK',
  hu: 'HU',
  en: 'EN',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  cs: '🇨🇿',
  sk: '🇸🇰',
  hu: '🇭🇺',
  en: '🇬🇧',
};
