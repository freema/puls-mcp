import Redis from 'ioredis';
import { getConfig } from './config';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const { REDIS_URL } = getConfig();
  client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  return client;
}

export async function healthRedisPing(): Promise<void> {
  const r = getRedis();
  const pong = await r.ping();
  if (pong !== 'PONG') {
    throw new Error(`unexpected redis ping: ${pong}`);
  }
}
