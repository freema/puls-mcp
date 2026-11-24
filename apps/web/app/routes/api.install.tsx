import type { Route } from './+types/api.install';
import { handleInstall } from '~/lib/shoptet-install';
import { getConfig } from '~/lib/config';
import { getDb } from '~/lib/db';
import { logger, serializeError } from '~/lib/logger';

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  try {
    const env = getConfig();
    const db = getDb();

    const result = await handleInstall(db, env, code);
    logger.info(
      { shopId: result.shopId, durationMs: Math.round(result.durationMs) },
      'install ok'
    );
    return Response.json({
      ok: true,
      shopId: result.shopId,
      durationMs: Math.round(result.durationMs),
    });
  } catch (err) {
    logger.error(
      { err: serializeError(err), hasCode: Boolean(code) },
      'install failed'
    );
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'install failed',
      },
      { status: 400 }
    );
  }
}
