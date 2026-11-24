import { healthDbPing } from '~/lib/db';
import { healthRedisPing } from '~/lib/redis';

export type HealthBody = {
  ok: boolean;
  db: 'up' | 'down';
  redis: 'up' | 'down';
};

export async function runHealthChecks(): Promise<HealthBody> {
  let db: HealthBody['db'] = 'down';
  let redis: HealthBody['redis'] = 'down';
  try {
    await healthDbPing();
    db = 'up';
  } catch {
    db = 'down';
  }
  try {
    await healthRedisPing();
    redis = 'up';
  } catch {
    redis = 'down';
  }
  return {
    ok: db === 'up' && redis === 'up',
    db,
    redis,
  };
}
