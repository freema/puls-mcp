import { getDb } from '~/lib/db';
import { logger, serializeError } from '~/lib/logger';
import {
  maybeDailyRollup,
  probeAndRecord,
} from '~/lib/cron/health-pinger.server';

/**
 * In-process scheduler. Boots once per Node process at module-import time.
 * Replaces the need for an external HTTP cron for jobs that can run inside
 * the web app process (single-instance Coolify deployment).
 *
 * Jobs:
 *   health-pinger — every 60s: probe targets + daily rollup.
 *
 * Multi-instance note: if we ever scale horizontally, swap the interval for
 * a Postgres advisory-lock-based leader election. For now (single replica)
 * the simple interval is fine.
 */

const HEALTH_PING_INTERVAL_MS = 60_000;

type SchedulerHandle = {
  stop: () => void;
};

declare global {
  // eslint-disable-next-line no-var
  var __pulsHealthPinger: SchedulerHandle | undefined;
}

function startHealthPingerLoop(): SchedulerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const db = getDb();
      await probeAndRecord(db);
      await maybeDailyRollup(db);
    } catch (err) {
      logger.error(
        { err: serializeError(err) },
        'scheduler: health-pinger tick failed'
      );
    } finally {
      running = false;
    }
  };

  // Stagger first tick by a few seconds so DB is reachable before we hit it.
  const initialDelay = setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, HEALTH_PING_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }, 7_000);
  if (typeof initialDelay.unref === 'function') initialDelay.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      clearTimeout(initialDelay);
    },
  };
}

/**
 * Idempotent boot. Safe to call multiple times (HMR, multiple route imports).
 */
export function ensureScheduler(): void {
  if (process.env.PULS_DISABLE_SCHEDULER === '1') return;
  if (!globalThis.__pulsHealthPinger) {
    globalThis.__pulsHealthPinger = startHealthPingerLoop();
    logger.info(
      { intervalMs: HEALTH_PING_INTERVAL_MS },
      'scheduler: health-pinger loop started'
    );
  }
}
