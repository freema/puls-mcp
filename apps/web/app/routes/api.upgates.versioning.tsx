import type { Route } from './+types/api.upgates.versioning';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { handleUpgatesVersioning } from '~/lib/upgates-install';
import { logger, serializeError } from '~/lib/logger';

/**
 * Upgates versioning endpoint. Migrace mezi verzemi doplňku → ověří podpis a
 * idempotentně re-registruje webhooky dle nové verze. Vrací konfiguraci verze.
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
    const result = await handleUpgatesVersioning(db, env, body);
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'upgates versioning crashed');
    return Response.json(
      { error: true, message: 'Interní chyba' },
      { status: 200 }
    );
  }
}
