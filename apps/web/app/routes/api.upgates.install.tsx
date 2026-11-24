import type { Route } from './+types/api.upgates.install';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { handleUpgatesInstall } from '~/lib/upgates-install';
import { logger, serializeError } from '~/lib/logger';

/**
 * Upgates installation endpoint. Přijme podepsaný aktivační callback, ověří
 * `signature_v2`, spáruje eshop a uloží šifrované credentials. Kontrakt Upgates:
 * VŽDY HTTP 200 s `{ error, message }` (i při chybě), odpovědět do 5 s.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: true, message: 'Method not allowed' },
      { status: 200 }
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: true, message: 'Neplatný JSON' },
      { status: 200 }
    );
  }

  try {
    const env = getConfig();
    const db = getDb();
    const result = await handleUpgatesInstall(db, env, body);
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'upgates install crashed');
    return Response.json(
      { error: true, message: 'Interní chyba aktivace' },
      { status: 200 }
    );
  }
}
