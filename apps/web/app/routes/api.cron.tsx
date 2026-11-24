import type { Route } from './+types/api.cron';
import { getDb } from '~/lib/db';
import { getConfig } from '~/lib/config';
import { logger } from '~/lib/logger';
import {
  expireTrials,
  pruneActivityLog,
  pruneExpiredTrials,
  runTrialReminders,
} from '~/lib/cron/trial-expiry.server';
import {
  probeAndRecord,
  rollupYesterday,
} from '~/lib/cron/health-pinger.server';

/**
 * Cron endpoint volaný externím schedulerem (Coolify, GitHub Actions, k8s
 * CronJob …). Authorizace přes hlavičku `Authorization: Bearer <CRON_SECRET>`.
 *
 * Jobs:
 *   ?job=trial-reminders   denně D-3 a D-1 maily
 *   ?job=trial-expiry      přepne expirované trialy na PAUSED + posílá email
 *   ?job=log-retention     smaže mcp_tool_calls starší než tier retence
 *   ?job=trial-purge       smaže data shopů s expirovaným trialem + grace
 *   ?job=status-pinger     probe web/mcp/shoptet_api/upgates_api do health_pings (test trigger)
 *   ?job=status-rollup     rollup health_pings yesterday → health_daily
 *   ?job=all               všechny v pořadí (defaultní)
 */
export async function loader({ request }: Route.LoaderArgs) {
  const env = getConfig();
  const auth = request.headers.get('authorization') ?? '';
  const expected = env.CRON_SECRET;

  if (!expected) {
    return Response.json(
      { error: 'CRON_SECRET není nastavený' },
      { status: 503 }
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const job = url.searchParams.get('job') ?? 'all';
  const db = getDb();

  const result: Record<string, unknown> = { job, ranAt: new Date().toISOString() };

  try {
    if (job === 'trial-reminders' || job === 'all') {
      result.reminders = await runTrialReminders(db);
    }
    if (job === 'trial-expiry' || job === 'all') {
      result.expiry = await expireTrials(db);
    }
    if (job === 'log-retention' || job === 'all') {
      result.retention = await pruneActivityLog(db);
    }
    if (job === 'trial-purge' || job === 'all') {
      result.purge = await pruneExpiredTrials(db);
    }
    if (job === 'status-pinger') {
      result.statusPing = await probeAndRecord(db);
    }
    if (job === 'status-rollup') {
      result.statusRollup = await rollupYesterday(db);
    }
  } catch (err) {
    logger.error({ err, job }, 'cron job failed');
    return Response.json(
      { error: 'cron job failed', detail: String(err) },
      { status: 500 }
    );
  }

  return Response.json(result);
}

export const action = loader;
