import type { AxiosInstance } from 'axios';
import { upgatesRequest } from './http.js';

/** Majitel/účet eshopu — pro spárování `admin_email` při aktivaci doplňku. */
export interface UpgatesOwner {
  email: string | null;
  name: string | null;
}

const OWNER_PATH = '/api/v2/owner';

/**
 * `/owner` lookup pro získání e-mailu majitele eshopu (Upgates aktivační
 * callback e-mail nenese). Defenzivní parse: bere `owner.email` i ploché
 * `email`. `[O]`: přesný tvar ověřit na demo eshopu — když e-mail nedostaneme,
 * párování dokončí klient přihlášením v iframu (vrací null, install neselže).
 */
export async function fetchOwner(client: AxiosInstance): Promise<UpgatesOwner> {
  try {
    const res = await upgatesRequest<unknown>(client, {
      method: 'GET',
      url: OWNER_PATH,
    });
    if (res.status >= 400 || res.data == null || res.data === '') {
      return { email: null, name: null };
    }
    const body = res.data as Record<string, unknown>;
    const owner = (body.owner as Record<string, unknown> | undefined) ?? body;
    const email =
      typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : null;
    const name = typeof owner.name === 'string' ? owner.name.trim() : null;
    return { email: email || null, name: name || null };
  } catch {
    return { email: null, name: null };
  }
}
