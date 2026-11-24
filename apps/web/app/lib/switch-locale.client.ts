import { targetPathAfterLocaleSwitch, type Locale } from '~/lib/locale';

/**
 * POST locale to /api/locale (sets cookie + user pref), then hard-navigate to
 * the same logical path in the new locale.
 */
export async function persistLocaleAndGo(
  next: Locale,
  errorMessage = 'Nepodařilo se přepnout jazyk. Zkus to znovu.'
): Promise<boolean> {
  const res = await fetch('/api/locale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: next }),
    credentials: 'include',
  });
  if (!res.ok) {
    window.alert(errorMessage);
    return false;
  }
  const nextPath = targetPathAfterLocaleSwitch(next, window.location.pathname);
  window.location.href =
    nextPath + window.location.search + window.location.hash;
  return true;
}
