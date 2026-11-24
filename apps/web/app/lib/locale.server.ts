import {
  DEFAULT_LOCALE,
  type Locale,
  isValidLocale,
  UNPREFIXED_GLOBAL_SEGMENTS,
} from '~/lib/locale';

export const LOCALE_COOKIE = 'puls_locale';

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function localeCookieHeader(locale: Locale): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function localePrefixFromPathname(pathname: string): Locale | null {
  const seg = pathname.split('/').filter(Boolean)[0];
  if (!seg || UNPREFIXED_GLOBAL_SEGMENTS.has(seg)) return null;
  if (seg === DEFAULT_LOCALE) return null;
  return isValidLocale(seg) ? seg : null;
}

export function resolveLocaleFromPathname(pathname: string): Locale {
  const seg = pathname.split('/').filter(Boolean)[0];
  if (seg && !UNPREFIXED_GLOBAL_SEGMENTS.has(seg) && isValidLocale(seg)) {
    return seg;
  }
  return DEFAULT_LOCALE;
}

function parseLocaleCookie(cookieHeader: string | null): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const rawVal = trimmed.slice(eq + 1).trim();
    if (name !== LOCALE_COOKIE) continue;
    try {
      const decoded = decodeURIComponent(rawVal);
      if (isValidLocale(decoded)) return decoded;
    } catch {
      continue;
    }
  }
  return null;
}

function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header?.trim()) return null;
  const parts = header.split(',').map((chunk) => {
    const [langRaw, ...params] = chunk.trim().split(';');
    const lang = (langRaw ?? '').trim().toLowerCase();
    let q = 1;
    for (const p of params) {
      const [k, v] = p.split('=').map((s) => s.trim());
      if (k === 'q') {
        const n = Number.parseFloat(v ?? '');
        if (!Number.isNaN(n)) q = n;
      }
    }
    return { lang, q };
  });
  parts.sort((a, b) => b.q - a.q);
  for (const { lang } of parts) {
    const base = lang.split('-')[0] ?? lang;
    if (base === 'cs') return 'cs';
    if (base === 'sk') return 'sk';
    if (base === 'hu') return 'hu';
    if (base === 'en') return 'en';
  }
  return null;
}

export type LocaleResolverUser = {
  preferredLocale?: string | null;
} | null;

/**
 * Resolution order:
 *  1. URL prefix (/sk/, /hu/, /en/)
 *  2. Authenticated user.preferredLocale
 *  3. puls_locale cookie
 *  4. Accept-Language
 *  5. cs (default)
 */
export function resolveLocale(
  request: Request,
  user: LocaleResolverUser
): Locale {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const first = pathname.split('/').filter(Boolean)[0];

  if (first && !UNPREFIXED_GLOBAL_SEGMENTS.has(first) && isValidLocale(first)) {
    return first;
  }

  if (user?.preferredLocale && isValidLocale(user.preferredLocale)) {
    return user.preferredLocale;
  }

  const fromCookie = parseLocaleCookie(request.headers.get('Cookie'));
  if (fromCookie) return fromCookie;

  const fromHeader = localeFromAcceptLanguage(
    request.headers.get('Accept-Language')
  );
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

export function validateLocaleParam(
  raw: string | undefined
): Locale | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isValidLocale(raw)) return undefined;
  return raw;
}
