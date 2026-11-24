import type { Route } from './+types/api.upgates.uninstall';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { handleUpgatesUninstall } from '~/lib/upgates-install';
import { logger, serializeError } from '~/lib/logger';

/**
 * Upgates uninstall/deactivation endpoint. Ověří podpis, označí shop UNINSTALLED,
 * zneplatní credentials a odregistruje webhooky. Odpověď se nevyžaduje, ale
 * vracíme `{ error:false }` 200 pro konzistenci.
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
    const result = await handleUpgatesUninstall(db, env, body);
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'upgates uninstall crashed');
    return Response.json(
      { error: true, message: 'Interní chyba' },
      { status: 200 }
    );
  }
}
