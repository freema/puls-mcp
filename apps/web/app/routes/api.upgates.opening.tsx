import type { Route } from './+types/api.upgates.opening';
import { getConfig } from '~/lib/config';
import { handleUpgatesOpening } from '~/lib/upgates-install';
import { logger, serializeError } from '~/lib/logger';

/**
 * Upgates opening endpoint. Po aktivaci klient otevře doplněk v adminu → Upgates
 * sem POSTne podepsaný payload a my vrátíme `{ url, type:'iframe' }` s adresou
 * našeho aktivačního iframu. Neplatný podpis → HTTP 400.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  try {
    const env = getConfig();
    const origin = new URL(request.url).origin;
    const result = await handleUpgatesOpening(env, body, origin);
    if (result.error) {
      return Response.json({ error: result.message }, { status: 400 });
    }
    return Response.json({ url: result.url, type: result.type }, { status: 200 });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'upgates opening crashed');
    return Response.json({ error: 'Interní chyba' }, { status: 500 });
  }
}
